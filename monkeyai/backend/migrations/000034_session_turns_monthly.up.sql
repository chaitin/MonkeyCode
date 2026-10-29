BEGIN;
SET LOCAL lock_timeout = '2s';

-- Stop old backends for preparation. Historical facts are copied by the worker.
-- Fast defaults distinguish existing, unverified caches from new empty sessions.
ALTER TABLE sessions ADD COLUMN turn_count_verified boolean NOT NULL DEFAULT false;
ALTER TABLE sessions ALTER COLUMN turn_count_verified SET DEFAULT true;
CREATE TABLE session_turns_partition_state (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    source_relation regclass NOT NULL,
    target_relation regclass NOT NULL,
    phase text NOT NULL DEFAULT 'backfill' CHECK (phase IN ('backfill','partitioned')),
    end_session uuid,
    end_turn integer,
    cursor_session uuid,
    cursor_turn integer,
    checked_rows bigint NOT NULL DEFAULT 0,
    count_end uuid,
    count_cursor uuid,
    counts_ready boolean NOT NULL DEFAULT false,
    mirror_legacy boolean NOT NULL DEFAULT true,
    switched_at timestamptz
);
CREATE TABLE session_turns_keys (
    session_id uuid NOT NULL REFERENCES sessions(id),
    turn_index integer NOT NULL CHECK (turn_index > 0),
    started_at timestamptz NOT NULL CHECK (isfinite(started_at)),
    PRIMARY KEY (session_id,turn_index),
    UNIQUE (session_id,turn_index,started_at)
);
CREATE INDEX session_turns_keys_clock ON session_turns_keys(session_id,started_at,turn_index);
CREATE VIEW session_turns_original AS SELECT * FROM session_turns;
CREATE TABLE session_turns_partitioned (
    LIKE session_turns INCLUDING DEFAULTS INCLUDING CONSTRAINTS,
    PRIMARY KEY (session_id,started_at,turn_index),
    FOREIGN KEY (session_id,turn_index,started_at) REFERENCES session_turns_keys(session_id,turn_index,started_at),
    CHECK (isfinite(started_at))
) PARTITION BY RANGE (started_at);
CREATE TABLE session_turns_default PARTITION OF session_turns_partitioned DEFAULT;
CREATE INDEX session_turns_monthly_order ON session_turns_partitioned(started_at DESC,session_id DESC,turn_index DESC);
CREATE INDEX session_turns_monthly_model ON session_turns_partitioned(model_id,started_at) WHERE model_id IS NOT NULL;
INSERT INTO session_turns_partition_state(source_relation,target_relation,end_session,end_turn,count_end,counts_ready)
SELECT 'session_turns'::regclass,'session_turns_partitioned'::regclass,
    (SELECT session_id FROM session_turns ORDER BY session_id DESC,turn_index DESC LIMIT 1),
    (SELECT turn_index FROM session_turns ORDER BY session_id DESC,turn_index DESC LIMIT 1),
    (SELECT id FROM sessions ORDER BY id DESC LIMIT 1),NOT EXISTS(SELECT 1 FROM sessions);

CREATE FUNCTION session_turns_backfilling() RETURNS boolean
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
    SELECT source_relation=to_regclass('session_turns') FROM session_turns_partition_state;
$$;
CREATE FUNCTION session_turn_time(sid uuid,idx integer) RETURNS timestamptz
LANGUAGE plpgsql STABLE SET search_path FROM CURRENT AS $$
DECLARE at_time timestamptz;
BEGIN
    SELECT started_at INTO at_time FROM session_turns_keys WHERE session_id=sid AND turn_index=idx;
    IF at_time IS NULL AND session_turns_backfilling() THEN
        SELECT started_at INTO at_time FROM session_turns_original WHERE session_id=sid AND turn_index=idx;
    END IF;
    RETURN at_time;
