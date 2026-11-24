BEGIN;

-- Replace the two projections together. Do not rebuild any hours from retained facts.
LOCK TABLE stats_model_hourly, stats_model_credit_hourly IN ACCESS EXCLUSIVE MODE;
ALTER TABLE stats_model_hourly RENAME TO stats_model_hourly_old;
ALTER TABLE stats_model_credit_hourly RENAME TO stats_model_credit_hourly_old;
CREATE TABLE stats_model_hourly (LIKE stats_model_hourly_old INCLUDING ALL) PARTITION BY RANGE (hour_start);
CREATE TABLE stats_model_credit_hourly (LIKE stats_model_credit_hourly_old INCLUDING ALL) PARTITION BY RANGE (hour_start);
CREATE TABLE stats_model_hourly_default PARTITION OF stats_model_hourly DEFAULT;
CREATE TABLE stats_model_credit_hourly_default PARTITION OF stats_model_credit_hourly DEFAULT;

CREATE FUNCTION stats_model_create_month(at_time timestamptz) RETURNS void
LANGUAGE plpgsql SET search_path FROM CURRENT SET timezone='Asia/Shanghai' SET lock_timeout='2s' AS $$
DECLARE
    lo timestamptz := date_trunc('month', at_time);
    hi timestamptz := lo + interval '1 month';
    parent_name text;
    child_name text;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(current_schema() || ':stats-model-months', 0));
    FOREACH parent_name IN ARRAY ARRAY['stats_model_hourly', 'stats_model_credit_hourly'] LOOP
        child_name := parent_name || '_' || to_char(lo, 'YYYY_MM');
        IF EXISTS (SELECT FROM pg_inherits WHERE inhparent = parent_name::regclass
                   AND inhrelid = to_regclass(format('%I.%I', current_schema(), child_name))) THEN
            CONTINUE;
        END IF;
        -- Block concurrent routing until fallback rows for this month have moved and the new range is attached.
        EXECUTE format('LOCK TABLE ONLY %I IN ACCESS EXCLUSIVE MODE', parent_name);
        EXECUTE format('CREATE TABLE %I (LIKE %I INCLUDING ALL)', child_name, parent_name);
        EXECUTE format('WITH moved AS (DELETE FROM %I WHERE hour_start >= $1 AND hour_start < $2 RETURNING *)
                        INSERT INTO %I SELECT * FROM moved', parent_name || '_default', child_name) USING lo, hi;
        EXECUTE format('ALTER TABLE %I ATTACH PARTITION %I FOR VALUES FROM (%L) TO (%L)', parent_name, child_name, lo, hi);
    END LOOP;
END;
$$;

CREATE FUNCTION stats_model_ensure_months(at_time timestamptz) RETURNS void
LANGUAGE plpgsql SET search_path FROM CURRENT SET timezone='Asia/Shanghai' SET lock_timeout='2s' AS $$
DECLARE bucket timestamptz; months timestamptz[];
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(current_schema() || ':stats-model-months', 0));
    -- Normal daily check: do not lock live writers when nothing needs moving or creating.
    IF NOT EXISTS (SELECT FROM stats_model_hourly_default)
       AND NOT EXISTS (SELECT FROM stats_model_credit_hourly_default)
       AND NOT EXISTS (
           SELECT FROM generate_series(date_trunc('month', at_time), date_trunc('month', at_time) + interval '2 months', interval '1 month') m
           CROSS JOIN unnest(ARRAY['stats_model_hourly','stats_model_credit_hourly']) p
           WHERE NOT EXISTS (SELECT FROM pg_inherits WHERE inhparent=p::regclass
               AND inhrelid=to_regclass(format('%I.%I',current_schema(),p || '_' || to_char(m,'YYYY_MM'))))
       ) THEN RETURN; END IF;
    -- Count both fallback tables under the routing locks so new writes cannot exceed the budget.
    LOCK TABLE ONLY stats_model_hourly, ONLY stats_model_credit_hourly IN ACCESS EXCLUSIVE MODE;
    IF EXISTS (SELECT FROM (SELECT 1 FROM stats_model_hourly_default UNION ALL
                            SELECT 1 FROM stats_model_credit_hourly_default) pending OFFSET 10000 LIMIT 1) THEN
        RAISE EXCEPTION '模型统计默认分区合计超过 10000 行，请在维护窗口按月搬迁' USING ERRCODE='54000';
    END IF;
    months := ARRAY(
        SELECT generate_series(date_trunc('month', at_time), date_trunc('month', at_time) + interval '2 months', interval '1 month')
        UNION SELECT date_trunc('month', hour_start) FROM stats_model_hourly_default
        UNION SELECT date_trunc('month', hour_start) FROM stats_model_credit_hourly_default
        ORDER BY 1
    );
    FOREACH bucket IN ARRAY months LOOP
        PERFORM stats_model_create_month(bucket);
    END LOOP;
END;
$$;

DO $$
DECLARE bucket timestamptz;
BEGIN
    FOR bucket IN
        SELECT date_trunc('month', hour_start, 'Asia/Shanghai') FROM stats_model_hourly_old
        UNION SELECT date_trunc('month', hour_start, 'Asia/Shanghai') FROM stats_model_credit_hourly_old
        ORDER BY 1
    LOOP
        PERFORM stats_model_create_month(bucket);
    END LOOP;
END;
$$;
SELECT stats_model_ensure_months(now());
INSERT INTO stats_model_hourly SELECT * FROM stats_model_hourly_old;
INSERT INTO stats_model_credit_hourly SELECT * FROM stats_model_credit_hourly_old;
DROP TABLE stats_model_hourly_old, stats_model_credit_hourly_old;
COMMIT;
