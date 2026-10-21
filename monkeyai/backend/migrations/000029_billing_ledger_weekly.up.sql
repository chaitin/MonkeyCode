BEGIN;

-- The view keeps the original relation OID across cutover for indexed migration fallbacks.
CREATE VIEW billing_ledger_original_entries AS SELECT * FROM credit_ledger_entries;

-- Keep global identities outside the time partitions. No financial fields live here.
CREATE TABLE credit_ledger_entry_keys (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL,
    event_key text,
    sequence bigint,
    transaction_id uuid,
    occurred_at timestamptz NOT NULL CHECK (isfinite(occurred_at)),
    user_id uuid NOT NULL,
    session_id uuid,
    group_id uuid
);
CREATE UNIQUE INDEX ledger_keys_event_idx ON credit_ledger_entry_keys(event_key) WHERE event_key IS NOT NULL;
CREATE UNIQUE INDEX ledger_keys_sequence_idx ON credit_ledger_entry_keys(account_id, sequence);
CREATE INDEX ledger_keys_transaction_idx ON credit_ledger_entry_keys(transaction_id, occurred_at, id) WHERE transaction_id IS NOT NULL;
CREATE TRIGGER ledger_keys_immutable BEFORE UPDATE OR DELETE ON credit_ledger_entry_keys
FOR EACH ROW EXECUTE FUNCTION billing_immutable_ledger();

CREATE TABLE credit_ledger_entries_partitioned (
    LIKE credit_ledger_entries INCLUDING DEFAULTS INCLUDING CONSTRAINTS,
    PRIMARY KEY (id, occurred_at),
    FOREIGN KEY (id) REFERENCES credit_ledger_entry_keys(id),
    FOREIGN KEY (reverses_id) REFERENCES credit_ledger_entry_keys(id),
    CHECK (isfinite(occurred_at))
) PARTITION BY RANGE (occurred_at);
CREATE INDEX ledger_weekly_time_idx ON credit_ledger_entries_partitioned(occurred_at DESC, id DESC);
CREATE INDEX ledger_weekly_account_idx ON credit_ledger_entries_partitioned(account_id, occurred_at DESC);
CREATE INDEX ledger_weekly_user_idx ON credit_ledger_entries_partitioned(user_id, occurred_at DESC);
CREATE INDEX ledger_weekly_transaction_idx ON credit_ledger_entries_partitioned(transaction_id) WHERE transaction_id IS NOT NULL;
CREATE INDEX ledger_weekly_session_idx ON credit_ledger_entries_partitioned(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX ledger_weekly_source_idx ON credit_ledger_entries_partitioned(source_type, source_id) WHERE source_type IS NOT NULL AND source_id IS NOT NULL;
CREATE TABLE credit_ledger_entries_default PARTITION OF credit_ledger_entries_partitioned DEFAULT;
CREATE TRIGGER credit_ledger_immutable BEFORE UPDATE OR DELETE ON credit_ledger_entries_partitioned
FOR EACH ROW EXECUTE FUNCTION billing_immutable_ledger();

CREATE TABLE billing_ledger_partition_state (
    id boolean PRIMARY KEY DEFAULT true CHECK (id),
    phase text NOT NULL DEFAULT 'backfill' CHECK (phase IN ('backfill', 'partitioned')),
    source_relation regclass NOT NULL,
    target_relation regclass NOT NULL,
    source_end_at timestamptz,
    source_end_id uuid,
    cursor_at timestamptz,
    cursor_id uuid,
    checked_rows bigint NOT NULL DEFAULT 0,
    switched_at timestamptz,
    mirror_legacy boolean NOT NULL DEFAULT true
);
INSERT INTO billing_ledger_partition_state(source_relation, target_relation)
VALUES ('credit_ledger_entries'::regclass, 'credit_ledger_entries_partitioned'::regclass);

CREATE FUNCTION billing_register_ledger_key() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE original record; identity_row credit_ledger_entry_keys; source_table regclass;
BEGIN
    -- During backfill a refund can precede the batch containing its original charge.
    IF NEW.reverses_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM credit_ledger_entry_keys WHERE id = NEW.reverses_id) THEN
        SELECT source_relation INTO source_table FROM billing_ledger_partition_state;
        EXECUTE format('SELECT id, account_id, event_key, sequence, transaction_id, occurred_at, user_id, session_id, group_id FROM %s WHERE id = $1', source_table)
            INTO original USING NEW.reverses_id;
        IF original.id IS NOT NULL THEN
            INSERT INTO credit_ledger_entry_keys VALUES (original.id, original.account_id, original.event_key,
                original.sequence, original.transaction_id, original.occurred_at, original.user_id, original.session_id, original.group_id) ON CONFLICT (id) DO NOTHING;
        END IF;
    END IF;
    INSERT INTO credit_ledger_entry_keys(id, account_id, event_key, sequence, transaction_id, occurred_at, user_id, session_id, group_id)
    VALUES (NEW.id, NEW.account_id, NEW.event_key, NEW.sequence, NEW.transaction_id, NEW.occurred_at, NEW.user_id, NEW.session_id, NEW.group_id)
    ON CONFLICT (id) DO NOTHING;
    SELECT * INTO STRICT identity_row FROM credit_ledger_entry_keys WHERE id = NEW.id;
    IF ROW(identity_row.account_id, identity_row.event_key, identity_row.sequence, identity_row.transaction_id, identity_row.occurred_at,
        identity_row.user_id, identity_row.session_id, identity_row.group_id)
        IS DISTINCT FROM ROW(NEW.account_id, NEW.event_key, NEW.sequence, NEW.transaction_id, NEW.occurred_at,
        NEW.user_id, NEW.session_id, NEW.group_id) THEN
        RAISE EXCEPTION '流水全局标识与账本内容不一致: %', NEW.id USING ERRCODE = '23505';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER ledger_register_key BEFORE INSERT ON credit_ledger_entries_partitioned
