BEGIN;
SET LOCAL lock_timeout = '2s';

-- Preparation only: no full fact copy. Run with the old backend stopped.
CREATE TABLE billing_activity_partition_state (
    table_name text PRIMARY KEY CHECK (table_name IN ('billing_transactions','model_calls','mcp_tool_calls','image_calls','video_calls')),
    time_column text NOT NULL,
    source_relation regclass NOT NULL,
    target_relation regclass NOT NULL,
    phase text NOT NULL DEFAULT 'backfill' CHECK (phase IN ('backfill','partitioned')),
    source_end_at timestamptz,
    source_end_id uuid,
    cursor_at timestamptz,
    cursor_id uuid,
    checked_rows bigint NOT NULL DEFAULT 0,
    switched_at timestamptz,
    mirror_legacy boolean NOT NULL DEFAULT true
);

CREATE VIEW billing_transactions_original AS SELECT * FROM billing_transactions;
CREATE TABLE billing_transactions_keys (
    id uuid PRIMARY KEY,
    partition_at timestamptz NOT NULL CHECK (isfinite(partition_at)),
    user_id uuid NOT NULL,
    category text NOT NULL,
    idempotency_key text
);
CREATE UNIQUE INDEX billing_transaction_keys_idempotency_idx ON billing_transactions_keys(user_id,category,idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX billing_transactions_migration_time ON billing_transactions(started_at,id);
CREATE UNIQUE INDEX billing_transactions_migration_identity ON billing_transactions(id,started_at);
CREATE TABLE billing_transactions_partitioned (
    LIKE billing_transactions INCLUDING DEFAULTS INCLUDING CONSTRAINTS,
    PRIMARY KEY (id,started_at),
    FOREIGN KEY (id) REFERENCES billing_transactions_keys(id),
    CHECK (isfinite(started_at))
) PARTITION BY RANGE (started_at);
CREATE TABLE billing_transactions_default PARTITION OF billing_transactions_partitioned DEFAULT;
INSERT INTO billing_activity_partition_state(table_name,time_column,source_relation,target_relation)
VALUES ('billing_transactions','started_at','billing_transactions'::regclass,'billing_transactions_partitioned'::regclass);

CREATE VIEW model_calls_original AS SELECT * FROM model_calls;
CREATE TABLE model_calls_keys (
    id uuid PRIMARY KEY,
    partition_at timestamptz NOT NULL CHECK (isfinite(partition_at))
);
CREATE INDEX model_calls_migration_time ON model_calls(started_at,id);
CREATE UNIQUE INDEX model_calls_migration_identity ON model_calls(id,started_at);
CREATE TABLE model_calls_partitioned (
    LIKE model_calls INCLUDING DEFAULTS INCLUDING CONSTRAINTS,
    PRIMARY KEY (id,started_at),
    FOREIGN KEY (id) REFERENCES model_calls_keys(id),
    CHECK (isfinite(started_at))
) PARTITION BY RANGE (started_at);
CREATE TABLE model_calls_default PARTITION OF model_calls_partitioned DEFAULT;
INSERT INTO billing_activity_partition_state(table_name,time_column,source_relation,target_relation)
VALUES ('model_calls','started_at','model_calls'::regclass,'model_calls_partitioned'::regclass);

CREATE VIEW mcp_tool_calls_original AS SELECT * FROM mcp_tool_calls;
CREATE TABLE mcp_tool_calls_keys (
    id uuid PRIMARY KEY,
    partition_at timestamptz NOT NULL CHECK (isfinite(partition_at))
);
CREATE INDEX mcp_tool_calls_migration_time ON mcp_tool_calls(started_at,id);
CREATE UNIQUE INDEX mcp_tool_calls_migration_identity ON mcp_tool_calls(id,started_at);
CREATE TABLE mcp_tool_calls_partitioned (
    LIKE mcp_tool_calls INCLUDING DEFAULTS INCLUDING CONSTRAINTS,
    PRIMARY KEY (id,started_at),
    FOREIGN KEY (id) REFERENCES mcp_tool_calls_keys(id),
    CHECK (isfinite(started_at))
) PARTITION BY RANGE (started_at);
CREATE TABLE mcp_tool_calls_default PARTITION OF mcp_tool_calls_partitioned DEFAULT;
INSERT INTO billing_activity_partition_state(table_name,time_column,source_relation,target_relation)
VALUES ('mcp_tool_calls','started_at','mcp_tool_calls'::regclass,'mcp_tool_calls_partitioned'::regclass);

CREATE VIEW image_calls_original AS SELECT * FROM image_calls;
CREATE TABLE image_calls_keys (
    id uuid PRIMARY KEY,
    partition_at timestamptz NOT NULL CHECK (isfinite(partition_at)),
    billing_transaction_id uuid UNIQUE,
    job_id uuid UNIQUE
);
CREATE INDEX image_calls_migration_time ON image_calls(started_at,id);
CREATE UNIQUE INDEX image_calls_migration_identity ON image_calls(id,started_at);
CREATE TABLE image_calls_partitioned (
    LIKE image_calls INCLUDING DEFAULTS INCLUDING CONSTRAINTS,
    PRIMARY KEY (id,started_at),
    FOREIGN KEY (id) REFERENCES image_calls_keys(id),
    CHECK (isfinite(started_at))
) PARTITION BY RANGE (started_at);
CREATE TABLE image_calls_default PARTITION OF image_calls_partitioned DEFAULT;
INSERT INTO billing_activity_partition_state(table_name,time_column,source_relation,target_relation)
VALUES ('image_calls','started_at','image_calls'::regclass,'image_calls_partitioned'::regclass);

CREATE VIEW video_calls_original AS SELECT * FROM video_calls;
CREATE TABLE video_calls_keys (
    id uuid PRIMARY KEY,
    partition_at timestamptz NOT NULL CHECK (isfinite(partition_at)),
    billing_transaction_id uuid UNIQUE,
    job_id uuid UNIQUE NOT NULL
);
CREATE INDEX video_calls_migration_time ON video_calls(created_at,id);
CREATE UNIQUE INDEX video_calls_migration_identity ON video_calls(id,created_at);
CREATE TABLE video_calls_partitioned (
    LIKE video_calls INCLUDING DEFAULTS INCLUDING CONSTRAINTS,
    PRIMARY KEY (id,created_at),
    FOREIGN KEY (id) REFERENCES video_calls_keys(id),
    CHECK (isfinite(created_at))
) PARTITION BY RANGE (created_at);
CREATE TABLE video_calls_default PARTITION OF video_calls_partitioned DEFAULT;
INSERT INTO billing_activity_partition_state(table_name,time_column,source_relation,target_relation)
VALUES ('video_calls','created_at','video_calls'::regclass,'video_calls_partitioned'::regclass);

CREATE UNIQUE INDEX video_calls_migration_job ON video_calls(job_id,created_at);
CREATE UNIQUE INDEX video_calls_weekly_job ON video_calls_partitioned(job_id,created_at);
-- Pending work stays small even when completed history becomes large.
CREATE INDEX billing_transactions_weekly_pending ON billing_transactions_partitioned(started_at,id)
    WHERE status NOT IN ('settled','released','rejected');

-- Relation identity, rather than an MVCC phase flag, also excludes stale
-- pre-cutover snapshots from treating a read-only legacy copy as authoritative.
CREATE FUNCTION billing_activity_backfilling(kind text) RETURNS boolean
LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
    SELECT source_relation=to_regclass(table_name) FROM billing_activity_partition_state WHERE table_name=kind;
$$;

-- Indexed routing also works before the historical key backfill reaches an ID.
CREATE FUNCTION billing_activity_time(kind text,entry_id uuid) RETURNS timestamptz
LANGUAGE plpgsql STABLE SET search_path FROM CURRENT AS $$
DECLARE at_time timestamptz; clock_column text;
BEGIN
    SELECT time_column INTO STRICT clock_column FROM billing_activity_partition_state WHERE table_name=kind;
    EXECUTE format('SELECT partition_at FROM %I WHERE id=$1',kind || '_keys') INTO at_time USING entry_id;
    IF at_time IS NULL AND billing_activity_backfilling(kind) THEN
        EXECUTE format('SELECT %I FROM %I WHERE id=$1',clock_column,kind || '_original') INTO at_time USING entry_id;
    END IF;
    RETURN at_time;
END;
$$;

CREATE FUNCTION billing_activity_key_payload(kind text, data jsonb, time_column text) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
    SELECT jsonb_build_object('id',data->'id','partition_at',data->time_column) ||
        CASE WHEN kind='billing_transactions' THEN jsonb_build_object('user_id',data->'user_id','category',data->'category','idempotency_key',data->'idempotency_key')
             WHEN kind IN ('image_calls','video_calls') THEN jsonb_build_object('billing_transaction_id',data->'billing_transaction_id','job_id',data->'job_id')
             ELSE '{}'::jsonb END;
$$;

CREATE FUNCTION billing_activity_register_key() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE kind text := TG_ARGV[0]; clock_column text := TG_ARGV[1]; keys_table regclass;
    desired jsonb; existing jsonb; original jsonb; transaction_id uuid;
BEGIN
    keys_table := to_regclass(format('%I.%I',current_schema(),kind || '_keys'));
    desired := billing_activity_key_payload(kind,to_jsonb(NEW),clock_column);
    IF TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR to_jsonb(NEW)->clock_column IS DISTINCT FROM to_jsonb(OLD)->clock_column) THEN
        RAISE EXCEPTION '调用/交易的全局 ID 和分区时间不可修改' USING ERRCODE='23505';
    END IF;
    EXECUTE format('SELECT to_jsonb(k) FROM %s k WHERE id=$1',keys_table) INTO existing USING NEW.id;
    IF existing IS NULL THEN
        -- A previously unvisited historical identity still owns its global ID.
        IF TG_OP='UPDATE' THEN
            original := to_jsonb(OLD);
        ELSIF billing_activity_backfilling(kind) THEN
            EXECUTE format('SELECT to_jsonb(t) FROM %I t WHERE id=$1',kind || '_original') INTO original USING NEW.id;
        END IF;
        EXECUTE format('INSERT INTO %s SELECT (jsonb_populate_record(NULL::%s,$1)).* ON CONFLICT (id) DO NOTHING',keys_table,keys_table)
            USING CASE WHEN original IS NULL THEN desired ELSE billing_activity_key_payload(kind,original,clock_column) END;
        EXECUTE format('SELECT to_jsonb(k) FROM %s k WHERE id=$1',keys_table) INTO STRICT existing USING NEW.id;
    END IF;
    IF existing->'partition_at' IS DISTINCT FROM desired->'partition_at'
       OR (kind='billing_transactions' AND (existing - 'partition_at' - 'id') IS DISTINCT FROM (desired - 'partition_at' - 'id')) THEN
        RAISE EXCEPTION '跨周重复 ID 或幂等身份不一致: %',NEW.id USING ERRCODE='23505';
    END IF;
    IF kind IN ('image_calls','video_calls') THEN
        transaction_id := (to_jsonb(NEW)->>'billing_transaction_id')::uuid;
        IF transaction_id IS NOT NULL AND billing_activity_backfilling('billing_transactions')
           AND NOT EXISTS(SELECT 1 FROM billing_transactions_keys WHERE id=transaction_id) THEN
            INSERT INTO billing_transactions_keys
            SELECT id,started_at,user_id,category,idempotency_key FROM billing_transactions_original WHERE id=transaction_id
            ON CONFLICT (id) DO NOTHING;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION billing_activity_mirror() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE kind text := TG_ARGV[0]; direction text := TG_ARGV[1]; progress billing_activity_partition_state;
    marker text := coalesce(current_setting('monkeyai.activity_mirror',true),'');
    destination regclass; assignments text; data jsonb; clock_column text; keys_table regclass;