END;
$$;
-- Session scans use a bounded registry lookup after cutover. Before cutover the
-- original PK remains authoritative, including identities not backfilled yet.
CREATE FUNCTION session_turn_times(sid uuid) RETURNS TABLE(turn_index integer,started_at timestamptz)
LANGUAGE plpgsql STABLE SET search_path FROM CURRENT AS $$
BEGIN
    IF session_turns_backfilling() THEN
        RETURN QUERY SELECT t.turn_index,t.started_at FROM session_turns_original t WHERE t.session_id=sid;
    ELSE
        RETURN QUERY SELECT k.turn_index,k.started_at FROM session_turns_keys k WHERE k.session_id=sid;
    END IF;
END;
$$;
-- Pagination needs only the session's time extent, not a point lookup for
-- every historical turn before sorting/limiting. MIN/MAX use the clock index.
CREATE FUNCTION session_turn_bounds(sid uuid) RETURNS TABLE(first_at timestamptz,last_at timestamptz)
LANGUAGE plpgsql STABLE ROWS 1 SET search_path FROM CURRENT AS $$
BEGIN
    IF session_turns_backfilling() THEN
        -- The ordinary source needs no partition bounds; its unvisited keys
        -- must remain visible without scanning the whole task for MIN/MAX.
        RETURN QUERY SELECT NULL::timestamptz,NULL::timestamptz;
    ELSE
        RETURN QUERY SELECT min(k.started_at),max(k.started_at) FROM session_turns_keys k WHERE k.session_id=sid;
    END IF;
END;
$$;
CREATE FUNCTION session_turns_register_key() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE original_at timestamptz; registered_at timestamptz;
BEGIN
    IF TG_OP='UPDATE' AND (NEW.session_id,NEW.turn_index,NEW.started_at) IS DISTINCT FROM (OLD.session_id,OLD.turn_index,OLD.started_at) THEN
        RAISE EXCEPTION '轮次的会话、编号和分区时间不可修改' USING ERRCODE='23505';
    END IF;
    IF session_turns_backfilling() THEN
        SELECT started_at INTO original_at FROM session_turns_original WHERE session_id=NEW.session_id AND turn_index=NEW.turn_index;
    END IF;
    INSERT INTO session_turns_keys VALUES(NEW.session_id,NEW.turn_index,coalesce(original_at,NEW.started_at))
        ON CONFLICT (session_id,turn_index) DO NOTHING;
    SELECT started_at INTO STRICT registered_at FROM session_turns_keys WHERE session_id=NEW.session_id AND turn_index=NEW.turn_index;
    IF registered_at IS DISTINCT FROM NEW.started_at THEN
        RAISE EXCEPTION '同一轮次不能跨月重复登记' USING ERRCODE='23505';
    END IF;
    RETURN NEW;
END;
$$;
CREATE FUNCTION session_turns_mirror() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE progress session_turns_partition_state; marker text := coalesce(current_setting('monkeyai.turns_mirror',true),'');
    destination regclass; assignments text; conflict_columns text; data jsonb; sid uuid; verified boolean;
