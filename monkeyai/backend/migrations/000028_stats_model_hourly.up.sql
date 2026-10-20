BEGIN;

-- Freeze writers while installing and backfilling the transactional projections.
LOCK TABLE billing_transactions, model_calls, credit_ledger_entries IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE model_calls ADD COLUMN usage_known boolean NOT NULL DEFAULT true;
UPDATE model_calls target SET usage_known = source.known
FROM (
    SELECT c.id, coalesce((b.usage->>'known')::boolean, coalesce(c.error_code, '') = '') AS known
    FROM model_calls c LEFT JOIN billing_transactions b ON b.id = c.id
) source
WHERE target.id = source.id AND target.usage_known IS DISTINCT FROM source.known;

CREATE TABLE stats_model_hourly (
    hour_start timestamptz NOT NULL,
    model_id uuid NOT NULL,
    calls bigint NOT NULL DEFAULT 0 CHECK (calls >= 0),
    succeeded bigint NOT NULL DEFAULT 0 CHECK (succeeded >= 0),
    cache_hits bigint NOT NULL DEFAULT 0 CHECK (cache_hits >= 0),
    input_tokens numeric NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
    output_tokens numeric NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
    PRIMARY KEY (hour_start, model_id),
    CHECK (hour_start = date_trunc('hour', hour_start, 'UTC')),
    CHECK (succeeded <= calls AND cache_hits <= calls)
);

-- Ledger time is independent of call completion time (notably for refunds).
CREATE TABLE stats_model_credit_hourly (
    hour_start timestamptz PRIMARY KEY,
    credits numeric NOT NULL DEFAULT 0,
    CHECK (hour_start = date_trunc('hour', hour_start, 'UTC'))
);

INSERT INTO stats_model_hourly(hour_start, model_id, calls, succeeded, cache_hits, input_tokens, output_tokens)
SELECT date_trunc('hour', completed_at, 'UTC'), model_id, count(*),
    count(*) FILTER (WHERE status = 'succeeded'), count(*) FILTER (WHERE cache_hit),
    coalesce(sum(input_tokens) FILTER (WHERE usage_known), 0),
    coalesce(sum(output_tokens) FILTER (WHERE usage_known), 0)
FROM model_calls WHERE completed_at IS NOT NULL AND status <> 'running'
GROUP BY 1, 2;

INSERT INTO stats_model_credit_hourly(hour_start, credits)
SELECT date_trunc('hour', occurred_at, 'UTC'), -sum(credit_delta)
FROM credit_ledger_entries WHERE category = 'model' AND entry_type IN ('charge', 'refund')
GROUP BY 1;

CREATE FUNCTION stats_model_usage_known() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
    NEW.usage_known := coalesce(
        (SELECT (b.usage->>'known')::boolean FROM billing_transactions b WHERE b.id = NEW.id),
        coalesce(NEW.error_code, '') = '');
    RETURN NEW;
END;
$$;
CREATE TRIGGER stats_model_usage_known BEFORE INSERT OR UPDATE OF id, error_code, usage_known ON model_calls
FOR EACH ROW EXECUTE FUNCTION stats_model_usage_known();

-- Each statement aggregates its entire change set before taking hour-bucket locks.
-- This prevents opposite row orders in two bulk deletes/updates from deadlocking.
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

CREATE FUNCTION stats_model_hourly_inserted() RETURNS trigger
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
CREATE TRIGGER stats_model_hourly_inserted AFTER INSERT ON model_calls
REFERENCING NEW TABLE AS inserted_calls FOR EACH STATEMENT EXECUTE FUNCTION stats_model_hourly_inserted();

CREATE FUNCTION stats_model_hourly_deleted() RETURNS trigger
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
CREATE TRIGGER stats_model_hourly_deleted AFTER DELETE ON model_calls
REFERENCING OLD TABLE AS deleted_calls FOR EACH STATEMENT EXECUTE FUNCTION stats_model_hourly_deleted();

CREATE FUNCTION stats_model_hourly_updated() RETURNS trigger
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
CREATE TRIGGER stats_model_hourly_updated AFTER UPDATE ON model_calls
REFERENCING OLD TABLE AS previous_calls NEW TABLE AS updated_calls
FOR EACH STATEMENT EXECUTE FUNCTION stats_model_hourly_updated();

CREATE FUNCTION stats_model_billing_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
    -- Update the complete set in one statement, so its hour locks share one order.
    -- Unchanged known flags do not rewrite model calls or their projections.
    IF TG_OP = 'INSERT' THEN
        UPDATE model_calls c SET usage_known = coalesce((b.usage->>'known')::boolean, coalesce(c.error_code, '') = '')
        FROM inserted_billing b WHERE c.id = b.id
            AND c.usage_known IS DISTINCT FROM coalesce((b.usage->>'known')::boolean, coalesce(c.error_code, '') = '');
    ELSIF TG_OP = 'UPDATE' THEN
        UPDATE model_calls c SET usage_known = coalesce((b.usage->>'known')::boolean, coalesce(c.error_code, '') = '')
        FROM updated_billing b JOIN previous_billing old_b ON old_b.id = b.id
        WHERE c.id = b.id AND (b.usage->>'known') IS DISTINCT FROM (old_b.usage->>'known')
            AND c.usage_known IS DISTINCT FROM coalesce((b.usage->>'known')::boolean, coalesce(c.error_code, '') = '');
    ELSE
        UPDATE model_calls c SET usage_known = coalesce(c.error_code, '') = ''
        FROM deleted_billing b WHERE c.id = b.id
            AND c.usage_known IS DISTINCT FROM (coalesce(c.error_code, '') = '');
    END IF;
    RETURN NULL;
END;
$$;
CREATE TRIGGER stats_model_billing_inserted AFTER INSERT ON billing_transactions
REFERENCING NEW TABLE AS inserted_billing FOR EACH STATEMENT EXECUTE FUNCTION stats_model_billing_changed();
CREATE TRIGGER stats_model_billing_updated AFTER UPDATE ON billing_transactions
REFERENCING OLD TABLE AS previous_billing NEW TABLE AS updated_billing
FOR EACH STATEMENT EXECUTE FUNCTION stats_model_billing_changed();
CREATE TRIGGER stats_model_billing_deleted AFTER DELETE ON billing_transactions
REFERENCING OLD TABLE AS deleted_billing FOR EACH STATEMENT EXECUTE FUNCTION stats_model_billing_changed();

CREATE FUNCTION stats_model_credit_added() RETURNS trigger
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
CREATE TRIGGER stats_model_credit_added AFTER INSERT ON credit_ledger_entries
REFERENCING NEW TABLE AS inserted_credits FOR EACH STATEMENT EXECUTE FUNCTION stats_model_credit_added();

COMMIT;
