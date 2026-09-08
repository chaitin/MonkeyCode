-- name: CountHistory :one
SELECT
    count(*)
FROM
    sessions s
    JOIN users u ON u.id = s.owner_user_id
WHERE
    s.deleted_at IS NULL
    AND (sqlc.arg(title_query)::text = ''
        OR strpos(lower(s.title), lower(sqlc.arg(title_query)::text)) > 0
        OR strpos(s.id::text, lower(sqlc.arg(title_query)::text)) > 0)
    AND (sqlc.arg(user_query)::text = ''
        OR strpos(lower(u.name), lower(sqlc.arg(user_query)::text)) > 0
        OR strpos(lower(u.email), lower(sqlc.arg(user_query)::text)) > 0)
    AND (sqlc.narg(from_time)::timestamptz IS NULL
        OR s.started_at >= sqlc.narg(from_time))
    AND (sqlc.narg(until_time)::timestamptz IS NULL
        OR s.started_at < sqlc.narg(until_time));

-- name: ListHistory :many
SELECT
    jsonb_build_object('id', s.id, 'title', s.title, 'user_name', u.name, 'user_email', u.email,
	'started_at', s.started_at, 'last_active_at', s.last_active_at, 'turn_count', s.turn_count)
FROM
    sessions s
    JOIN users u ON u.id = s.owner_user_id
WHERE
    s.deleted_at IS NULL
    AND (sqlc.arg(title_query)::text = ''
        OR strpos(lower(s.title), lower(sqlc.arg(title_query)::text)) > 0
        OR strpos(s.id::text, lower(sqlc.arg(title_query)::text)) > 0)
    AND (sqlc.arg(user_query)::text = ''
        OR strpos(lower(u.name), lower(sqlc.arg(user_query)::text)) > 0
        OR strpos(lower(u.email), lower(sqlc.arg(user_query)::text)) > 0)
    AND (sqlc.narg(from_time)::timestamptz IS NULL
        OR s.started_at >= sqlc.narg(from_time))
    AND (sqlc.narg(until_time)::timestamptz IS NULL
        OR s.started_at < sqlc.narg(until_time))
ORDER BY
    s.started_at DESC,
    s.id DESC
LIMIT sqlc.arg('limit') OFFSET sqlc.arg('offset');

-- name: ModelSummary :one
WITH periods AS (
    SELECT
        0 AS n,
        sqlc.arg(from_time)::timestamptz AS start_at,
        sqlc.arg(until_time)::timestamptz AS end_at
    UNION ALL
    SELECT
        1,
        sqlc.arg(from_time)::timestamptz - (sqlc.arg(until_time)::timestamptz - sqlc.arg(from_time)::timestamptz),
        sqlc.arg(from_time)::timestamptz
),
totals AS (
    SELECT
        n,
        (
            SELECT
		jsonb_build_object('calls', count(*), 'input_tokens', COALESCE(sum(input_tokens), 0),
		    'output_tokens', COALESCE(sum(output_tokens), 0), 'cache_hit_rate', 100.0 * count(*) FILTER (WHERE
		    cache_hit) / NULLIF (count(*), 0), 'success_rate', 100.0 * count(*) FILTER (WHERE status =
		    'succeeded') / NULLIF (count(*) FILTER (WHERE status <> 'running'), 0))
            FROM
                model_calls c
            WHERE
                c.started_at >= p.start_at
                AND c.started_at < p.end_at
                AND (sqlc.arg(model_id)::text = ''
                    OR c.model_id = NULLIF (sqlc.arg(model_id)::text, '')::uuid)) || jsonb_build_object('credits', (
                    SELECT
                        COALESCE(- sum(credit_delta), 0)::text
                    FROM credit_ledger_entries e
                WHERE
                    e.occurred_at >= p.start_at
                    AND e.occurred_at < p.end_at
                    AND e.category = 'model'
                    AND e.entry_type IN ('charge', 'refund')
                    AND (sqlc.arg(model_id)::text = ''
                        OR e.resource_id = NULLIF (sqlc.arg(model_id)::text, '')::uuid))) AS SUMMARY
    FROM
        periods p
)
SELECT
    jsonb_build_object('summary', (
            SELECT
                SUMMARY
            FROM totals
        WHERE
            n = 0), 'previous', (
        SELECT
            SUMMARY
        FROM totals
    WHERE
        n = 1));

