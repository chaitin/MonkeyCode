BEGIN;
-- Run with backends stopped. Freeze the authoritative tables (ordinary or cut over)
-- before touching their transactional projections; serialize with monthly maintenance.
SELECT pg_advisory_xact_lock(hashtextextended(current_schema() || ':stats-model-months', 0));
LOCK TABLE billing_transactions, model_calls, credit_ledger_entries IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE stats_model_hourly, stats_model_credit_hourly IN ACCESS EXCLUSIVE MODE;

-- Keep this boundary fixed: a later correction or delete of an older call must
-- subtract from the same unattributed bucket that retained its original count.
CREATE TABLE stats_model_user_backfill (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    from_hour timestamptz NOT NULL
);
INSERT INTO stats_model_user_backfill(from_hour)
VALUES ((((now() AT TIME ZONE 'Asia/Shanghai')::date - 89)::timestamp AT TIME ZONE 'Asia/Shanghai'));

-- Migration 58 cloned the source indexes; find the actual parent PK names.
DO $$
DECLARE p regclass; pk name;
BEGIN
    FOREACH p IN ARRAY ARRAY['stats_model_hourly'::regclass, 'stats_model_credit_hourly'::regclass] LOOP
        SELECT conname INTO STRICT pk FROM pg_constraint WHERE conrelid=p AND contype='p';
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', p, pk);
    END LOOP;
END;
$$;
ALTER TABLE stats_model_hourly ADD COLUMN user_id uuid;
ALTER TABLE stats_model_credit_hourly ADD COLUMN user_id uuid;
ALTER TABLE stats_model_hourly ADD CONSTRAINT stats_model_hour_employee_key UNIQUE NULLS NOT DISTINCT (hour_start, model_id, user_id);
ALTER TABLE stats_model_credit_hourly ADD CONSTRAINT stats_model_credit_hour_employee_key UNIQUE NULLS NOT DISTINCT (hour_start, user_id);

-- Replace (never append to) recent global totals using the surviving facts.
DELETE FROM stats_model_hourly WHERE hour_start >= (SELECT from_hour FROM stats_model_user_backfill);
DELETE FROM stats_model_credit_hourly WHERE hour_start >= (SELECT from_hour FROM stats_model_user_backfill);
INSERT INTO stats_model_hourly(hour_start, model_id, user_id, calls, succeeded, cache_hits, input_tokens, output_tokens)
SELECT date_trunc('hour', completed_at, 'UTC'), model_id, user_id, count(*),
    count(*) FILTER (WHERE status='succeeded'), count(*) FILTER (WHERE cache_hit),
    coalesce(sum(input_tokens) FILTER (WHERE usage_known),0), coalesce(sum(output_tokens) FILTER (WHERE usage_known),0)
FROM model_calls WHERE completed_at >= (SELECT from_hour FROM stats_model_user_backfill) AND status <> 'running'
GROUP BY 1,2,3;
INSERT INTO stats_model_credit_hourly(hour_start, user_id, credits)
SELECT date_trunc('hour', occurred_at, 'UTC'), user_id, -sum(credit_delta)
FROM credit_ledger_entries WHERE occurred_at >= (SELECT from_hour FROM stats_model_user_backfill)
    AND category='model' AND entry_type IN ('charge','refund') GROUP BY 1,2;
CREATE INDEX stats_model_hourly_user_hour_idx ON stats_model_hourly(user_id, hour_start) WHERE user_id IS NOT NULL;
CREATE INDEX stats_model_credit_hourly_user_hour_idx ON stats_model_credit_hourly(user_id, hour_start) WHERE user_id IS NOT NULL;

CREATE FUNCTION stats_model_hourly_add(
    bucket timestamptz, model uuid, employee uuid, call_delta bigint, success_delta bigint,
    cache_delta bigint, input_delta numeric, output_delta numeric
) RETURNS void LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
    UPDATE stats_model_hourly h SET calls = h.calls + call_delta,
        succeeded = h.succeeded + success_delta, cache_hits = h.cache_hits + cache_delta,
        input_tokens = h.input_tokens + input_delta, output_tokens = h.output_tokens + output_delta
    WHERE h.hour_start = bucket AND h.model_id = model
        AND (h.user_id = employee OR (h.user_id IS NULL AND employee IS NULL));
    IF NOT FOUND THEN
        INSERT INTO stats_model_hourly AS h(hour_start, model_id, user_id, calls, succeeded, cache_hits, input_tokens, output_tokens)
        VALUES(bucket, model, employee, call_delta, success_delta, cache_delta, input_delta, output_delta)
        ON CONFLICT (hour_start, model_id, user_id) DO UPDATE SET calls = h.calls + EXCLUDED.calls,
            succeeded = h.succeeded + EXCLUDED.succeeded, cache_hits = h.cache_hits + EXCLUDED.cache_hits,
            input_tokens = h.input_tokens + EXCLUDED.input_tokens, output_tokens = h.output_tokens + EXCLUDED.output_tokens;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION stats_model_hourly_inserted() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE delta record; since timestamptz;