FOR EACH ROW EXECUTE FUNCTION billing_register_ledger_key();

-- Both directions are guarded: stale statements targeting the old relation remain safe
-- after rename, while the legacy copy stays current throughout the observation window.
CREATE FUNCTION billing_mirror_ledger() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE destination regclass; current_phase text; keep_legacy boolean;
BEGIN
    IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
    SELECT phase, CASE WHEN TG_ARGV[0] = 'forward' THEN target_relation ELSE source_relation END
        , mirror_legacy INTO current_phase, destination, keep_legacy FROM billing_ledger_partition_state;
    -- A transaction can retain a pre-cutover snapshot of phase. The actual relation
    -- name follows transactional DDL even then; never omit its rollback mirror.
    IF TG_ARGV[0] = 'reverse' AND (TG_TABLE_NAME <> 'credit_ledger_entries' OR NOT keep_legacy) THEN RETURN NULL; END IF;
    IF TG_ARGV[0] = 'forward' AND current_phase = 'partitioned' AND NOT keep_legacy THEN
        RAISE EXCEPTION '旧账本观察期已结束，请重试向账本父表写入';
    END IF;
    IF TG_ARGV[0] = 'forward' THEN
        EXECUTE format('INSERT INTO %s SELECT * FROM mirrored_ledger_rows ON CONFLICT (id, occurred_at) DO NOTHING', destination);
    ELSE
        EXECUTE format('INSERT INTO %s SELECT * FROM mirrored_ledger_rows ON CONFLICT (id) DO NOTHING', destination);
    END IF;
    RETURN NULL;
END;
$$;
CREATE TRIGGER billing_ledger_reverse AFTER INSERT ON credit_ledger_entries_partitioned
REFERENCING NEW TABLE AS mirrored_ledger_rows FOR EACH STATEMENT EXECUTE FUNCTION billing_mirror_ledger('reverse');

