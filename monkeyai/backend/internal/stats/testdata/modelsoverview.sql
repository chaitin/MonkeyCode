-- Reference implementation: aggregate the raw call/ledger facts without hourly projections.
WITH bounds AS (
    SELECT $1::timestamptz AS now_at,
           ($1::timestamptz AT TIME ZONE 'Asia/Shanghai')::date AS today
), days AS (
    SELECT d.day::date AS day
    FROM bounds b CROSS JOIN LATERAL generate_series((b.today - 89)::timestamp, b.today::timestamp, interval '1 day') AS d(day)
), calls AS (
    SELECT c.completed_at, c.status, c.input_tokens, c.output_tokens, c.cache_hit,
           c.response_duration_ms, c.first_token_duration_ms, c.started_at,
           coalesce((SELECT (t.usage->>'known')::boolean FROM billing_transactions t WHERE t.id = c.id), coalesce(c.error_code,'') = '') AS usage_known
    FROM model_calls c CROSS JOIN bounds b
    WHERE c.completed_at >= ((b.today - 89)::timestamp AT TIME ZONE 'Asia/Shanghai')
        AND c.completed_at < b.now_at AND c.status <> 'running'
), successful_calls AS (
    SELECT c.* FROM calls c CROSS JOIN bounds b
    WHERE c.completed_at >= b.now_at - interval '30 minutes' AND c.status = 'succeeded'
), duration_samples AS (
    SELECT 'response'::text AS metric,
           coalesce(response_duration_ms, extract(epoch FROM (completed_at - started_at)) * 1000) AS duration_ms
    FROM successful_calls
    UNION ALL
    SELECT 'first_token'::text AS metric, first_token_duration_ms::numeric AS duration_ms
    FROM successful_calls WHERE first_token_duration_ms IS NOT NULL
), ranked_durations AS (
    SELECT metric, duration_ms,
           row_number() OVER (PARTITION BY metric ORDER BY duration_ms) AS sample_index,
           count(*) OVER (PARTITION BY metric) AS sample_count
    FROM duration_samples
), trimmed_durations AS (
    -- Trim the slowest floor(N * 0.05) samples independently for each metric.
    SELECT metric, avg(duration_ms) AS duration_ms FROM ranked_durations
    WHERE sample_index <= sample_count - floor(sample_count * 0.05)
    GROUP BY metric
), calls_by_day AS (
    SELECT (completed_at AT TIME ZONE 'Asia/Shanghai')::date AS day, count(*) AS calls,
           coalesce(sum(input_tokens) FILTER (WHERE usage_known),0) AS input_tokens, coalesce(sum(output_tokens) FILTER (WHERE usage_known),0) AS output_tokens
    FROM calls GROUP BY 1
), credits_by_day AS (
    SELECT (e.occurred_at AT TIME ZONE 'Asia/Shanghai')::date AS day, -sum(e.credit_delta) AS credits
    FROM credit_ledger_entries e CROSS JOIN bounds b
    WHERE e.occurred_at >= ((b.today - 89)::timestamp AT TIME ZONE 'Asia/Shanghai')
        AND e.occurred_at < b.now_at AND e.category = 'model' AND e.entry_type IN ('charge','refund')
    GROUP BY 1
)
SELECT jsonb_build_object(
    'timezone', 'Asia/Shanghai', 'generated_at', (SELECT now_at FROM bounds),
    'last_24h', (SELECT jsonb_build_object('model_calls', count(*),
        'input_tokens', coalesce(sum(input_tokens) FILTER (WHERE usage_known),0), 'output_tokens', coalesce(sum(output_tokens) FILTER (WHERE usage_known),0))
        FROM calls CROSS JOIN bounds b WHERE completed_at >= b.now_at - interval '24 hours'),
    'previous_24h', (SELECT jsonb_build_object('model_calls', count(*),
        'input_tokens', coalesce(sum(input_tokens) FILTER (WHERE usage_known),0), 'output_tokens', coalesce(sum(output_tokens) FILTER (WHERE usage_known),0))
        FROM calls CROSS JOIN bounds b
        WHERE completed_at >= b.now_at - interval '48 hours'
            AND completed_at < b.now_at - interval '24 hours'),
    'last_30m', (SELECT jsonb_build_object(
        'tpm', coalesce(sum(input_tokens + output_tokens) FILTER (WHERE usage_known),0) / 30.0,
        'rpm', count(*) / 30.0,
        'cache_hit_rate', 100.0 * count(*) FILTER (WHERE cache_hit) / nullif(count(*),0),
        'model_success_rate', 100.0 * count(*) FILTER (WHERE status = 'succeeded') / nullif(count(*),0),
        'avg_response_time', (SELECT duration_ms FROM trimmed_durations WHERE metric = 'response'),
        'avg_first_token_time', (SELECT duration_ms FROM trimmed_durations WHERE metric = 'first_token'))
        FROM calls CROSS JOIN bounds b WHERE completed_at >= b.now_at - interval '30 minutes'),
    'days', (SELECT jsonb_agg(jsonb_build_object('date', d.day::text,
        'model_calls', coalesce(c.calls,0), 'input_tokens', coalesce(c.input_tokens,0),
        'output_tokens', coalesce(c.output_tokens,0), 'credits', coalesce(e.credits,0)::text) ORDER BY d.day)
        FROM days d LEFT JOIN calls_by_day c ON c.day = d.day LEFT JOIN credits_by_day e ON e.day = d.day)
);