BEGIN
    SELECT from_hour INTO STRICT since FROM stats_model_user_backfill;
    FOR delta IN
        SELECT date_trunc('hour', completed_at, 'UTC') AS hour_start, model_id,
            CASE WHEN completed_at >= since THEN user_id END AS employee, count(*) AS calls,
            count(*) FILTER (WHERE status = 'succeeded') AS succeeded, count(*) FILTER (WHERE cache_hit) AS cache_hits,
            coalesce(sum(input_tokens) FILTER (WHERE usage_known), 0) AS input_tokens,
            coalesce(sum(output_tokens) FILTER (WHERE usage_known), 0) AS output_tokens
        FROM inserted_calls WHERE completed_at IS NOT NULL AND status <> 'running'
        GROUP BY 1, 2, 3 ORDER BY 1, 2, 3
    LOOP
        PERFORM stats_model_hourly_add(delta.hour_start, delta.model_id, delta.employee, delta.calls, delta.succeeded,
            delta.cache_hits, delta.input_tokens, delta.output_tokens);
    END LOOP;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION stats_model_hourly_deleted() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE delta record; since timestamptz;
BEGIN
    SELECT from_hour INTO STRICT since FROM stats_model_user_backfill;
    FOR delta IN
        SELECT date_trunc('hour', completed_at, 'UTC') AS hour_start, model_id,
            CASE WHEN completed_at >= since THEN user_id END AS employee, -count(*) AS calls,
            -count(*) FILTER (WHERE status = 'succeeded') AS succeeded, -count(*) FILTER (WHERE cache_hit) AS cache_hits,
            -coalesce(sum(input_tokens) FILTER (WHERE usage_known), 0) AS input_tokens,
            -coalesce(sum(output_tokens) FILTER (WHERE usage_known), 0) AS output_tokens
        FROM deleted_calls WHERE completed_at IS NOT NULL AND status <> 'running'
        GROUP BY 1, 2, 3 ORDER BY 1, 2, 3
    LOOP
        PERFORM stats_model_hourly_add(delta.hour_start, delta.model_id, delta.employee, delta.calls, delta.succeeded,
            delta.cache_hits, delta.input_tokens, delta.output_tokens);
    END LOOP;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION stats_model_hourly_updated() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE delta record; since timestamptz;
BEGIN
    SELECT from_hour INTO STRICT since FROM stats_model_user_backfill;
    FOR delta IN
        SELECT hour_start, model_id, employee, sum(calls)::bigint AS calls,
            sum(succeeded)::bigint AS succeeded, sum(cache_hits)::bigint AS cache_hits,
            sum(input_tokens) AS input_tokens, sum(output_tokens) AS output_tokens
        FROM (
            SELECT date_trunc('hour', completed_at, 'UTC') AS hour_start, model_id,
                CASE WHEN completed_at >= since THEN user_id END AS employee,
                -1::bigint AS calls, -(status = 'succeeded')::integer AS succeeded,
                -cache_hit::integer AS cache_hits,
                CASE WHEN usage_known THEN -input_tokens::numeric ELSE 0 END AS input_tokens,
                CASE WHEN usage_known THEN -output_tokens::numeric ELSE 0 END AS output_tokens
            FROM previous_calls WHERE completed_at IS NOT NULL AND status <> 'running'
            UNION ALL
            SELECT date_trunc('hour', completed_at, 'UTC'), model_id, CASE WHEN completed_at >= since THEN user_id END,
                1::bigint, (status = 'succeeded')::integer, cache_hit::integer,
                CASE WHEN usage_known THEN input_tokens::numeric ELSE 0 END,
                CASE WHEN usage_known THEN output_tokens::numeric ELSE 0 END
            FROM updated_calls WHERE completed_at IS NOT NULL AND status <> 'running'
        ) contributions
        GROUP BY hour_start, model_id, employee
        HAVING sum(calls) <> 0 OR sum(succeeded) <> 0 OR sum(cache_hits) <> 0
            OR sum(input_tokens) <> 0 OR sum(output_tokens) <> 0
        ORDER BY hour_start, model_id, employee
    LOOP
        PERFORM stats_model_hourly_add(delta.hour_start, delta.model_id, delta.employee, delta.calls, delta.succeeded,
            delta.cache_hits, delta.input_tokens, delta.output_tokens);
    END LOOP;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION stats_model_credit_added() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE delta record; since timestamptz;
BEGIN
    SELECT from_hour INTO STRICT since FROM stats_model_user_backfill;
    FOR delta IN
        SELECT date_trunc('hour', occurred_at, 'UTC') AS hour_start,
            CASE WHEN occurred_at >= since THEN user_id END AS employee, -sum(credit_delta) AS credits
        FROM inserted_credits WHERE category = 'model' AND entry_type IN ('charge', 'refund')
        GROUP BY 1,2 ORDER BY 1,2
    LOOP
        INSERT INTO stats_model_credit_hourly AS h(hour_start, user_id, credits)
        VALUES(delta.hour_start, delta.employee, delta.credits)
        ON CONFLICT (hour_start, user_id) DO UPDATE SET credits = h.credits + EXCLUDED.credits;
    END LOOP;
    RETURN NULL;
END;
$$;
DROP FUNCTION stats_model_hourly_add(timestamptz, uuid, bigint, bigint, bigint, numeric, numeric);
COMMIT;