BEGIN
    IF marker<>'' THEN RETURN NULL; END IF;
    SELECT * INTO STRICT progress FROM session_turns_partition_state;
    IF TG_ARGV[0]='reverse' AND progress.target_relation<>to_regclass('session_turns') THEN RETURN NULL; END IF;
    IF TG_ARGV[0]='forward' AND progress.source_relation<>to_regclass('session_turns') THEN
        RAISE EXCEPTION '轮次月分区已切换，请重试旧事务' USING ERRCODE='40001';
    END IF;
    data := CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
    sid := (data->>'session_id')::uuid;
    -- Lock even unverified caches, so calibration cannot race an uncommitted
    -- INSERT/DELETE whose counter update would otherwise skip the parent row.
    SELECT turn_count_verified INTO verified FROM sessions WHERE id=sid FOR UPDATE;
    IF TG_OP<>'UPDATE' AND verified THEN
        UPDATE sessions SET turn_count=turn_count+CASE WHEN TG_OP='INSERT' THEN 1 ELSE -1 END WHERE id=sid;
    END IF;
    IF TG_ARGV[0]='forward' OR progress.mirror_legacy THEN
        destination := CASE WHEN TG_ARGV[0]='forward' THEN progress.target_relation ELSE progress.source_relation END;
        conflict_columns := CASE WHEN TG_ARGV[0]='forward' THEN 'session_id,turn_index,started_at' ELSE 'session_id,turn_index' END;
        PERFORM set_config('monkeyai.turns_mirror','mirror',true);
        IF TG_OP='DELETE' THEN
            EXECUTE format('DELETE FROM %s WHERE session_id=$1 AND turn_index=$2 AND started_at=$3',destination)
                USING OLD.session_id,OLD.turn_index,OLD.started_at;
        ELSE
            SELECT string_agg(format('%1$I=EXCLUDED.%1$I',attname),',' ORDER BY attnum) INTO assignments
                FROM pg_attribute WHERE attrelid=destination AND attnum>0 AND NOT attisdropped AND attname NOT IN ('session_id','turn_index','started_at');
            EXECUTE format('INSERT INTO %s SELECT (jsonb_populate_record(NULL::%s,$1)).* ON CONFLICT (%s) DO UPDATE SET %s',destination,destination,conflict_columns,assignments)
                USING data;
        END IF;
        PERFORM set_config('monkeyai.turns_mirror',marker,true);
    END IF;
    IF TG_OP='DELETE' THEN
        DELETE FROM session_turns_keys WHERE session_id=OLD.session_id AND turn_index=OLD.turn_index;
    END IF;
    RETURN NULL;
END;
$$;
CREATE TRIGGER turns_key AFTER INSERT OR UPDATE ON session_turns FOR EACH ROW EXECUTE FUNCTION session_turns_register_key();
CREATE TRIGGER turns_key BEFORE INSERT OR UPDATE ON session_turns_partitioned FOR EACH ROW EXECUTE FUNCTION session_turns_register_key();
CREATE TRIGGER turns_mirror AFTER INSERT OR UPDATE OR DELETE ON session_turns FOR EACH ROW EXECUTE FUNCTION session_turns_mirror('forward');
CREATE TRIGGER turns_mirror AFTER INSERT OR UPDATE OR DELETE ON session_turns_partitioned FOR EACH ROW EXECUTE FUNCTION session_turns_mirror('reverse');
DO $$
DECLARE item record;
BEGIN
    FOR item IN SELECT conname,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid='session_turns'::regclass AND contype='f' LOOP
        EXECUTE format('ALTER TABLE session_turns_partitioned ADD CONSTRAINT %I %s',item.conname,item.definition);
    END LOOP;
END;
$$;