BEGIN
    -- Nested changes to a DIFFERENT table (billing -> model usage_known) must mirror.
    IF position(',' || kind || ',' IN marker)>0 THEN RETURN NULL; END IF;
    SELECT * INTO STRICT progress FROM billing_activity_partition_state WHERE table_name=kind;
    IF direction='reverse' AND progress.target_relation<>to_regclass(kind) THEN RETURN NULL; END IF;
    IF direction='forward' AND progress.target_relation=to_regclass(kind) THEN
        RAISE EXCEPTION '周分区已切换，请重试旧事务' USING ERRCODE='40001';
    END IF;
    data := CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
    keys_table := to_regclass(format('%I.%I',current_schema(),kind || '_keys'));
    IF TG_OP<>'DELETE' AND kind IN ('image_calls','video_calls') THEN
        EXECUTE format('UPDATE %s SET billing_transaction_id=$2,job_id=$3 WHERE id=$1 AND (billing_transaction_id,job_id) IS DISTINCT FROM ($2,$3)',keys_table)
            USING NEW.id,(data->>'billing_transaction_id')::uuid,(data->>'job_id')::uuid;
    END IF;
    IF direction='forward' OR progress.mirror_legacy THEN
        destination := CASE WHEN direction='forward' THEN progress.target_relation ELSE progress.source_relation END;
        PERFORM set_config('monkeyai.activity_mirror',marker || ',' || kind || ',',true);
        IF TG_OP='DELETE' THEN
            EXECUTE format('DELETE FROM %s WHERE id=$1 AND %I=$2',destination,progress.time_column)
                USING OLD.id,(data->>progress.time_column)::timestamptz;
        ELSE
            SELECT string_agg(format('%1$I=EXCLUDED.%1$I',attname),',' ORDER BY attnum) INTO assignments
                FROM pg_attribute WHERE attrelid=destination AND attnum>0 AND NOT attisdropped AND attname NOT IN ('id',progress.time_column);
            EXECUTE format('INSERT INTO %s SELECT (jsonb_populate_record(NULL::%s,$1)).* ON CONFLICT (id,%I) DO UPDATE SET %s',destination,destination,progress.time_column,assignments)
                USING data;
        END IF;
        PERFORM set_config('monkeyai.activity_mirror',marker,true);
    END IF;
    IF TG_OP='DELETE' THEN
        EXECUTE format('DELETE FROM %s WHERE id=$1',keys_table) USING OLD.id;
    END IF;
    RETURN NULL;