-- name: ModelTrend :many
WITH bucket_times (
    AT
) AS (
    SELECT
	generate_series(sqlc.arg(from_time)::timestamptz, sqlc.arg(until_time)::timestamptz - interval
	    '1 microsecond', sqlc.arg(step_seconds)::bigint * interval '1 second') AS AT
),
buckets AS (
    SELECT
        AT,
        floor(extract(epoch FROM (AT - sqlc.arg(from_time)::timestamptz)) / sqlc.arg(step_seconds))::bigint AS bucket
    FROM
        bucket_times
),
calls AS (
    SELECT
        floor(extract(epoch FROM (started_at - sqlc.arg(from_time)::timestamptz)) / sqlc.arg(step_seconds))::bigint AS bucket,
        count(*) AS calls,
    sum(input_tokens) AS input_tokens,
    sum(output_tokens) AS output_tokens
FROM
    model_calls
    WHERE
        started_at >= sqlc.arg(from_time)
        AND started_at < sqlc.arg(until_time)
        AND (sqlc.arg(model_id)::text = ''
            OR model_id = NULLIF (sqlc.arg(model_id)::text, '')::uuid)
    GROUP BY
        1
),
credits AS (
    SELECT
        floor(extract(epoch FROM (occurred_at - sqlc.arg(from_time)::timestamptz)) / sqlc.arg(step_seconds))::bigint AS bucket,
        - sum(credit_delta) AS credits
    FROM
        credit_ledger_entries
    WHERE
        occurred_at >= sqlc.arg(from_time)
        AND occurred_at < sqlc.arg(until_time)
        AND category = 'model'
        AND entry_type IN ('charge', 'refund')
        AND (sqlc.arg(model_id)::text = ''
            OR resource_id = NULLIF (sqlc.arg(model_id)::text, '')::uuid)
    GROUP BY
        1
)
SELECT
    jsonb_build_object('at', b.at, 'calls', COALESCE(c.calls, 0), 'input_tokens',
	COALESCE(c.input_tokens, 0), 'output_tokens', COALESCE(c.output_tokens, 0), 'credits',
	COALESCE(e.credits, 0)::text)
FROM
    buckets b
    LEFT JOIN calls c ON c.bucket = b.bucket
    LEFT JOIN credits e ON e.bucket = b.bucket
ORDER BY
    b.at;

-- name: ModelOptions :many
SELECT
    jsonb_build_object('id', id, 'name', display_name, 'deleted', deleted_at IS NOT NULL)
FROM
    models
WHERE
    deleted_at IS NULL
    OR id = NULLIF (sqlc.arg(model_id)::text, '')::uuid
    OR id IN (
        SELECT
            model_id
        FROM
            model_calls
        WHERE
            started_at >= sqlc.arg(from_time)
            AND started_at < sqlc.arg(until_time))
    OR id IN (
        SELECT
            resource_id
        FROM
            credit_ledger_entries
        WHERE
            category = 'model'
            AND occurred_at >= sqlc.arg(from_time)
            AND occurred_at < sqlc.arg(until_time))
ORDER BY
    display_name,
    id;

-- name: Realtime :one
WITH calls AS (
    SELECT
        *
    FROM
        model_calls
    WHERE
        completed_at >= sqlc.arg(from_time)
        AND completed_at < sqlc.arg(until_time)
),
active_users AS (
    SELECT
        user_id
    FROM
        calls
    UNION
    SELECT
        user_id
    FROM
        mcp_tool_calls
    WHERE
        completed_at >= sqlc.arg(from_time)
        AND completed_at < sqlc.arg(until_time)
    UNION
    SELECT
        owner_user_id
    FROM
        sessions
    WHERE
        last_active_at >= sqlc.arg(from_time)
        AND last_active_at < sqlc.arg(until_time)
        AND deleted_at IS NULL
    UNION
    SELECT
        user_id
    FROM
        billing_transactions
    WHERE
        status = 'running'
        AND started_at >= sqlc.arg(from_time)
        AND started_at < sqlc.arg(until_time)
)
SELECT
    jsonb_build_object('model_consumption', (
            SELECT
                COALESCE(- sum(credit_delta), 0)::text FROM credit_ledger_entries
        WHERE
            occurred_at >= sqlc.arg(from_time)
            AND occurred_at < sqlc.arg(until_time)
            AND category = 'model'
            AND entry_type IN ('charge', 'refund')), 'p95_response_time', (
            SELECT
                percentile_cont(0.95) WITHIN GROUP (ORDER BY COALESCE(response_duration_ms, extract(epoch FROM (completed_at - started_at)) * 1000))
        FROM calls
    WHERE
        status <> 'running'), 'model_success_rate', (
        SELECT
            100.0 * count(*) FILTER (WHERE status = 'succeeded') / NULLIF (count(*) FILTER (WHERE status <> 'running'), 0)
        FROM calls), 'model_calls', (
        SELECT
            count(*)
        FROM calls), 'tpm', (
        SELECT
            COALESCE(sum(input_tokens + output_tokens), 0)
        FROM calls) / sqlc.arg(window_minutes)::numeric, 'rpm', (
        SELECT
            count(*)
        FROM calls) / sqlc.arg(window_minutes)::numeric, 'input_tokens', (
        SELECT
            COALESCE(sum(input_tokens), 0)
        FROM calls), 'output_tokens', (
        SELECT
            COALESCE(sum(output_tokens), 0)
        FROM calls), 'active_users', (
        SELECT
            count(*)
        FROM active_users), 'active_tasks', (
        SELECT
            count(*)
        FROM sessions
    WHERE
        ended_at IS NULL
        AND last_active_at >= sqlc.arg(from_time)
        AND last_active_at < sqlc.arg(until_time)
        AND deleted_at IS NULL), 'new_tasks', (
        SELECT
            count(*)
        FROM sessions
    WHERE
        started_at >= sqlc.arg(from_time)
        AND started_at < sqlc.arg(until_time)
        AND deleted_at IS NULL));