CREATE FUNCTION billing_create_ledger_week(at_time timestamptz, move_limit integer DEFAULT 10000) RETURNS void
LANGUAGE plpgsql SET search_path FROM CURRENT SET lock_timeout = '2s' AS $$
DECLARE
    starts_at timestamptz := date_trunc('week', at_time AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai';
    ends_at timestamptz;
    partition_name text;
    parent_table regclass;
    part_table regclass;
    default_rows integer;
BEGIN
    IF NOT isfinite(at_time) THEN RAISE EXCEPTION '分区时间必须为有限时间'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(current_schema() || ':billing-ledger-partitions', 0));
    ends_at := (starts_at AT TIME ZONE 'Asia/Shanghai' + interval '1 week') AT TIME ZONE 'Asia/Shanghai';
    partition_name := 'credit_ledger_entries_' || to_char(starts_at AT TIME ZONE 'Asia/Shanghai', 'YYYYMMDD');
    SELECT target_relation INTO parent_table FROM billing_ledger_partition_state;
    part_table := to_regclass(format('%I.%I', current_schema(), partition_name));
    IF part_table IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM pg_inherits WHERE inhrelid = part_table AND inhparent = parent_table) THEN
            RAISE EXCEPTION '分区名称已被其他表占用: %', partition_name;
        END IF;
        RETURN;
    END IF;
    IF move_limit > 0 THEN
        -- ATTACH validates all of DEFAULT, including rows belonging to other weeks.
        SELECT count(*) INTO default_rows FROM (SELECT 1 FROM credit_ledger_entries_default LIMIT move_limit + 1) pending;
        IF default_rows > move_limit THEN
            RAISE EXCEPTION '默认分区总积压超过 % 条，暂停自动 DDL；需维护窗口调用 billing_create_ledger_week(at, 0)', move_limit USING ERRCODE = '55000';
        END IF;
    END IF;
    -- DDL and exceptional default-partition relocation share one short exclusive lock.
    EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE', parent_table);
    -- Recheck under the lock: inserts may have enlarged DEFAULT while DDL waited.
    IF move_limit > 0 THEN
        SELECT count(*) INTO default_rows FROM (SELECT 1 FROM credit_ledger_entries_default LIMIT move_limit + 1) pending;
        IF default_rows > move_limit THEN
            RAISE EXCEPTION '默认分区总积压超过 % 条，暂停自动 DDL；需维护窗口调用 billing_create_ledger_week(at, 0)', move_limit USING ERRCODE = '55000';
        END IF;
    END IF;
    EXECUTE format('CREATE TABLE %I (LIKE %s INCLUDING DEFAULTS INCLUDING CONSTRAINTS)', partition_name, parent_table);
    ALTER TABLE credit_ledger_entries_default DISABLE TRIGGER credit_ledger_immutable;
    EXECUTE format('WITH moved AS (DELETE FROM credit_ledger_entries_default WHERE occurred_at >= $1 AND occurred_at < $2 RETURNING *) INSERT INTO %I SELECT * FROM moved', partition_name)
        USING starts_at, ends_at;
    ALTER TABLE credit_ledger_entries_default ENABLE TRIGGER credit_ledger_immutable;
    EXECUTE format('ALTER TABLE %s ATTACH PARTITION %I FOR VALUES FROM (%L) TO (%L)', parent_table, partition_name, starts_at, ends_at);
END;
$$;