END;
$$;

CREATE FUNCTION billing_create_activity_week(kind text,at_time timestamptz,move_limit integer DEFAULT 10000) RETURNS void
LANGUAGE plpgsql SET search_path FROM CURRENT SET lock_timeout='2s' AS $$
DECLARE progress billing_activity_partition_state; starts_at timestamptz; ends_at timestamptz;
    part_name text; part_table regclass; default_table regclass; pending integer; marker text;
BEGIN
    IF NOT isfinite(at_time) OR move_limit<0 THEN RAISE EXCEPTION '周分区时间或迁移上限无效'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(current_schema() || ':billing-activity:' || kind,0));
    SELECT * INTO STRICT progress FROM billing_activity_partition_state WHERE table_name=kind;
    starts_at := date_trunc('week',at_time AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai';
    ends_at := (starts_at AT TIME ZONE 'Asia/Shanghai' + interval '1 week') AT TIME ZONE 'Asia/Shanghai';
    part_name := kind || '_' || to_char(starts_at AT TIME ZONE 'Asia/Shanghai','YYYYMMDD');
    part_table := to_regclass(format('%I.%I',current_schema(),part_name));
    IF part_table IS NOT NULL THEN
        IF NOT EXISTS(SELECT 1 FROM pg_inherits WHERE inhrelid=part_table AND inhparent=progress.target_relation) THEN
            RAISE EXCEPTION '周分区名称已被占用: %',part_name;
        END IF;
        RETURN;
    END IF;
    default_table := to_regclass(format('%I.%I',current_schema(),kind || '_default'));
    IF move_limit>0 THEN
        EXECUTE format('SELECT count(*) FROM (SELECT 1 FROM %s LIMIT $1) pending',default_table) INTO pending USING move_limit+1;
        IF pending>move_limit THEN RAISE EXCEPTION '默认分区总积压超限，需维护窗口逐周迁移' USING ERRCODE='55000'; END IF;
    END IF;
    EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE NOWAIT',progress.target_relation);
    IF move_limit>0 THEN
        EXECUTE format('SELECT count(*) FROM (SELECT 1 FROM %s LIMIT $1) pending',default_table) INTO pending USING move_limit+1;
        IF pending>move_limit THEN RAISE EXCEPTION '默认分区总积压超限，需维护窗口逐周迁移' USING ERRCODE='55000'; END IF;
    END IF;
    EXECUTE format('CREATE TABLE %I (LIKE %s INCLUDING DEFAULTS INCLUDING CONSTRAINTS)',part_name,progress.target_relation);
    -- Physical relocation is not a logical delete. Preserve keys, mirrors and projections.
    marker := coalesce(current_setting('monkeyai.activity_mirror',true),'');
    PERFORM set_config('monkeyai.activity_mirror',marker || ',' || kind || ',',true);
    EXECUTE format('WITH moved AS (DELETE FROM %s WHERE %I >= $1 AND %I < $2 RETURNING *) INSERT INTO %I SELECT * FROM moved',default_table,progress.time_column,progress.time_column,part_name)
        USING starts_at,ends_at;
    PERFORM set_config('monkeyai.activity_mirror',marker,true);
    EXECUTE format('ALTER TABLE %s ATTACH PARTITION %I FOR VALUES FROM (%L) TO (%L)',progress.target_relation,part_name,starts_at,ends_at);
END;
$$;

CREATE FUNCTION billing_ensure_activity_weeks(kind text,at_time timestamptz) RETURNS boolean
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE progress billing_activity_partition_state; i integer; pending integer; week_time timestamptz;
BEGIN
    IF NOT pg_try_advisory_xact_lock(hashtextextended(current_schema() || ':billing-activity:' || kind,0)) THEN RETURN false; END IF;
    SELECT * INTO STRICT progress FROM billing_activity_partition_state WHERE table_name=kind;
    EXECUTE format('SELECT count(*) FROM (SELECT 1 FROM %I LIMIT 10001) pending',kind || '_default') INTO pending;
    IF pending>10000 THEN RAISE EXCEPTION '默认分区总积压超限，需维护窗口逐周迁移' USING ERRCODE='55000'; END IF;
    FOR i IN 0..8 LOOP
        PERFORM billing_create_activity_week(kind,(date_trunc('week',at_time AT TIME ZONE 'Asia/Shanghai') + i*interval '7 days') AT TIME ZONE 'Asia/Shanghai');
    END LOOP;
    FOR week_time IN EXECUTE format('SELECT DISTINCT date_trunc(''week'',%I AT TIME ZONE ''Asia/Shanghai'') AT TIME ZONE ''Asia/Shanghai'' FROM %I ORDER BY 1',progress.time_column,kind || '_default')
    LOOP PERFORM billing_create_activity_week(kind,week_time); END LOOP;
    RETURN true;
END;
$$;

CREATE FUNCTION billing_copy_activity_batch(kind text,batch_size integer) RETURNS integer
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE progress billing_activity_partition_state; batch_ids uuid[]; batch_times timestamptz[];
    batch_count integer; matched integer;
BEGIN
    IF batch_size<1 OR batch_size>10000 THEN RAISE EXCEPTION '迁移批次必须为 1 到 10000'; END IF;
    IF NOT pg_try_advisory_xact_lock(hashtextextended(current_schema() || ':billing-activity:' || kind,0)) THEN RETURN -2; END IF;
    SELECT * INTO STRICT progress FROM billing_activity_partition_state WHERE table_name=kind FOR UPDATE;
    IF progress.phase='partitioned' THEN RETURN -1; END IF;
    IF kind<>'billing_transactions' AND NOT EXISTS(SELECT 1 FROM billing_activity_partition_state WHERE table_name='billing_transactions' AND phase='partitioned') THEN RETURN -2; END IF;
    IF progress.source_end_at IS NULL THEN RETURN 0; END IF;
    -- Lock source rows before copying: an UPDATE/DELETE cannot race a stale backfill
    -- snapshot and resurrect a deleted row or replace a newer mirrored version.
    EXECUTE format('SELECT array_agg(id ORDER BY %1$I,id),array_agg(%1$I ORDER BY %1$I,id) FROM
        (SELECT id,%1$I FROM %2$s WHERE ($1::timestamptz IS NULL OR (%1$I,id)>($1,$2))
         AND (%1$I,id)<=($4,$5) ORDER BY %1$I,id LIMIT $3 FOR UPDATE) batch',progress.time_column,progress.source_relation)
        INTO batch_ids,batch_times USING progress.cursor_at,progress.cursor_id,batch_size,progress.source_end_at,progress.source_end_id;
    batch_count := coalesce(cardinality(batch_ids),0);
    IF batch_count=0 THEN
        -- The original watermark row may have been legitimately deleted.
        UPDATE billing_activity_partition_state SET cursor_at=source_end_at,cursor_id=source_end_id WHERE table_name=kind;
        RETURN 0;
    END IF;
    EXECUTE format('INSERT INTO %s SELECT * FROM %s WHERE id=ANY($1) ON CONFLICT (id,%I) DO NOTHING',progress.target_relation,progress.source_relation,progress.time_column) USING batch_ids;
    -- Keep the checked batch on its own weeks; an ID-only join probes every
    -- historical partition once per source row as the partition count grows.
    EXECUTE format('SELECT count(*) FROM %1$s a CROSS JOIN LATERAL
        (SELECT b.* FROM %2$s b WHERE b.id=a.id AND b.%3$I=a.%3$I OFFSET 0) b
        WHERE a.id=ANY($1) AND to_jsonb(a)=to_jsonb(b)',progress.source_relation,progress.target_relation,progress.time_column)
        INTO matched USING batch_ids;
    IF matched<>batch_count THEN RAISE EXCEPTION '交易/调用回填校验失败，游标保持不变'; END IF;
    UPDATE billing_activity_partition_state SET cursor_at=batch_times[batch_count],cursor_id=batch_ids[batch_count],checked_rows=checked_rows+batch_count WHERE table_name=kind;
    RETURN batch_count;
END;
$$;

-- Copy/move statement triggers, including transition aliases, exactly once. The
-- model hourly projection must follow the authoritative relation, never a mirror.
CREATE FUNCTION billing_activity_move_stats(old_relation regclass,new_relation regclass) RETURNS void
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE item record; definition text; old_name text; new_name text;
BEGIN
    SELECT format('%I.%I',n.nspname,c.relname) INTO old_name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.oid=old_relation;
    SELECT format('%I.%I',n.nspname,c.relname) INTO new_name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.oid=new_relation;
    FOR item IN SELECT tgname,pg_get_triggerdef(oid) definition FROM pg_trigger
        WHERE tgrelid=old_relation AND NOT tgisinternal AND tgname LIKE 'stats_%' ORDER BY tgname
    LOOP
        definition := replace(item.definition,' ON ' || old_name || ' ',' ON ' || new_name || ' ');
        IF definition=item.definition THEN RAISE EXCEPTION '无法迁移统计触发器: %',item.tgname; END IF;
        EXECUTE format('DROP TRIGGER %I ON %s',item.tgname,old_relation);
        EXECUTE definition;
    END LOOP;
END;
$$;

CREATE FUNCTION billing_cutover_activity(kind text) RETURNS boolean
LANGUAGE plpgsql SET search_path FROM CURRENT SET lock_timeout='2s' AS $$
DECLARE progress billing_activity_partition_state; valid boolean; item record; definition text;
BEGIN
    IF NOT pg_try_advisory_xact_lock(hashtextextended(current_schema() || ':billing-activity:' || kind,0)) THEN RETURN false; END IF;
    SELECT * INTO STRICT progress FROM billing_activity_partition_state WHERE table_name=kind FOR UPDATE;
    IF progress.phase='partitioned' THEN RETURN true; END IF;
    IF progress.source_end_at IS NOT NULL AND (progress.cursor_at IS NULL OR (progress.cursor_at,progress.cursor_id)<(progress.source_end_at,progress.source_end_id)) THEN RETURN false; END IF;
    IF kind<>'billing_transactions' AND NOT EXISTS(SELECT 1 FROM billing_activity_partition_state WHERE table_name='billing_transactions' AND phase='partitioned') THEN RETURN false; END IF;
    -- Both copies are changed atomically, so a single snapshot can compare mutable rows.
    EXECUTE format('SELECT NOT EXISTS(SELECT 1 FROM %s a FULL JOIN %s b USING (id) WHERE to_jsonb(a) IS DISTINCT FROM to_jsonb(b))
        AND (SELECT count(*) FROM %s)=(SELECT count(*) FROM %I)',progress.source_relation,progress.target_relation,progress.source_relation,kind || '_keys') INTO valid;
    IF NOT valid THEN RAISE EXCEPTION '交易/调用全量内容或登记笔数校验失败'; END IF;
    EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE NOWAIT',progress.source_relation);
    EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE NOWAIT',progress.target_relation);
    IF kind='billing_transactions' THEN
        -- Keep all incoming IDs valid after the partition parent loses UNIQUE(id).
        -- Existing rows were protected by their original FK; new registry keys have
        -- now been fully checked. NOT VALID avoids a second historical table scan.
        FOR item IN SELECT conrelid,conname,pg_get_constraintdef(oid) definition FROM pg_constraint
            WHERE contype='f' AND confrelid=progress.source_relation AND conparentid=0 ORDER BY conrelid,conname
        LOOP
            EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE NOWAIT',item.conrelid::regclass);
            definition := replace(item.definition,'REFERENCES ' || progress.source_relation::text || '(','REFERENCES billing_transactions_keys(');
            EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',item.conrelid::regclass,item.conname);
            EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s NOT VALID',item.conrelid::regclass,item.conname,definition);
        END LOOP;
    END IF;
    EXECUTE format('ALTER TABLE %s RENAME TO %I',progress.source_relation,kind || '_legacy');
    EXECUTE format('ALTER TABLE %s RENAME TO %I',progress.target_relation,kind);
    PERFORM billing_activity_move_stats(progress.source_relation,progress.target_relation);
    UPDATE billing_activity_partition_state SET phase='partitioned',switched_at=clock_timestamp() WHERE table_name=kind;
    RETURN true;
END;
$$;

CREATE FUNCTION billing_finish_activity_observation() RETURNS boolean
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE progress billing_activity_partition_state; item record;
BEGIN
    FOR progress IN SELECT * FROM billing_activity_partition_state ORDER BY table_name LOOP
        IF NOT pg_try_advisory_xact_lock(hashtextextended(current_schema() || ':billing-activity:' || progress.table_name,0)) THEN RETURN false; END IF;
    END LOOP;
    IF EXISTS(SELECT 1 FROM billing_activity_partition_state WHERE phase<>'partitioned') THEN RETURN false; END IF;
    IF NOT EXISTS(SELECT 1 FROM billing_activity_partition_state WHERE mirror_legacy) THEN RETURN true; END IF;
    FOR progress IN SELECT * FROM billing_activity_partition_state ORDER BY table_name LOOP
        EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE NOWAIT',progress.source_relation);
        EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE NOWAIT',progress.target_relation);
    END LOOP;
    -- Legacy copies become read-only snapshots. Their historical FKs must not
    -- prevent a later legitimate purge in the authoritative call tables.
    FOR item IN SELECT c.conrelid,c.conname FROM pg_constraint c JOIN billing_activity_partition_state s ON s.source_relation=c.conrelid
        WHERE c.contype='f' AND c.conparentid=0
    LOOP EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',item.conrelid::regclass,item.conname); END LOOP;
    UPDATE billing_activity_partition_state SET mirror_legacy=false;
    RETURN true;
EXCEPTION WHEN lock_not_available THEN RETURN false;
END;
$$;

-- Clone nonunique access paths and original business FKs onto each empty parent.
DO $$
DECLARE progress billing_activity_partition_state; item record; definition text; first_at timestamptz; last_at timestamptz; week_at timestamptz;
BEGIN
    FOR progress IN SELECT * FROM billing_activity_partition_state ORDER BY table_name LOOP
        FOR item IN SELECT indexrelid,pg_get_indexdef(indexrelid) definition FROM pg_index WHERE indrelid=progress.source_relation AND NOT indisunique LOOP
            EXECUTE format('CREATE INDEX %I ON %s %s',item.indexrelid::regclass::text || '_weekly',progress.target_relation,substring(item.definition FROM 'USING .*'));
        END LOOP;
        FOR item IN SELECT conname,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid=progress.source_relation AND contype='f' AND conparentid=0 LOOP
            definition := replace(item.definition,'REFERENCES billing_transactions(','REFERENCES billing_transactions_keys(');
            EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s',progress.target_relation,item.conname,definition);
        END LOOP;
        -- The ordinary source enforces its own unique constraints first. An
        -- INSERT ignored by ON CONFLICT must not leave a registry-only identity.
        -- The partition target still registers BEFORE its id-registry FK check.
        EXECUTE format('CREATE TRIGGER activity_key AFTER INSERT OR UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION billing_activity_register_key(%L,%L)',progress.source_relation,progress.table_name,progress.time_column);
        EXECUTE format('CREATE TRIGGER activity_key BEFORE INSERT OR UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION billing_activity_register_key(%L,%L)',progress.target_relation,progress.table_name,progress.time_column);
        EXECUTE format('CREATE TRIGGER activity_mirror AFTER INSERT OR UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION billing_activity_mirror(%L,''forward'')',progress.source_relation,progress.table_name);
        EXECUTE format('CREATE TRIGGER activity_mirror AFTER INSERT OR UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION billing_activity_mirror(%L,''reverse'')',progress.target_relation,progress.table_name);
        EXECUTE format('SELECT min(%1$I),max(%1$I) FROM %2$s',progress.time_column,progress.source_relation) INTO first_at,last_at;
        IF first_at IS NOT NULL THEN
            IF NOT isfinite(first_at) OR NOT isfinite(last_at) THEN RAISE EXCEPTION '历史调用/交易含非有限时间'; END IF;
            FOR week_at IN SELECT local_week AT TIME ZONE 'Asia/Shanghai' FROM generate_series(date_trunc('week',first_at AT TIME ZONE 'Asia/Shanghai'),date_trunc('week',last_at AT TIME ZONE 'Asia/Shanghai'),interval '7 days') local_week
            LOOP PERFORM billing_create_activity_week(progress.table_name,week_at); END LOOP;
        END IF;
        PERFORM billing_ensure_activity_weeks(progress.table_name,clock_timestamp());
        EXECUTE format('SELECT %I,id FROM %s ORDER BY %I DESC,id DESC LIMIT 1',progress.time_column,progress.source_relation,progress.time_column) INTO last_at,progress.source_end_id;
        UPDATE billing_activity_partition_state SET source_end_at=last_at,source_end_id=progress.source_end_id WHERE table_name=progress.table_name;
    END LOOP;
END;
$$;
-- Keep per-call projection maintenance bounded after transaction/call partitioning.
CREATE OR REPLACE FUNCTION stats_model_usage_known() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
    NEW.usage_known := coalesce(
        (SELECT (b.usage->>'known')::boolean FROM billing_transactions b WHERE b.id=NEW.id
         AND b.started_at=(SELECT billing_activity_time('billing_transactions',NEW.id))),
        coalesce(NEW.error_code,'')='');
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION stats_model_billing_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE first_at timestamptz; last_at timestamptz;
BEGIN
    IF TG_OP='INSERT' THEN
        SELECT min(billing_activity_time('model_calls',b.id)),max(billing_activity_time('model_calls',b.id))
            INTO first_at,last_at FROM inserted_billing b;
        UPDATE model_calls c SET usage_known=coalesce((b.usage->>'known')::boolean,coalesce(c.error_code,'')='')
        FROM inserted_billing b WHERE c.id=b.id AND c.started_at>=first_at AND c.started_at<=last_at
            AND c.usage_known IS DISTINCT FROM coalesce((b.usage->>'known')::boolean,coalesce(c.error_code,'')='');
    ELSIF TG_OP='UPDATE' THEN
        SELECT min(billing_activity_time('model_calls',b.id)),max(billing_activity_time('model_calls',b.id))
            INTO first_at,last_at FROM updated_billing b JOIN previous_billing old_b ON old_b.id=b.id
            WHERE (b.usage->>'known') IS DISTINCT FROM (old_b.usage->>'known');
        UPDATE model_calls c SET usage_known=coalesce((b.usage->>'known')::boolean,coalesce(c.error_code,'')='')
        FROM updated_billing b JOIN previous_billing old_b ON old_b.id=b.id
        WHERE c.id=b.id AND c.started_at>=first_at AND c.started_at<=last_at
            AND (b.usage->>'known') IS DISTINCT FROM (old_b.usage->>'known')
            AND c.usage_known IS DISTINCT FROM coalesce((b.usage->>'known')::boolean,coalesce(c.error_code,'')='');
    ELSE
        SELECT min(billing_activity_time('model_calls',b.id)),max(billing_activity_time('model_calls',b.id))
            INTO first_at,last_at FROM deleted_billing b;
        UPDATE model_calls c SET usage_known=coalesce(c.error_code,'')=''
        FROM deleted_billing b WHERE c.id=b.id AND c.started_at>=first_at AND c.started_at<=last_at
            AND c.usage_known IS DISTINCT FROM (coalesce(c.error_code,'')='');
    END IF;
    RETURN NULL;
END;
$$;
COMMIT;
