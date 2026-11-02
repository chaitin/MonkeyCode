BEGIN;

CREATE OR REPLACE FUNCTION billing_ensure_activity_weeks(kind text,at_time timestamptz) RETURNS boolean
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

COMMIT;
