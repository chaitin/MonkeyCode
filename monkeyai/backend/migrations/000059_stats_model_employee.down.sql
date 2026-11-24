BEGIN;
-- Run with backends stopped. Freeze the authoritative tables (ordinary or cut over)
-- before touching their transactional projections; serialize with monthly maintenance.
SELECT pg_advisory_xact_lock(hashtextextended(current_schema() || ':stats-model-months', 0));
LOCK TABLE billing_transactions, model_calls, credit_ledger_entries IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE stats_model_hourly, stats_model_credit_hourly IN ACCESS EXCLUSIVE MODE;

-- Fold buckets including the anonymous historical ones; never re-read mutable facts on rollback.
CREATE TEMP TABLE stats_model_rollback_calls ON COMMIT DROP AS
SELECT hour_start, model_id, sum(calls) AS calls, sum(succeeded) AS succeeded, sum(cache_hits) AS cache_hits,
    sum(input_tokens) AS input_tokens, sum(output_tokens) AS output_tokens FROM stats_model_hourly GROUP BY 1,2;
CREATE TEMP TABLE stats_model_rollback_credits ON COMMIT DROP AS
SELECT hour_start, sum(credits) AS credits FROM stats_model_credit_hourly GROUP BY 1;
TRUNCATE stats_model_hourly, stats_model_credit_hourly;
ALTER TABLE stats_model_hourly DROP COLUMN user_id;
ALTER TABLE stats_model_credit_hourly DROP COLUMN user_id;
ALTER TABLE stats_model_hourly ADD PRIMARY KEY (hour_start, model_id);
ALTER TABLE stats_model_credit_hourly ADD PRIMARY KEY (hour_start);
INSERT INTO stats_model_hourly SELECT * FROM stats_model_rollback_calls;
INSERT INTO stats_model_credit_hourly SELECT * FROM stats_model_rollback_credits;

CREATE FUNCTION stats_model_hourly_add(
    bucket timestamptz, model uuid, call_delta bigint, success_delta bigint,
    cache_delta bigint, input_delta numeric, output_delta numeric
) RETURNS void LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
    UPDATE stats_model_hourly h SET calls = h.calls + call_delta,
        succeeded = h.succeeded + success_delta, cache_hits = h.cache_hits + cache_delta,
        input_tokens = h.input_tokens + input_delta, output_tokens = h.output_tokens + output_delta
    WHERE h.hour_start = bucket AND h.model_id = model;
    IF NOT FOUND THEN
        INSERT INTO stats_model_hourly AS h(hour_start, model_id, calls, succeeded, cache_hits, input_tokens, output_tokens)
        VALUES(bucket, model, call_delta, success_delta, cache_delta, input_delta, output_delta)
        ON CONFLICT (hour_start, model_id) DO UPDATE SET calls = h.calls + EXCLUDED.calls,
            succeeded = h.succeeded + EXCLUDED.succeeded, cache_hits = h.cache_hits + EXCLUDED.cache_hits,
            input_tokens = h.input_tokens + EXCLUDED.input_tokens, output_tokens = h.output_tokens + EXCLUDED.output_tokens;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION stats_model_hourly_inserted() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE delta record;
BEGIN
    FOR delta IN
        SELECT date_trunc('hour', completed_at, 'UTC') AS hour_start, model_id, count(*) AS calls,
            count(*) FILTER (WHERE status = 'succeeded') AS succeeded, count(*) FILTER (WHERE cache_hit) AS cache_hits,
            coalesce(sum(input_tokens) FILTER (WHERE usage_known), 0) AS input_tokens,
            coalesce(sum(output_tokens) FILTER (WHERE usage_known), 0) AS output_tokens
        FROM inserted_calls WHERE completed_at IS NOT NULL AND status <> 'running'
        GROUP BY 1, 2 ORDER BY 1, 2
    LOOP
        PERFORM stats_model_hourly_add(delta.hour_start, delta.model_id, delta.calls, delta.succeeded,
            delta.cache_hits, delta.input_tokens, delta.output_tokens);
    END LOOP;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION stats_model_hourly_deleted() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE delta record;
BEGIN
    FOR delta IN
        SELECT date_trunc('hour', completed_at, 'UTC') AS hour_start, model_id, -count(*) AS calls,
            -count(*) FILTER (WHERE status = 'succeeded') AS succeeded, -count(*) FILTER (WHERE cache_hit) AS cache_hits,
            -coalesce(sum(input_tokens) FILTER (WHERE usage_known), 0) AS input_tokens,
            -coalesce(sum(output_tokens) FILTER (WHERE usage_known), 0) AS output_tokens
        FROM deleted_calls WHERE completed_at IS NOT NULL AND status <> 'running'
        GROUP BY 1, 2 ORDER BY 1, 2
    LOOP
        PERFORM stats_model_hourly_add(delta.hour_start, delta.model_id, delta.calls, delta.succeeded,
            delta.cache_hits, delta.input_tokens, delta.output_tokens);
    END LOOP;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION stats_model_hourly_updated() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE delta record;
BEGIN
    FOR delta IN
        SELECT hour_start, model_id, sum(calls)::bigint AS calls,
            sum(succeeded)::bigint AS succeeded, sum(cache_hits)::bigint AS cache_hits,
            sum(input_tokens) AS input_tokens, sum(output_tokens) AS output_tokens
        FROM (
            SELECT date_trunc('hour', completed_at, 'UTC') AS hour_start, model_id,
                -1::bigint AS calls, -(status = 'succeeded')::integer AS succeeded,
                -cache_hit::integer AS cache_hits,
                CASE WHEN usage_known THEN -input_tokens::numeric ELSE 0 END AS input_tokens,
                CASE WHEN usage_known THEN -output_tokens::numeric ELSE 0 END AS output_tokens
            FROM previous_calls WHERE completed_at IS NOT NULL AND status <> 'running'
            UNION ALL
            SELECT date_trunc('hour', completed_at, 'UTC'), model_id,
                1::bigint, (status = 'succeeded')::integer, cache_hit::integer,
                CASE WHEN usage_known THEN input_tokens::numeric ELSE 0 END,
                CASE WHEN usage_known THEN output_tokens::numeric ELSE 0 END
            FROM updated_calls WHERE completed_at IS NOT NULL AND status <> 'running'
        ) contributions
        GROUP BY hour_start, model_id
        HAVING sum(calls) <> 0 OR sum(succeeded) <> 0 OR sum(cache_hits) <> 0
            OR sum(input_tokens) <> 0 OR sum(output_tokens) <> 0
        ORDER BY hour_start, model_id
    LOOP
        PERFORM stats_model_hourly_add(delta.hour_start, delta.model_id, delta.calls, delta.succeeded,
            delta.cache_hits, delta.input_tokens, delta.output_tokens);
    END LOOP;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION stats_model_credit_added() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE delta record;
BEGIN
    FOR delta IN
        SELECT date_trunc('hour', occurred_at, 'UTC') AS hour_start, -sum(credit_delta) AS credits
        FROM inserted_credits WHERE category = 'model' AND entry_type IN ('charge', 'refund')
        GROUP BY 1 ORDER BY 1
    LOOP
        INSERT INTO stats_model_credit_hourly AS h(hour_start, credits)
        VALUES(delta.hour_start, delta.credits)
        ON CONFLICT (hour_start) DO UPDATE SET credits = h.credits + EXCLUDED.credits;
    END LOOP;
    RETURN NULL;
END;
$$;
DROP FUNCTION stats_model_hourly_add(timestamptz, uuid, uuid, bigint, bigint, bigint, numeric, numeric);
DROP TABLE stats_model_user_backfill;
COMMIT;