-- name: TaskSummary :one
WITH periods AS (
    SELECT
        0 AS n,
        sqlc.arg(from_time)::timestamptz AS start_at,
        sqlc.arg(until_time)::timestamptz AS end_at
    UNION ALL
    SELECT
        1,
        sqlc.arg(from_time)::timestamptz - (sqlc.arg(until_time)::timestamptz - sqlc.arg(from_time)::timestamptz),
        sqlc.arg(from_time)::timestamptz
),
totals AS (
    SELECT
        n,
        (
            SELECT
                jsonb_build_object('total', count(*), 'completed', count(*) FILTER (WHERE ended_at IS NOT NULL
                        AND NULLIF (failure_code, '') IS NULL
                    AND NULLIF (failure_message, '') IS NULL), 'failed', count(*) FILTER (WHERE ended_at IS NOT NULL
                AND (NULLIF (failure_code, '') IS NOT NULL
	    OR NULLIF (failure_message, '') IS NOT NULL)), 'running', count(*) FILTER (WHERE ended_at IS
		NULL), 'completion_rate', 100.0 * count(*) FILTER (WHERE ended_at IS NOT NULL
    AND NULLIF (failure_code, '') IS NULL
AND NULLIF (failure_message, '') IS NULL) / NULLIF (count(*), 0), 'average_duration_seconds', avg(extract(epoch FROM
    (ended_at - started_at))))
            FROM
                sessions s
            WHERE
                s.started_at >= p.start_at
                AND s.started_at < p.end_at
                AND s.deleted_at IS NULL) AS SUMMARY
    FROM
        periods p
)
SELECT
    jsonb_build_object('summary', (
            SELECT
                SUMMARY
            FROM totals
            WHERE
                n = 0), 'previous', (
            SELECT
                SUMMARY
            FROM totals
        WHERE
            n = 1));

-- name: TaskTrend :many
WITH bucket_times (
    AT
) AS (
    SELECT
	generate_series(sqlc.arg(from_time)::timestamptz, sqlc.arg(until_time)::timestamptz - interval
	    '1 microsecond', sqlc.arg(step_seconds)::bigint * interval '1 second') AS AT
),
buckets AS (
    SELECT
        AT,
        floor(extract(epoch FROM (AT - sqlc.arg(from_time)::timestamptz)) / sqlc.arg(step_seconds))::bigint AS bucket
    FROM
        bucket_times
),
totals AS (
    SELECT
        floor(extract(epoch FROM (started_at - sqlc.arg(from_time)::timestamptz)) / sqlc.arg(step_seconds))::bigint AS bucket,
        count(*) FILTER (WHERE ended_at IS NOT NULL
            AND NULLIF (failure_code, '') IS NULL
            AND NULLIF (failure_message, '') IS NULL) AS completed,
    count(*) FILTER (WHERE ended_at IS NOT NULL
        AND (NULLIF (failure_code, '') IS NOT NULL
        OR NULLIF (failure_message, '') IS NOT NULL)) AS failed,
count(*) FILTER (WHERE ended_at IS NULL) AS running
FROM
    sessions
    WHERE
        started_at >= sqlc.arg(from_time)
        AND started_at < sqlc.arg(until_time)
        AND deleted_at IS NULL
    GROUP BY
        1
)
SELECT
    jsonb_build_object('at', b.at, 'completed', COALESCE(t.completed, 0), 'failed',
	COALESCE(t.failed, 0), 'running', COALESCE(t.running, 0))
FROM
    buckets b
    LEFT JOIN totals t ON t.bucket = b.bucket
ORDER BY
    b.at;

-- name: TaskTypes :many
SELECT
    (jsonb_build_object('total', count(*), 'completed', count(*) FILTER (WHERE ended_at IS NOT NULL
                AND NULLIF (failure_code, '') IS NULL
            AND NULLIF (failure_message, '') IS NULL), 'failed', count(*) FILTER (WHERE ended_at IS NOT NULL
        AND (NULLIF (failure_code, '') IS NOT NULL
    OR NULLIF (failure_message, '') IS NOT NULL)), 'running', count(*) FILTER (WHERE ended_at IS NULL),
	'completion_rate', 100.0 * count(*) FILTER (WHERE ended_at IS NOT NULL
    AND NULLIF (failure_code, '') IS NULL
AND NULLIF (failure_message, '') IS NULL) / NULLIF (count(*), 0), 'average_duration_seconds', avg(extract(epoch FROM
    (ended_at - started_at)))) || jsonb_build_object('key', session_type))::jsonb
FROM
    sessions
WHERE
    started_at >= $1
    AND started_at < $2
    AND deleted_at IS NULL
GROUP BY
    session_type
ORDER BY
    count(*) DESC,
    session_type;