CREATE FUNCTION billing_ensure_ledger_weeks(at_time timestamptz) RETURNS boolean
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE week_time timestamptz; i integer; pending_rows integer;
BEGIN
    IF NOT pg_try_advisory_xact_lock(hashtextextended(current_schema() || ':billing-ledger-partitions', 0)) THEN RETURN false; END IF;
    SELECT count(*) INTO pending_rows FROM (SELECT 1 FROM credit_ledger_entries_default LIMIT 10001) pending;
    IF pending_rows > 10000 THEN
        RAISE EXCEPTION '默认分区总积压超过 10000 条，暂停自动 DDL；需维护窗口逐周迁出' USING ERRCODE = '55000';
    END IF;
    FOR i IN 0..8 LOOP
        PERFORM billing_create_ledger_week((date_trunc('week', at_time AT TIME ZONE 'Asia/Shanghai') + i * interval '7 days') AT TIME ZONE 'Asia/Shanghai');
    END LOOP;
    -- Backdated and unusually future-dated entries are accepted by DEFAULT, then moved.
    FOR week_time IN SELECT DISTINCT date_trunc('week', occurred_at AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai'
        FROM credit_ledger_entries_default ORDER BY 1
    LOOP PERFORM billing_create_ledger_week(week_time); END LOOP;
    RETURN true;
END;
$$;

CREATE FUNCTION billing_copy_ledger_batch(batch_size integer) RETURNS integer
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE
    progress billing_ledger_partition_state;
    batch_ids uuid[]; batch_times timestamptz[]; batch_count integer; matched bigint;
BEGIN
    IF batch_size < 1 OR batch_size > 10000 THEN RAISE EXCEPTION '账本迁移批次必须为 1 到 10000'; END IF;
    IF NOT pg_try_advisory_xact_lock(hashtextextended(current_schema() || ':billing-ledger-partitions', 0)) THEN RETURN -2; END IF;
    SELECT * INTO STRICT progress FROM billing_ledger_partition_state FOR UPDATE;
    IF progress.phase = 'partitioned' THEN RETURN -1; END IF;
    IF progress.source_end_at IS NULL THEN RETURN 0; END IF;
    EXECUTE format('SELECT array_agg(id ORDER BY occurred_at,id), array_agg(occurred_at ORDER BY occurred_at,id) FROM
        (SELECT id,occurred_at FROM %s WHERE ($1::timestamptz IS NULL OR (occurred_at,id) > ($1,$2))
        AND (occurred_at,id)<=($4,$5) ORDER BY occurred_at,id LIMIT $3) batch', progress.source_relation)
        INTO batch_ids, batch_times USING progress.cursor_at, progress.cursor_id, batch_size, progress.source_end_at, progress.source_end_id;
    batch_count := coalesce(cardinality(batch_ids), 0);
    IF batch_count = 0 THEN RETURN 0; END IF;
    EXECUTE format('INSERT INTO %s SELECT * FROM %s WHERE id = ANY($1) ON CONFLICT (id,occurred_at) DO NOTHING', progress.target_relation, progress.source_relation)
        USING batch_ids;
    EXECUTE format('SELECT count(*) FROM %s a JOIN %s b ON b.id=a.id AND b.occurred_at=a.occurred_at
        WHERE a.id=ANY($1) AND to_jsonb(a)=to_jsonb(b)', progress.source_relation, progress.target_relation)
        INTO matched USING batch_ids;
    IF matched <> batch_count THEN RAISE EXCEPTION '账本迁移批次校验失败，已停止推进游标'; END IF;
    UPDATE billing_ledger_partition_state SET cursor_at=batch_times[batch_count], cursor_id=batch_ids[batch_count],
        checked_rows=checked_rows+batch_count;
    RETURN batch_count;
END;
$$;

CREATE FUNCTION billing_cutover_ledger() RETURNS boolean
LANGUAGE plpgsql SET search_path FROM CURRENT SET lock_timeout = '2s' AS $$
DECLARE progress billing_ledger_partition_state; valid boolean;
BEGIN
    IF NOT pg_try_advisory_xact_lock(hashtextextended(current_schema() || ':billing-ledger-partitions', 0)) THEN RETURN false; END IF;
    SELECT * INTO STRICT progress FROM billing_ledger_partition_state FOR UPDATE;
    IF progress.phase = 'partitioned' THEN RETURN true; END IF;
    IF progress.source_end_at IS NOT NULL AND (progress.cursor_at IS NULL OR
        (progress.cursor_at,progress.cursor_id)<(progress.source_end_at,progress.source_end_id)) THEN RETURN false; END IF;
    -- One statement snapshot observes atomic mirrors consistently while writes continue.
    -- The expensive validation precedes the short DDL lock, not vice versa.
    EXECUTE format('WITH a AS (SELECT count(*) n, coalesce(sum(credit_delta),0) credits FROM %s),
        b AS (SELECT count(*) n, coalesce(sum(credit_delta),0) credits FROM %s),
        c AS (SELECT count(*) n FROM credit_ledger_entry_keys)
        SELECT a.n=b.n AND b.n=c.n AND a.credits=b.credits FROM a,b,c', progress.source_relation, progress.target_relation)
        INTO valid;
    IF NOT valid THEN RAISE EXCEPTION '账本迁移总笔数或积分总额校验失败'; END IF;
    EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE', progress.source_relation);
    EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE', progress.target_relation);
    DROP TRIGGER stats_model_credit_added ON credit_ledger_entries;
    ALTER TABLE credit_ledger_entries RENAME TO credit_ledger_entries_legacy;
    ALTER TABLE credit_ledger_entries_partitioned RENAME TO credit_ledger_entries;
    CREATE TRIGGER stats_model_credit_added AFTER INSERT ON credit_ledger_entries
    REFERENCING NEW TABLE AS inserted_credits FOR EACH STATEMENT EXECUTE FUNCTION stats_model_credit_added();
    UPDATE billing_ledger_partition_state SET phase='partitioned', switched_at=clock_timestamp();
    RETURN true;
END;
$$;

-- Observation is ended explicitly after deployment review; no financial rows are deleted.
CREATE FUNCTION billing_finish_ledger_observation() RETURNS boolean
LANGUAGE plpgsql SET search_path FROM CURRENT SET lock_timeout = '2s' AS $$
DECLARE progress billing_ledger_partition_state;
BEGIN
    IF NOT pg_try_advisory_xact_lock(hashtextextended(current_schema() || ':billing-ledger-partitions', 0)) THEN RETURN false; END IF;
    SELECT * INTO STRICT progress FROM billing_ledger_partition_state FOR UPDATE;
    IF progress.phase <> 'partitioned' THEN RETURN false; END IF;
    IF NOT progress.mirror_legacy THEN RETURN true; END IF;
    -- Writers of the new parent acquire target then legacy; stale writers use the
    -- opposite order. Never wait while holding either relation against a writer.
    EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE NOWAIT', progress.source_relation);
    EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE NOWAIT', progress.target_relation);
    UPDATE billing_ledger_partition_state SET mirror_legacy=false;
    RETURN true;
EXCEPTION WHEN lock_not_available THEN
    RETURN false;
END;
$$;

-- Empty future partitions and existing history are prepared before enabling the worker.
DO $$
DECLARE first_time timestamptz; last_time timestamptz; week_time timestamptz;
BEGIN
    SELECT min(occurred_at), max(occurred_at) INTO first_time,last_time FROM credit_ledger_entries;
    IF first_time IS NOT NULL THEN
        IF NOT isfinite(first_time) OR NOT isfinite(last_time) THEN RAISE EXCEPTION '历史账本包含非有限时间'; END IF;
        FOR week_time IN SELECT local_week AT TIME ZONE 'Asia/Shanghai' FROM generate_series(
            date_trunc('week',first_time AT TIME ZONE 'Asia/Shanghai'),
            date_trunc('week',last_time AT TIME ZONE 'Asia/Shanghai'),interval '7 days') local_week
        LOOP PERFORM billing_create_ledger_week(week_time); END LOOP;
    END IF;
    PERFORM billing_ensure_ledger_weeks(clock_timestamp());
END;
$$;
-- Existing foreign keys are added only after empty partition preparation, minimizing
-- the time their referenced business tables are locked by this preparation migration.
ALTER TABLE credit_ledger_entry_keys
    ADD FOREIGN KEY (account_id) REFERENCES credit_accounts(id),
    ADD FOREIGN KEY (user_id) REFERENCES users(id),
    ADD FOREIGN KEY (session_id) REFERENCES sessions(id),
    ADD FOREIGN KEY (transaction_id) REFERENCES billing_transactions(id),
    ADD FOREIGN KEY (group_id) REFERENCES groups(id);
CREATE TRIGGER billing_ledger_forward AFTER INSERT ON credit_ledger_entries
REFERENCING NEW TABLE AS mirrored_ledger_rows FOR EACH STATEMENT EXECUTE FUNCTION billing_mirror_ledger('forward');
-- The source write lock acquired by CREATE TRIGGER makes this a finite high-water mark.
UPDATE billing_ledger_partition_state SET (source_end_at,source_end_id) =
    (SELECT occurred_at,id FROM credit_ledger_entries ORDER BY occurred_at DESC,id DESC LIMIT 1);
COMMIT;