CREATE FUNCTION session_create_turn_month(at_time timestamptz,move_limit integer DEFAULT 10000) RETURNS void
LANGUAGE plpgsql SET search_path FROM CURRENT SET lock_timeout='2s' AS $$
DECLARE progress session_turns_partition_state; starts_at timestamptz; ends_at timestamptz; part_name text; part_table regclass; pending integer; marker text;
BEGIN
    IF NOT isfinite(at_time) OR move_limit<0 THEN RAISE EXCEPTION '月份或搬迁上限无效'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(current_schema() || ':session-turns-monthly',0));
    SELECT * INTO STRICT progress FROM session_turns_partition_state;
    starts_at := date_trunc('month',at_time AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai';
    ends_at := (starts_at AT TIME ZONE 'Asia/Shanghai' + interval '1 month') AT TIME ZONE 'Asia/Shanghai';
    part_name := 'session_turns_' || to_char(starts_at AT TIME ZONE 'Asia/Shanghai','YYYY_MM');
    part_table := to_regclass(format('%I.%I',current_schema(),part_name));
    IF part_table IS NOT NULL THEN
        IF NOT EXISTS(SELECT 1 FROM pg_inherits WHERE inhrelid=part_table AND inhparent=progress.target_relation) THEN RAISE EXCEPTION '月分区名称已被占用: %',part_name; END IF;
        RETURN;
    END IF;
    SELECT count(*) INTO pending FROM (SELECT 1 FROM session_turns_default LIMIT CASE WHEN move_limit=0 THEN 1 ELSE move_limit+1 END) p;
    IF move_limit>0 AND pending>move_limit THEN RAISE EXCEPTION '轮次默认分区积压超限，请在维护窗口按月搬迁' USING ERRCODE='55000'; END IF;
    EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE NOWAIT',progress.target_relation);
    SELECT count(*) INTO pending FROM (SELECT 1 FROM session_turns_default LIMIT CASE WHEN move_limit=0 THEN 1 ELSE move_limit+1 END) p;
    IF move_limit>0 AND pending>move_limit THEN RAISE EXCEPTION '轮次默认分区积压超限，请在维护窗口按月搬迁' USING ERRCODE='55000'; END IF;
    EXECUTE format('CREATE TABLE %I (LIKE %s INCLUDING DEFAULTS INCLUDING CONSTRAINTS)',part_name,progress.target_relation);
    marker := coalesce(current_setting('monkeyai.turns_mirror',true),'');
    PERFORM set_config('monkeyai.turns_mirror','move',true);
    EXECUTE format('WITH moved AS (DELETE FROM session_turns_default WHERE started_at >= $1 AND started_at < $2 RETURNING *) INSERT INTO %I SELECT * FROM moved',part_name) USING starts_at,ends_at;
    PERFORM set_config('monkeyai.turns_mirror',marker,true);
    EXECUTE format('ALTER TABLE %s ATTACH PARTITION %I FOR VALUES FROM (%L) TO (%L)',progress.target_relation,part_name,starts_at,ends_at);
END;
$$;
CREATE FUNCTION session_ensure_turn_months(at_time timestamptz) RETURNS boolean
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE i integer; month_time timestamptz; pending integer;
BEGIN
    IF NOT pg_try_advisory_xact_lock(hashtextextended(current_schema() || ':session-turns-monthly',0)) THEN RETURN false; END IF;
    SELECT count(*) INTO pending FROM (SELECT 1 FROM session_turns_default LIMIT 10001) p;
    IF pending>10000 THEN RAISE EXCEPTION '轮次默认分区积压超限，请在维护窗口按月搬迁' USING ERRCODE='55000'; END IF;
    FOR i IN 0..3 LOOP
        PERFORM session_create_turn_month((date_trunc('month',at_time AT TIME ZONE 'Asia/Shanghai')+i*interval '1 month') AT TIME ZONE 'Asia/Shanghai');
    END LOOP;
    FOR month_time IN SELECT DISTINCT date_trunc('month',started_at AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai' FROM session_turns_default ORDER BY 1 LOOP
        PERFORM session_create_turn_month(month_time);
    END LOOP;
    RETURN true;
END;
$$;
CREATE FUNCTION session_calibrate_turn_counts(batch_size integer) RETURNS integer
LANGUAGE plpgsql SET search_path FROM CURRENT SET lock_timeout='2s' AS $$
DECLARE progress session_turns_partition_state; item record; n integer := 0; actual integer;
BEGIN
    IF batch_size<1 OR batch_size>1000 THEN RAISE EXCEPTION '计数校准批次必须为 1 到 1000'; END IF;
    IF NOT pg_try_advisory_xact_lock(hashtextextended(current_schema() || ':session-turns-monthly',0)) THEN RETURN -2; END IF;
    SELECT * INTO STRICT progress FROM session_turns_partition_state FOR UPDATE;
    IF progress.counts_ready THEN RETURN -1; END IF;
    FOR item IN SELECT id,turn_count_verified FROM sessions WHERE (progress.count_cursor IS NULL OR id>progress.count_cursor) AND id<=progress.count_end ORDER BY id LIMIT batch_size FOR UPDATE LOOP
        IF NOT item.turn_count_verified THEN
            -- The source is still ordinary during calibration; after cutover route
            -- each fact to its exact month using the global registry.
            IF session_turns_backfilling() THEN
                SELECT count(*) INTO actual FROM session_turns_original WHERE session_id=item.id;
            ELSE
                SELECT count(*) INTO actual FROM session_turns_keys WHERE session_id=item.id;
            END IF;
            UPDATE sessions SET turn_count=actual,turn_count_verified=true WHERE id=item.id;
        END IF;
        UPDATE session_turns_partition_state SET count_cursor=item.id;
        n := n+1;
    END LOOP;
    IF n=0 THEN UPDATE session_turns_partition_state SET counts_ready=true,count_cursor=count_end; END IF;
    RETURN n;
END;
$$;
CREATE FUNCTION session_copy_turn_batch(batch_size integer) RETURNS integer
LANGUAGE plpgsql SET search_path FROM CURRENT SET lock_timeout='2s' AS $$
DECLARE progress session_turns_partition_state; item record; selected_keys jsonb; rows_json jsonb; scanned integer; copied integer; matched integer; marker text; month_time timestamptz;
BEGIN
    IF batch_size<1 OR batch_size>10000 THEN RAISE EXCEPTION '轮次回填批次必须为 1 到 10000'; END IF;
    IF NOT pg_try_advisory_xact_lock(hashtextextended(current_schema() || ':session-turns-monthly',0)) THEN RETURN -2; END IF;
    SELECT * INTO STRICT progress FROM session_turns_partition_state FOR UPDATE;
    IF progress.phase='partitioned' THEN RETURN -1; END IF;
    IF progress.end_session IS NULL THEN RETURN 0; END IF;
    -- Freeze the candidate identities before taking parent locks. Re-reading an
    -- unrestricted LIMIT after waiting could pull in an unlocked next session.
    SELECT jsonb_agg(to_jsonb(b) ORDER BY b.session_id,b.turn_index) INTO selected_keys FROM (
        SELECT session_id,turn_index FROM session_turns_original
        WHERE (progress.cursor_session IS NULL OR (session_id,turn_index)>(progress.cursor_session,progress.cursor_turn))
          AND (session_id,turn_index)<=(progress.end_session,progress.end_turn)
        ORDER BY session_id,turn_index LIMIT batch_size) b;
    scanned := coalesce(jsonb_array_length(selected_keys),0);
    IF scanned=0 THEN UPDATE session_turns_partition_state SET cursor_session=end_session,cursor_turn=end_turn; RETURN 0; END IF;
    -- Parent locks match report/purge order. Facts are read in a new statement
    -- snapshot AFTER waiting, so a concurrent committed purge stays deleted.
    FOR item IN SELECT DISTINCT (v->>'session_id')::uuid AS session_id FROM jsonb_array_elements(selected_keys) v ORDER BY 1
    LOOP PERFORM 1 FROM sessions WHERE id=item.session_id FOR UPDATE; END LOOP;
    SELECT jsonb_agg(to_jsonb(b) ORDER BY b.session_id,b.turn_index) INTO rows_json FROM (
        SELECT t.* FROM session_turns_original t JOIN jsonb_to_recordset(selected_keys) k(session_id uuid,turn_index integer)
            ON t.session_id=k.session_id AND t.turn_index=k.turn_index
        ORDER BY t.session_id,t.turn_index FOR UPDATE OF t) b;
    copied := coalesce(jsonb_array_length(rows_json),0);
    rows_json := coalesce(rows_json,'[]'::jsonb);
    FOR month_time IN SELECT DISTINCT date_trunc('month',(v->>'started_at')::timestamptz AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai' FROM jsonb_array_elements(rows_json) v LOOP
        PERFORM session_create_turn_month(month_time);
    END LOOP;
    marker := coalesce(current_setting('monkeyai.turns_mirror',true),'');
    PERFORM set_config('monkeyai.turns_mirror','copy',true);
    EXECUTE format('INSERT INTO %s SELECT * FROM jsonb_populate_recordset(NULL::%s,$1) ON CONFLICT (session_id,turn_index,started_at) DO NOTHING',progress.target_relation,progress.target_relation) USING rows_json;
    EXECUTE format('SELECT count(*) FROM jsonb_populate_recordset(NULL::%s,$1) a CROSS JOIN LATERAL
        (SELECT b.* FROM %s b WHERE b.session_id=a.session_id AND b.turn_index=a.turn_index AND b.started_at=a.started_at OFFSET 0) b WHERE to_jsonb(a)=to_jsonb(b)',progress.source_relation,progress.target_relation) INTO matched USING rows_json;
    PERFORM set_config('monkeyai.turns_mirror',marker,true);
    IF matched<>copied THEN RAISE EXCEPTION '轮次回填校验失败，游标保持不变'; END IF;
    UPDATE session_turns_partition_state SET cursor_session=(selected_keys->(scanned-1)->>'session_id')::uuid,cursor_turn=(selected_keys->(scanned-1)->>'turn_index')::integer,checked_rows=checked_rows+copied;
    RETURN scanned;
END;
$$;
CREATE FUNCTION session_cutover_turns() RETURNS boolean
LANGUAGE plpgsql SET search_path FROM CURRENT SET lock_timeout='2s' AS $$
DECLARE progress session_turns_partition_state; valid boolean; item record; definition text;
BEGIN
    IF NOT pg_try_advisory_xact_lock(hashtextextended(current_schema() || ':session-turns-monthly',0)) THEN RETURN false; END IF;
    SELECT * INTO STRICT progress FROM session_turns_partition_state FOR UPDATE;
    IF progress.phase='partitioned' THEN RETURN true; END IF;
    IF NOT progress.counts_ready THEN RETURN false; END IF;
    IF progress.end_session IS NOT NULL AND (progress.cursor_session IS NULL OR (progress.cursor_session,progress.cursor_turn)<(progress.end_session,progress.end_turn)) THEN RETURN false; END IF;
    EXECUTE format('SELECT NOT EXISTS(SELECT 1 FROM %s a FULL JOIN %s b USING(session_id,turn_index) WHERE to_jsonb(a) IS DISTINCT FROM to_jsonb(b))
        AND (SELECT count(*) FROM %s)=(SELECT count(*) FROM session_turns_keys)',progress.source_relation,progress.target_relation,progress.source_relation) INTO valid;
    IF NOT valid THEN RAISE EXCEPTION '轮次完整内容或登记映射校验失败'; END IF;
    EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE NOWAIT',progress.source_relation);
    EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE NOWAIT',progress.target_relation);
    FOR item IN SELECT conrelid,conname,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE contype='f' AND confrelid=progress.source_relation AND conparentid=0 ORDER BY conrelid,conname LOOP
        EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE NOWAIT',item.conrelid::regclass);
        definition := replace(item.definition,'REFERENCES ' || progress.source_relation::text || '(','REFERENCES session_turns_keys(');
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',item.conrelid::regclass,item.conname);
        EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s NOT VALID',item.conrelid::regclass,item.conname,definition);
    END LOOP;
    EXECUTE format('ALTER TABLE %s RENAME TO session_turns_legacy',progress.source_relation);
    EXECUTE format('ALTER TABLE %s RENAME TO session_turns',progress.target_relation);
    UPDATE session_turns_partition_state SET phase='partitioned',switched_at=clock_timestamp();
    RETURN true;
END;
$$;
CREATE FUNCTION session_finish_turn_observation() RETURNS boolean
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE progress session_turns_partition_state; item record;
BEGIN
    IF NOT pg_try_advisory_xact_lock(hashtextextended(current_schema() || ':session-turns-monthly',0)) THEN RETURN false; END IF;
    SELECT * INTO STRICT progress FROM session_turns_partition_state FOR UPDATE;
    IF progress.phase<>'partitioned' THEN RETURN false; END IF;
    EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE NOWAIT',progress.source_relation);
    EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE NOWAIT',progress.target_relation);
    FOR item IN SELECT conname FROM pg_constraint WHERE conrelid=progress.source_relation AND contype='f' LOOP
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',progress.source_relation,item.conname);
    END LOOP;
    UPDATE session_turns_partition_state SET mirror_legacy=false;
    RETURN true;
EXCEPTION WHEN lock_not_available THEN RETURN false;
END;
$$;
SELECT session_ensure_turn_months(clock_timestamp());
COMMIT;
