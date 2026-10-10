-- name: CountHistory :one
SELECT
    count(*)
FROM
    sessions s
    JOIN users u ON u.id = s.owner_user_id
WHERE
    s.deleted_at IS NULL
    AND s.purged_at IS NULL
    AND s.reporting_enabled_at IS NOT NULL
    AND s.placeholder = false
    AND s.parent_session_id IS NULL
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
    jsonb_build_object('id', s.id, 'title', s.title, 'title_source', s.title_source, 'user_id', s.owner_user_id, 'user_name', u.name, 'user_email', u.email,
        'started_at', s.started_at, 'last_active_at', s.last_active_at, 'turn_count', (
            SELECT count(*) FROM session_turns t WHERE t.session_id = s.id))
FROM
    sessions s
    JOIN users u ON u.id = s.owner_user_id
WHERE
    s.deleted_at IS NULL
    AND s.purged_at IS NULL
    AND s.reporting_enabled_at IS NOT NULL
    AND s.placeholder = false
    AND s.parent_session_id IS NULL
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

-- name: ReportingTaskSummary :one
SELECT jsonb_build_object('total', count(*), 'completed', count(*) FILTER (WHERE t.stop_reason = 'complete'),
    'failed', count(*) FILTER (WHERE t.stop_reason IN ('error','max_turns','output_limit')),
    'interrupted', count(*) FILTER (WHERE t.stop_reason = 'interrupted'),
    'unknown', count(*) FILTER (WHERE t.stop_reason = 'unknown'),
    'known_outcomes', count(*) FILTER (WHERE t.stop_reason <> 'unknown'),
    'completion_rate', 100.0 * count(*) FILTER (WHERE t.stop_reason = 'complete') / NULLIF(count(*) FILTER (WHERE t.stop_reason <> 'unknown'), 0),
    'anomaly_rate', 100.0 * count(*) FILTER (WHERE t.stop_reason IN ('error','max_turns','output_limit')) / NULLIF(count(*) FILTER (WHERE t.stop_reason <> 'unknown'), 0),
    'average_duration_seconds', avg(extract(epoch FROM (t.ended_at-t.started_at))),
    'p50_duration_seconds', percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (t.ended_at-t.started_at))),
    'p95_duration_seconds', percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM (t.ended_at-t.started_at))))
FROM session_turns t JOIN sessions s ON s.id = t.session_id
WHERE s.reporting_enabled_at IS NOT NULL AND s.placeholder = false AND s.deleted_at IS NULL AND s.purged_at IS NULL
    AND t.started_at >= sqlc.arg(from_time)::timestamptz AND t.started_at < sqlc.arg(until_time)::timestamptz;

-- name: ReportingTaskTrend :many
WITH buckets AS (
    SELECT generate_series(sqlc.arg(from_time)::timestamptz, sqlc.arg(until_time)::timestamptz - interval '1 microsecond', sqlc.arg(step_seconds)::bigint * interval '1 second') AS at
), totals AS (
    SELECT floor(extract(epoch FROM (t.started_at - sqlc.arg(from_time)::timestamptz))/sqlc.arg(step_seconds)::bigint)::bigint AS bucket,
        count(*) FILTER (WHERE t.stop_reason = 'complete') AS completed,
        count(*) FILTER (WHERE t.stop_reason IN ('error','max_turns','output_limit')) AS failed,
        count(*) FILTER (WHERE t.stop_reason = 'interrupted') AS interrupted,
        count(*) FILTER (WHERE t.stop_reason = 'unknown') AS unknown
    FROM session_turns t JOIN sessions s ON s.id = t.session_id
    WHERE s.reporting_enabled_at IS NOT NULL AND s.placeholder = false AND s.deleted_at IS NULL AND s.purged_at IS NULL
        AND t.started_at >= sqlc.arg(from_time)::timestamptz AND t.started_at < sqlc.arg(until_time)::timestamptz
    GROUP BY 1
)
SELECT jsonb_build_object('at', b.at, 'completed', coalesce(v.completed,0), 'failed', coalesce(v.failed,0),
    'interrupted', coalesce(v.interrupted,0), 'unknown', coalesce(v.unknown,0))
FROM buckets b LEFT JOIN totals v ON v.bucket = floor(extract(epoch FROM (b.at-sqlc.arg(from_time)::timestamptz))/sqlc.arg(step_seconds)::bigint)::bigint
ORDER BY b.at;

-- name: ReportingTaskTypes :many
SELECT jsonb_build_object('key', s.session_type, 'total', count(*),
    'completed', count(*) FILTER (WHERE t.stop_reason = 'complete'),
    'failed', count(*) FILTER (WHERE t.stop_reason IN ('error','max_turns','output_limit')),
    'interrupted', count(*) FILTER (WHERE t.stop_reason = 'interrupted'),
    'unknown', count(*) FILTER (WHERE t.stop_reason = 'unknown'),
    'completion_rate', 100.0 * count(*) FILTER (WHERE t.stop_reason = 'complete') / NULLIF(count(*) FILTER (WHERE t.stop_reason <> 'unknown'), 0),
    'anomaly_rate', 100.0 * count(*) FILTER (WHERE t.stop_reason IN ('error','max_turns','output_limit')) / NULLIF(count(*) FILTER (WHERE t.stop_reason <> 'unknown'), 0),
    'average_duration_seconds', avg(extract(epoch FROM (t.ended_at-t.started_at))))
FROM session_turns t JOIN sessions s ON s.id = t.session_id
WHERE s.reporting_enabled_at IS NOT NULL AND s.placeholder = false AND s.deleted_at IS NULL AND s.purged_at IS NULL
    AND t.started_at >= sqlc.arg(from_time)::timestamptz AND t.started_at < sqlc.arg(until_time)::timestamptz
GROUP BY s.session_type ORDER BY count(*) DESC,s.session_type;

-- name: ReportingTaskSessions :one
SELECT count(*) FROM sessions
WHERE reporting_enabled_at IS NOT NULL AND placeholder = false AND deleted_at IS NULL AND purged_at IS NULL
    AND parent_session_id IS NULL AND started_at >= sqlc.arg(from_time)::timestamptz AND started_at < sqlc.arg(until_time)::timestamptz;

-- name: ReportingRealtime :one
WITH calls AS (
    SELECT * FROM model_calls WHERE completed_at >= sqlc.arg(from_time)::timestamptz AND completed_at < sqlc.arg(until_time)::timestamptz
), activity AS (
    SELECT session_id FROM model_calls WHERE session_id IS NOT NULL AND (completed_at >= sqlc.arg(from_time)::timestamptz AND completed_at < sqlc.arg(until_time)::timestamptz OR status = 'running' AND started_at >= sqlc.arg(from_time)::timestamptz AND started_at < sqlc.arg(until_time)::timestamptz)
    UNION SELECT session_id FROM mcp_tool_calls WHERE session_id IS NOT NULL AND (completed_at >= sqlc.arg(from_time)::timestamptz AND completed_at < sqlc.arg(until_time)::timestamptz OR status = 'running' AND started_at >= sqlc.arg(from_time)::timestamptz AND started_at < sqlc.arg(until_time)::timestamptz)
    UNION SELECT session_id FROM image_calls WHERE session_id IS NOT NULL AND completed_at >= sqlc.arg(from_time)::timestamptz AND completed_at < sqlc.arg(until_time)::timestamptz
    UNION SELECT session_id FROM billing_transactions WHERE session_id IS NOT NULL AND status IN ('created','reserved','running','settling') AND started_at >= sqlc.arg(from_time)::timestamptz AND started_at < sqlc.arg(until_time)::timestamptz
    UNION SELECT session_id FROM image_jobs WHERE session_id IS NOT NULL AND status IN ('created','reserved','submitted','running') AND created_at >= sqlc.arg(from_time)::timestamptz AND created_at < sqlc.arg(until_time)::timestamptz
), active_tasks AS (
    SELECT DISTINCT coalesce(s.parent_session_id,s.id) AS root FROM activity a JOIN sessions s ON s.id = a.session_id
    JOIN sessions root ON root.id = coalesce(s.parent_session_id,s.id)
    WHERE s.reporting_enabled_at IS NOT NULL AND s.placeholder = false AND s.deleted_at IS NULL AND s.purged_at IS NULL
        AND root.reporting_enabled_at IS NOT NULL AND root.placeholder = false AND root.deleted_at IS NULL AND root.purged_at IS NULL
), active_users AS (
    SELECT user_id FROM calls UNION SELECT user_id FROM mcp_tool_calls WHERE completed_at >= sqlc.arg(from_time)::timestamptz AND completed_at < sqlc.arg(until_time)::timestamptz
    UNION SELECT s.owner_user_id FROM active_tasks a JOIN sessions s ON s.id = a.root
    UNION SELECT user_id FROM billing_transactions WHERE status = 'running' AND started_at >= sqlc.arg(from_time)::timestamptz AND started_at < sqlc.arg(until_time)::timestamptz
)
SELECT jsonb_build_object(
    'model_consumption', (SELECT coalesce(-sum(credit_delta),0)::text FROM credit_ledger_entries WHERE occurred_at >= sqlc.arg(from_time)::timestamptz AND occurred_at < sqlc.arg(until_time)::timestamptz AND category = 'model' AND entry_type IN ('charge','refund')),
    'p95_response_time', (SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY coalesce(response_duration_ms,extract(epoch FROM (completed_at-started_at))*1000)) FROM calls WHERE status <> 'running'),
    'model_success_rate', (SELECT 100.0*count(*) FILTER (WHERE status = 'succeeded')/NULLIF(count(*) FILTER (WHERE status <> 'running'),0) FROM calls),
    'model_calls', (SELECT count(*) FROM calls),
    'tpm', (SELECT coalesce(sum(input_tokens+output_tokens),0) FROM calls)/sqlc.arg(window_minutes)::text::numeric,
    'rpm', (SELECT count(*) FROM calls)/sqlc.arg(window_minutes)::text::numeric,
    'input_tokens', (SELECT coalesce(sum(input_tokens),0) FROM calls),
    'output_tokens', (SELECT coalesce(sum(output_tokens),0) FROM calls),
    'total_users', (SELECT count(*) FROM users WHERE deleted_at IS NULL),
    'active_users', (SELECT count(*) FROM active_users),
    'active_tasks', (SELECT count(*) FROM active_tasks),
    'new_tasks', (SELECT count(*) FROM sessions WHERE started_at >= sqlc.arg(from_time)::timestamptz AND started_at < sqlc.arg(until_time)::timestamptz AND parent_session_id IS NULL AND reporting_enabled_at IS NOT NULL AND placeholder = false AND deleted_at IS NULL AND purged_at IS NULL));

-- name: ReportingOverview :one
WITH opts AS (SELECT sqlc.arg(filters)::jsonb AS f),
cohort AS (
    SELECT s.* FROM sessions s CROSS JOIN opts p
    WHERE s.reporting_enabled_at IS NOT NULL AND s.deleted_at IS NULL AND s.purged_at IS NULL
        AND (s.placeholder = false OR (p.f->>'include_placeholders')::boolean)
        AND (p.f->>'group_id' IS NULL OR s.group_id = (p.f->>'group_id')::uuid)
        AND (p.f->>'user_id' IS NULL OR s.owner_user_id = (p.f->>'user_id')::uuid)
        AND (p.f->>'expert_id' IS NULL OR s.expert_id = (p.f->>'expert_id')::uuid)
        AND (p.f->>'client_type' IS NULL OR s.client_type = p.f->>'client_type')
        AND (p.f->>'platform' IS NULL OR EXISTS (SELECT 1 FROM endpoints ep WHERE ep.user_id = s.owner_user_id AND ep.machine_id::text = s.device_id AND ep.platform = p.f->>'platform'))
        AND (p.f->>'model_id' IS NULL OR s.model_id = (p.f->>'model_id')::uuid OR EXISTS (SELECT 1 FROM session_turns mt WHERE mt.session_id = s.id AND mt.model_id = (p.f->>'model_id')::uuid AND mt.started_at >= (p.f->>'from')::timestamptz AND mt.started_at < (p.f->>'until')::timestamptz))
        AND (p.f->>'outcome' IS NULL OR EXISTS (SELECT 1 FROM session_turns ot WHERE ot.session_id = s.id AND ot.stop_reason = p.f->>'outcome' AND ot.started_at >= (p.f->>'from')::timestamptz AND ot.started_at < (p.f->>'until')::timestamptz))
        AND (p.f->>'resource_id' IS NULL AND p.f->>'resource_version' IS NULL OR EXISTS (
            SELECT 1 FROM session_turns rt JOIN session_resource_snapshot_items ri ON ri.session_id = rt.session_id AND ri.snapshot_id = rt.resources_snapshot_id
            WHERE rt.session_id = s.id AND rt.started_at >= (p.f->>'from')::timestamptz AND rt.started_at < (p.f->>'until')::timestamptz
                AND (p.f->>'resource_id' IS NULL OR ri.resource_id = p.f->>'resource_id') AND (p.f->>'resource_version' IS NULL OR ri.version = p.f->>'resource_version')))
), facts AS (
    SELECT t.* FROM session_turns t JOIN cohort s ON s.id = t.session_id CROSS JOIN opts p
    WHERE t.started_at >= (p.f->>'from')::timestamptz AND t.started_at < (p.f->>'until')::timestamptz
        AND (p.f->>'model_id' IS NULL OR t.model_id = (p.f->>'model_id')::uuid)
        AND (p.f->>'outcome' IS NULL OR t.stop_reason = p.f->>'outcome')
        AND (p.f->>'resource_id' IS NULL AND p.f->>'resource_version' IS NULL OR EXISTS (
            SELECT 1 FROM session_resource_snapshot_items ri WHERE ri.session_id = t.session_id AND ri.snapshot_id = t.resources_snapshot_id
                AND (p.f->>'resource_id' IS NULL OR ri.resource_id = p.f->>'resource_id') AND (p.f->>'resource_version' IS NULL OR ri.version = p.f->>'resource_version')))
), activity AS (
    SELECT session_id FROM model_calls c CROSS JOIN opts p WHERE c.session_id IS NOT NULL AND (c.started_at >= (p.f->>'from')::timestamptz AND c.started_at < (p.f->>'until')::timestamptz OR c.completed_at >= (p.f->>'from')::timestamptz AND c.completed_at < (p.f->>'until')::timestamptz)
    UNION SELECT session_id FROM mcp_tool_calls c CROSS JOIN opts p WHERE c.session_id IS NOT NULL AND (c.started_at >= (p.f->>'from')::timestamptz AND c.started_at < (p.f->>'until')::timestamptz OR c.completed_at >= (p.f->>'from')::timestamptz AND c.completed_at < (p.f->>'until')::timestamptz)
    UNION SELECT session_id FROM image_calls c CROSS JOIN opts p WHERE c.session_id IS NOT NULL AND (c.started_at >= (p.f->>'from')::timestamptz AND c.started_at < (p.f->>'until')::timestamptz OR c.completed_at >= (p.f->>'from')::timestamptz AND c.completed_at < (p.f->>'until')::timestamptz)
    UNION SELECT session_id FROM billing_transactions c CROSS JOIN opts p WHERE c.session_id IS NOT NULL AND c.status IN ('created','reserved','running','settling') AND c.started_at >= (p.f->>'from')::timestamptz AND c.started_at < (p.f->>'until')::timestamptz
    UNION SELECT session_id FROM image_jobs c CROSS JOIN opts p WHERE c.session_id IS NOT NULL AND c.status IN ('created','reserved','submitted','running') AND c.created_at >= (p.f->>'from')::timestamptz AND c.created_at < (p.f->>'until')::timestamptz
)
SELECT jsonb_build_object(
    'sessions', (SELECT count(*) FROM cohort s CROSS JOIN opts p WHERE s.parent_session_id IS NULL AND s.started_at >= (p.f->>'from')::timestamptz AND s.started_at < (p.f->>'until')::timestamptz),
    'placeholders', (SELECT count(*) FROM cohort s CROSS JOIN opts p WHERE s.placeholder AND s.started_at >= (p.f->>'from')::timestamptz AND s.started_at < (p.f->>'until')::timestamptz),
    'clock_suspect', (SELECT count(*) FROM cohort s CROSS JOIN opts p WHERE s.clock_suspect AND s.started_at >= (p.f->>'from')::timestamptz AND s.started_at < (p.f->>'until')::timestamptz),
    'turns',count(*),'complete',count(*) FILTER (WHERE t.stop_reason = 'complete'),
    'anomalies',count(*) FILTER (WHERE t.stop_reason IN ('error','max_turns','output_limit')),
    'interrupted',count(*) FILTER (WHERE t.stop_reason = 'interrupted'),'unknown',count(*) FILTER (WHERE t.stop_reason = 'unknown'),
    'completion_rate',100.0*count(*) FILTER (WHERE t.stop_reason = 'complete')/NULLIF(count(*) FILTER (WHERE t.stop_reason <> 'unknown'),0),
    'anomaly_rate',100.0*count(*) FILTER (WHERE t.stop_reason IN ('error','max_turns','output_limit'))/NULLIF(count(*) FILTER (WHERE t.stop_reason <> 'unknown'),0),
    'average_duration_seconds',avg(extract(epoch FROM (t.ended_at-t.started_at))),
    'p50_duration_seconds',percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (t.ended_at-t.started_at))),
    'p95_duration_seconds',percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM (t.ended_at-t.started_at))),
    'input_tokens',coalesce(sum(t.input_tokens),0),'output_tokens',coalesce(sum(t.output_tokens),0),
    'recovered',count(*) FILTER (WHERE t.recovered),
    'average_reporting_delay_seconds',avg(extract(epoch FROM (t.received_at-t.ended_at))),
    'last_received_at',max(t.received_at),
    'trend', (SELECT coalesce(jsonb_agg(item ORDER BY at),'[]'::jsonb) FROM (
        SELECT date_trunc('hour',started_at) AS at,jsonb_build_object('at',date_trunc('hour',started_at),'turns',count(*),
            'complete',count(*) FILTER (WHERE stop_reason = 'complete'),
            'anomalies',count(*) FILTER (WHERE stop_reason IN ('error','max_turns','output_limit'))) AS item
        FROM facts GROUP BY date_trunc('hour',started_at)) points),
    'outcomes', (SELECT coalesce(jsonb_agg(item ORDER BY outcome),'[]'::jsonb) FROM (
        SELECT stop_reason AS outcome,jsonb_build_object('outcome',stop_reason,'turns',count(*)) AS item FROM facts GROUP BY stop_reason) outcomes),
    'recent_active_tasks', (SELECT count(DISTINCT s.id) FROM activity a JOIN sessions child ON child.id = a.session_id
        JOIN cohort s ON s.id = coalesce(child.parent_session_id,child.id)
        WHERE child.reporting_enabled_at IS NOT NULL AND child.deleted_at IS NULL AND child.purged_at IS NULL AND child.placeholder = false),
    'credits', (SELECT coalesce(-sum(e.credit_delta),0)::text FROM credit_ledger_entries e
        JOIN sessions child ON child.id = e.session_id JOIN cohort s ON s.id = coalesce(child.parent_session_id,child.id) CROSS JOIN opts p
        WHERE child.reporting_enabled_at IS NOT NULL AND child.deleted_at IS NULL AND child.purged_at IS NULL AND child.placeholder = false
            AND e.entry_type IN ('charge','refund') AND e.occurred_at >= (p.f->>'from')::timestamptz AND e.occurred_at < (p.f->>'until')::timestamptz))
FROM facts t;

-- name: ReportingSessionStatus :one
SELECT jsonb_build_object('id',id,'owner_user_id',owner_user_id,'purged_at',purged_at,'tombstone',purged_at IS NOT NULL)
FROM sessions WHERE id = sqlc.arg(session_id)::uuid;

-- name: ReportingSessions :many
WITH opts AS (SELECT sqlc.arg(filters)::jsonb AS f),
cohort AS (
    SELECT s.* FROM sessions s CROSS JOIN opts p
    WHERE s.reporting_enabled_at IS NOT NULL
        AND (s.deleted_at IS NULL OR (p.f->>'include_purged')::boolean AND s.purged_at IS NOT NULL)
        AND ((p.f->>'include_purged')::boolean OR s.purged_at IS NULL)
        AND (s.placeholder = false OR (p.f->>'include_placeholders')::boolean)
        AND s.parent_session_id IS NULL
        AND s.started_at >= (p.f->>'from')::timestamptz AND s.started_at < (p.f->>'until')::timestamptz
        AND (p.f->>'group_id' IS NULL OR s.group_id = (p.f->>'group_id')::uuid)
        AND (p.f->>'user_id' IS NULL OR s.owner_user_id = (p.f->>'user_id')::uuid)
        AND (p.f->>'expert_id' IS NULL OR s.expert_id = (p.f->>'expert_id')::uuid)
        AND (p.f->>'client_type' IS NULL OR s.client_type = p.f->>'client_type')
        AND (p.f->>'platform' IS NULL OR EXISTS (SELECT 1 FROM endpoints ep WHERE ep.user_id = s.owner_user_id AND ep.machine_id::text = s.device_id AND ep.platform = p.f->>'platform'))
        AND (p.f->>'model_id' IS NULL OR s.model_id = (p.f->>'model_id')::uuid OR EXISTS (SELECT 1 FROM session_turns mt WHERE mt.session_id = s.id AND mt.model_id = (p.f->>'model_id')::uuid AND mt.started_at >= (p.f->>'from')::timestamptz AND mt.started_at < (p.f->>'until')::timestamptz))
        AND (p.f->>'outcome' IS NULL OR EXISTS (SELECT 1 FROM session_turns ot WHERE ot.session_id = s.id AND ot.stop_reason = p.f->>'outcome' AND ot.started_at >= (p.f->>'from')::timestamptz AND ot.started_at < (p.f->>'until')::timestamptz))
        AND (p.f->>'resource_id' IS NULL AND p.f->>'resource_version' IS NULL OR EXISTS (
            SELECT 1 FROM session_turns rt JOIN session_resource_snapshot_items ri ON ri.session_id = rt.session_id AND ri.snapshot_id = rt.resources_snapshot_id
            WHERE rt.session_id = s.id AND rt.started_at >= (p.f->>'from')::timestamptz AND rt.started_at < (p.f->>'until')::timestamptz
                AND (p.f->>'resource_id' IS NULL OR ri.resource_id = p.f->>'resource_id') AND (p.f->>'resource_version' IS NULL OR ri.version = p.f->>'resource_version')))
        AND (p.f->>'cursor_at' IS NULL OR (s.started_at,s.id) < ((p.f->>'cursor_at')::timestamptz,(p.f->>'cursor_id')::uuid))
), page AS (SELECT * FROM cohort ORDER BY started_at DESC,id DESC LIMIT (sqlc.arg(filters)::jsonb->>'limit')::integer + 1)
SELECT CASE WHEN s.purged_at IS NOT NULL THEN
    jsonb_build_object('id',s.id,'owner_user_id',s.owner_user_id,'purged_at',s.purged_at,'tombstone',true,'sort_at',s.started_at)
    ELSE jsonb_build_object('id',s.id,'owner_user_id',s.owner_user_id,'group_id',s.group_id,
        'title',s.title,'title_source',s.title_source,'expert_id',s.expert_id,'model_id',s.model_id,'client_type',s.client_type,'platform',ep.platform,
        'client_version',s.client_version,'started_at',s.started_at,'last_active_at',s.last_active_at,
        'active_seconds',s.active_seconds,'placeholder',s.placeholder,'clock_suspect',s.clock_suspect,
        'turns',coalesce(turns.total,0),'last_outcome',s.last_stop_reason,'subsessions',coalesce(children.total,0),
        'credits',coalesce(credits.net,0)::text,'tombstone',false) END
FROM page s CROSS JOIN opts p
LEFT JOIN LATERAL (SELECT platform FROM endpoints WHERE user_id = s.owner_user_id AND machine_id::text = s.device_id LIMIT 1) ep ON true
LEFT JOIN LATERAL (SELECT count(*) total FROM session_turns WHERE session_id = s.id AND started_at >= (p.f->>'from')::timestamptz AND started_at < (p.f->>'until')::timestamptz) turns ON s.purged_at IS NULL
LEFT JOIN LATERAL (SELECT count(*) total FROM sessions WHERE parent_session_id = s.id AND deleted_at IS NULL AND purged_at IS NULL) children ON s.purged_at IS NULL
LEFT JOIN LATERAL (SELECT -sum(credit_delta) net FROM credit_ledger_entries e WHERE e.session_id IN (SELECT id FROM sessions WHERE id = s.id OR parent_session_id = s.id) AND e.entry_type IN ('charge','refund')) credits ON s.purged_at IS NULL
ORDER BY s.started_at DESC,s.id DESC;

-- name: ReportingDetail :one
WITH opts AS (SELECT sqlc.arg(filters)::jsonb AS f),
cohort AS (
    SELECT s.* FROM sessions s CROSS JOIN opts p
    WHERE s.id = (p.f->>'session_id')::uuid AND s.reporting_enabled_at IS NOT NULL AND s.deleted_at IS NULL AND s.purged_at IS NULL
        AND (s.placeholder = false OR (p.f->>'include_placeholders')::boolean)
        AND s.started_at >= (p.f->>'from')::timestamptz AND s.started_at < (p.f->>'until')::timestamptz
        AND (p.f->>'group_id' IS NULL OR s.group_id = (p.f->>'group_id')::uuid)
        AND (p.f->>'user_id' IS NULL OR s.owner_user_id = (p.f->>'user_id')::uuid)
        AND (p.f->>'expert_id' IS NULL OR s.expert_id = (p.f->>'expert_id')::uuid)
        AND (p.f->>'client_type' IS NULL OR s.client_type = p.f->>'client_type')
        AND (p.f->>'platform' IS NULL OR EXISTS (SELECT 1 FROM endpoints ep WHERE ep.user_id = s.owner_user_id AND ep.machine_id::text = s.device_id AND ep.platform = p.f->>'platform'))
        AND (p.f->>'model_id' IS NULL OR s.model_id = (p.f->>'model_id')::uuid OR EXISTS (SELECT 1 FROM session_turns mt WHERE mt.session_id = s.id AND mt.model_id = (p.f->>'model_id')::uuid AND mt.started_at >= (p.f->>'from')::timestamptz AND mt.started_at < (p.f->>'until')::timestamptz))
        AND (p.f->>'outcome' IS NULL OR EXISTS (SELECT 1 FROM session_turns ot WHERE ot.session_id = s.id AND ot.stop_reason = p.f->>'outcome' AND ot.started_at >= (p.f->>'from')::timestamptz AND ot.started_at < (p.f->>'until')::timestamptz))
        AND (p.f->>'resource_id' IS NULL AND p.f->>'resource_version' IS NULL OR EXISTS (
            SELECT 1 FROM session_turns rt JOIN session_resource_snapshot_items ri ON ri.session_id = rt.session_id AND ri.snapshot_id = rt.resources_snapshot_id
            WHERE rt.session_id = s.id AND rt.started_at >= (p.f->>'from')::timestamptz AND rt.started_at < (p.f->>'until')::timestamptz
                AND (p.f->>'resource_id' IS NULL OR ri.resource_id = p.f->>'resource_id') AND (p.f->>'resource_version' IS NULL OR ri.version = p.f->>'resource_version')))
)
SELECT jsonb_build_object('id',s.id,'owner_user_id',s.owner_user_id,
    'group_id',s.group_id,'title',s.title,'title_source',s.title_source,'expert_id',s.expert_id,'parent_session_id',s.parent_session_id,
    'model_id',s.model_id,'client_type',s.client_type,'client_version',s.client_version,
    'engine_version',s.engine_version,'runtime_version',s.runtime_version,
    'started_at',s.started_at,'last_active_at',s.last_active_at,'ended_at',s.ended_at,
    'updated_at',s.updated_at,'active_seconds',s.active_seconds,'clock_suspect',s.clock_suspect,
    'placeholder',s.placeholder,'last_outcome',s.last_stop_reason,'tombstone',false,
    'turns', (SELECT coalesce(jsonb_agg(v.item ORDER BY v.turn_index),'[]'::jsonb) FROM (
        SELECT t.turn_index,jsonb_build_object('turn_index',t.turn_index,'started_at',t.started_at,'ended_at',t.ended_at,
            'duration_seconds',extract(epoch FROM (t.ended_at-t.started_at)),'outcome',t.stop_reason,
            'error_code',t.error_code,'model_id',t.model_id,'input_kind',t.input_kind,
            'input_tokens',t.input_tokens,'output_tokens',t.output_tokens,'recovered',t.recovered,
            'resources_snapshot_id',t.resources_snapshot_id,
            'tools',(SELECT count(*) FROM session_turn_tools v WHERE v.session_id = t.session_id AND v.turn_index = t.turn_index),
            'skills',(SELECT count(*) FROM session_skill_events e WHERE e.session_id = t.session_id AND e.turn_index = t.turn_index)) AS item
        FROM session_turns t WHERE t.session_id = s.id AND t.started_at >= (p.f->>'from')::timestamptz AND t.started_at < (p.f->>'until')::timestamptz
        ORDER BY t.turn_index LIMIT (sqlc.arg(filters)::jsonb->>'limit')::integer) v),
    'tools', (SELECT coalesce(jsonb_agg(v.item ORDER BY v.turn_index,v.category,v.resource_id),'[]'::jsonb) FROM (
        SELECT v.turn_index,v.category,v.resource_id,jsonb_build_object('turn_index',v.turn_index,'category',v.category,
            'resource_id',v.resource_id,'resource_version',v.resource_version,'calls',sum(v.calls),'failed',sum(v.failed),'duration_ms',sum(v.duration_ms)) AS item
        FROM session_turn_tools v JOIN session_turns t ON t.session_id = v.session_id AND t.turn_index = v.turn_index
        WHERE v.session_id = s.id AND t.started_at >= (p.f->>'from')::timestamptz AND t.started_at < (p.f->>'until')::timestamptz
        GROUP BY v.turn_index,v.category,v.resource_id,v.resource_version ORDER BY v.turn_index,v.category,v.resource_id LIMIT (sqlc.arg(filters)::jsonb->>'limit')::integer) v),
    'skills', (SELECT coalesce(jsonb_agg(v.item ORDER BY v.turn_index,v.skill_id),'[]'::jsonb) FROM (
        SELECT e.turn_index,e.skill_id,jsonb_build_object('turn_index',e.turn_index,'skill_id',e.skill_id,'version',e.version,
            'trigger',e.trigger,'events',count(*),'succeeded',count(*) FILTER (WHERE e.ok)) AS item
        FROM session_skill_events e JOIN session_turns t ON t.session_id = e.session_id AND t.turn_index = e.turn_index
        WHERE e.session_id = s.id AND t.started_at >= (p.f->>'from')::timestamptz AND t.started_at < (p.f->>'until')::timestamptz
        GROUP BY e.turn_index,e.skill_id,e.version,e.trigger ORDER BY e.turn_index,e.skill_id LIMIT (sqlc.arg(filters)::jsonb->>'limit')::integer) v),
    'resources', (SELECT coalesce(jsonb_agg(v.item ORDER BY v.resource_id,v.version),'[]'::jsonb) FROM (
        SELECT i.resource_id,i.version,jsonb_build_object('resource_id',i.resource_id,'kind',i.kind,'version',i.version,
            'enabled',bool_or(i.enabled),'available',bool_or(i.available),'snapshots',count(DISTINCT i.snapshot_id)) AS item
        FROM session_resource_snapshot_items i JOIN session_turns t ON t.session_id = i.session_id AND t.resources_snapshot_id = i.snapshot_id
        WHERE i.session_id = s.id AND t.started_at >= (p.f->>'from')::timestamptz AND t.started_at < (p.f->>'until')::timestamptz
        GROUP BY i.resource_id,i.kind,i.version ORDER BY i.resource_id,i.version LIMIT (sqlc.arg(filters)::jsonb->>'limit')::integer) v),
    'calls', (SELECT coalesce(jsonb_agg(v.item ORDER BY v.kind,v.status),'[]'::jsonb) FROM (
        SELECT kind,status,jsonb_build_object('kind',kind,'status',status,'calls',count(*),
            'input_tokens',sum(input_tokens),'output_tokens',sum(output_tokens)) AS item
        FROM (SELECT 'model' AS kind,status,input_tokens,output_tokens FROM model_calls WHERE session_id = s.id AND started_at >= (p.f->>'from')::timestamptz AND started_at < (p.f->>'until')::timestamptz
            UNION ALL SELECT 'mcp',status,0::bigint,0::bigint FROM mcp_tool_calls WHERE session_id = s.id AND started_at >= (p.f->>'from')::timestamptz AND started_at < (p.f->>'until')::timestamptz
            UNION ALL SELECT 'image',status,0::bigint,0::bigint FROM image_calls WHERE session_id = s.id AND started_at >= (p.f->>'from')::timestamptz AND started_at < (p.f->>'until')::timestamptz) c
        GROUP BY kind,status ORDER BY kind,status) v),
    'subsessions', (SELECT coalesce(jsonb_agg(v.item ORDER BY v.started_at,v.id),'[]'::jsonb) FROM (
        SELECT child.started_at,child.id,jsonb_build_object('id',child.id,'parent_session_id',child.parent_session_id,
            'started_at',child.started_at,'turns',(SELECT count(*) FROM session_turns t WHERE t.session_id = child.id AND t.started_at >= (p.f->>'from')::timestamptz AND t.started_at < (p.f->>'until')::timestamptz),
            'last_outcome',child.last_stop_reason,'active_seconds',child.active_seconds) AS item
        FROM sessions child WHERE child.parent_session_id = s.id AND child.reporting_enabled_at IS NOT NULL
            AND child.deleted_at IS NULL AND child.purged_at IS NULL AND child.placeholder = false
        ORDER BY child.started_at,child.id LIMIT (sqlc.arg(filters)::jsonb->>'limit')::integer) v),
    'credits', (SELECT coalesce(-sum(credit_delta),0)::text FROM credit_ledger_entries
        WHERE session_id IN (SELECT id FROM sessions WHERE id = s.id OR parent_session_id = s.id) AND entry_type IN ('charge','refund')),
    'detail_limit',(p.f->>'limit')::integer)
FROM cohort s CROSS JOIN opts p;

-- name: ReportingFreshness :one
WITH opts AS (SELECT sqlc.arg(filters)::jsonb AS f)
SELECT max(t.received_at) FROM session_turns t JOIN sessions s ON s.id = t.session_id CROSS JOIN opts p
WHERE s.reporting_enabled_at IS NOT NULL AND s.deleted_at IS NULL AND s.purged_at IS NULL
    AND (s.placeholder = false OR (p.f->>'include_placeholders')::boolean)
    AND (p.f->>'group_id' IS NULL OR s.group_id = (p.f->>'group_id')::uuid)
    AND (p.f->>'user_id' IS NULL OR s.owner_user_id = (p.f->>'user_id')::uuid)
    AND (p.f->>'expert_id' IS NULL OR s.expert_id = (p.f->>'expert_id')::uuid)
    AND (p.f->>'client_type' IS NULL OR s.client_type = p.f->>'client_type')
    AND (p.f->>'platform' IS NULL OR EXISTS (SELECT 1 FROM endpoints ep WHERE ep.user_id = s.owner_user_id AND ep.machine_id::text = s.device_id AND ep.platform = p.f->>'platform'))
    AND (p.f->>'model_id' IS NULL OR t.model_id = (p.f->>'model_id')::uuid)
    AND (p.f->>'outcome' IS NULL OR t.stop_reason = p.f->>'outcome')
    AND t.started_at >= (p.f->>'from')::timestamptz AND t.started_at < (p.f->>'until')::timestamptz
    AND (p.f->>'resource_id' IS NULL AND p.f->>'resource_version' IS NULL OR EXISTS (
        SELECT 1 FROM session_resource_snapshot_items ri WHERE ri.session_id = t.session_id AND ri.snapshot_id = t.resources_snapshot_id
            AND (p.f->>'resource_id' IS NULL OR ri.resource_id = p.f->>'resource_id') AND (p.f->>'resource_version' IS NULL OR ri.version = p.f->>'resource_version')));

-- name: ReportingResources :many
WITH opts AS (SELECT sqlc.arg(filters)::jsonb AS f),
cohort AS (
    SELECT s.* FROM sessions s CROSS JOIN opts p
    WHERE s.reporting_enabled_at IS NOT NULL AND s.deleted_at IS NULL AND s.purged_at IS NULL
        AND (s.placeholder = false OR (p.f->>'include_placeholders')::boolean)
        AND (p.f->>'group_id' IS NULL OR s.group_id = (p.f->>'group_id')::uuid)
        AND (p.f->>'user_id' IS NULL OR s.owner_user_id = (p.f->>'user_id')::uuid)
        AND (p.f->>'expert_id' IS NULL OR s.expert_id = (p.f->>'expert_id')::uuid)
        AND (p.f->>'client_type' IS NULL OR s.client_type = p.f->>'client_type')
        AND (p.f->>'platform' IS NULL OR EXISTS (SELECT 1 FROM endpoints ep WHERE ep.user_id = s.owner_user_id AND ep.machine_id::text = s.device_id AND ep.platform = p.f->>'platform'))
        AND (p.f->>'model_id' IS NULL OR s.model_id = (p.f->>'model_id')::uuid OR EXISTS (SELECT 1 FROM session_turns mt WHERE mt.session_id = s.id AND mt.model_id = (p.f->>'model_id')::uuid AND mt.started_at >= (p.f->>'from')::timestamptz AND mt.started_at < (p.f->>'until')::timestamptz))
        AND (p.f->>'outcome' IS NULL OR EXISTS (SELECT 1 FROM session_turns ot WHERE ot.session_id = s.id AND ot.stop_reason = p.f->>'outcome' AND ot.started_at >= (p.f->>'from')::timestamptz AND ot.started_at < (p.f->>'until')::timestamptz))
), turns AS (
    SELECT t.session_id,t.turn_index,t.resources_snapshot_id FROM session_turns t JOIN cohort s ON s.id = t.session_id CROSS JOIN opts p
    WHERE t.started_at >= (p.f->>'from')::timestamptz AND t.started_at < (p.f->>'until')::timestamptz
        AND (p.f->>'model_id' IS NULL OR t.model_id = (p.f->>'model_id')::uuid)
        AND (p.f->>'outcome' IS NULL OR t.stop_reason = p.f->>'outcome')
        AND (p.f->>'resource_id' IS NULL AND p.f->>'resource_version' IS NULL OR EXISTS (
            SELECT 1 FROM session_resource_snapshot_items ri WHERE ri.session_id = t.session_id AND ri.snapshot_id = t.resources_snapshot_id
                AND (p.f->>'resource_id' IS NULL OR ri.resource_id = p.f->>'resource_id') AND (p.f->>'resource_version' IS NULL OR ri.version = p.f->>'resource_version')))
), enabled AS (
    SELECT i.kind,i.resource_id,i.version,count(DISTINCT t.session_id) AS sessions,
        count(DISTINCT t.session_id) FILTER (WHERE i.available) AS available_sessions
    FROM turns t JOIN session_resource_snapshot_items i ON i.session_id = t.session_id AND i.snapshot_id = t.resources_snapshot_id
    WHERE i.enabled GROUP BY i.kind,i.resource_id,i.version
), used AS (
    SELECT v.category AS kind,v.resource_id,v.resource_version AS version,
        count(DISTINCT v.session_id) AS sessions,sum(v.calls) AS calls,sum(v.failed) AS failed
    FROM session_turn_tools v JOIN turns t ON t.session_id = v.session_id AND t.turn_index = v.turn_index
    WHERE v.resource_id IS NOT NULL AND v.category NOT IN ('connector','skill') GROUP BY v.category,v.resource_id,v.resource_version
    UNION ALL SELECT 'skill',e.skill_id,e.version,count(DISTINCT e.session_id),count(*),count(*) FILTER (WHERE NOT e.ok)
    FROM session_skill_events e JOIN turns t ON t.session_id = e.session_id AND t.turn_index = e.turn_index
    WHERE e.skill_id IS NOT NULL GROUP BY e.skill_id,e.version
), gateway AS (
    SELECT 'connector'::text AS kind,c.connector_id::text AS resource_id,NULL::text AS version,
        count(DISTINCT c.session_id) AS sessions,count(*) AS calls,count(*) FILTER (WHERE c.status = 'failed') AS failed
    FROM mcp_tool_calls c JOIN cohort s ON s.id = c.session_id CROSS JOIN opts p
    WHERE c.started_at >= (p.f->>'from')::timestamptz AND c.started_at < (p.f->>'until')::timestamptz
        AND (p.f->>'resource_id' IS NULL OR c.connector_id::text = p.f->>'resource_id')
        AND p.f->>'resource_version' IS NULL GROUP BY c.connector_id
), combined AS (
    SELECT kind,resource_id,version,max(enabled_sessions) AS enabled_sessions,max(available_sessions) AS available_sessions,
        sum(used_sessions) AS used_sessions,sum(calls) AS calls,sum(failed) AS failed FROM (
        SELECT kind,resource_id,version,sessions AS enabled_sessions,available_sessions,0::bigint AS used_sessions,0::numeric AS calls,0::numeric AS failed FROM enabled
        UNION ALL SELECT kind,resource_id,version,0,0,sessions,calls,failed FROM used
        UNION ALL SELECT kind,resource_id,version,0,0,sessions,calls,failed FROM gateway) x CROSS JOIN opts p
    WHERE (p.f->>'resource_id' IS NULL OR resource_id = p.f->>'resource_id')
        AND (p.f->>'resource_version' IS NULL OR version = p.f->>'resource_version')
    GROUP BY kind,resource_id,version
), ordered AS (SELECT *,jsonb_build_array(kind,resource_id,version)::text AS sort_key FROM combined)
SELECT jsonb_build_object('kind',kind,'resource_id',resource_id,'version',version,'sort_key',sort_key,
    'enabled_sessions',enabled_sessions,'available_sessions',available_sessions,'used_sessions',used_sessions,
    'calls',calls,'failed',failed,'failure_rate',100.0*failed/NULLIF(calls,0))
FROM ordered CROSS JOIN opts p
WHERE sort_key > coalesce(p.f->>'cursor_key','') ORDER BY sort_key LIMIT (sqlc.arg(filters)::jsonb->>'limit')::integer + 1;

-- name: ReportingClients :many
WITH opts AS (SELECT sqlc.arg(filters)::jsonb AS f), facts AS (
    SELECT s.id,t.stop_reason,t.started_at,t.ended_at,s.client_type,ep.platform,ep.os_version,ep.locale,ep.timezone,
        t.client_version,t.engine_version,ep.runtime_version FROM session_turns t
    JOIN sessions s ON s.id = t.session_id
    LEFT JOIN endpoints ep ON ep.user_id = s.owner_user_id AND ep.machine_id::text = s.device_id CROSS JOIN opts p
    WHERE s.reporting_enabled_at IS NOT NULL AND s.deleted_at IS NULL AND s.purged_at IS NULL
        AND (s.placeholder = false OR (p.f->>'include_placeholders')::boolean)
        AND (p.f->>'group_id' IS NULL OR s.group_id = (p.f->>'group_id')::uuid)
        AND (p.f->>'user_id' IS NULL OR s.owner_user_id = (p.f->>'user_id')::uuid)
        AND (p.f->>'expert_id' IS NULL OR s.expert_id = (p.f->>'expert_id')::uuid)
        AND (p.f->>'client_type' IS NULL OR s.client_type = p.f->>'client_type')
        AND (p.f->>'platform' IS NULL OR ep.platform = p.f->>'platform')
        AND (p.f->>'model_id' IS NULL OR t.model_id = (p.f->>'model_id')::uuid)
        AND (p.f->>'outcome' IS NULL OR t.stop_reason = p.f->>'outcome')
        AND t.started_at >= (p.f->>'from')::timestamptz AND t.started_at < (p.f->>'until')::timestamptz
        AND (p.f->>'resource_id' IS NULL AND p.f->>'resource_version' IS NULL OR EXISTS (
            SELECT 1 FROM session_resource_snapshot_items ri WHERE ri.session_id = t.session_id AND ri.snapshot_id = t.resources_snapshot_id
                AND (p.f->>'resource_id' IS NULL OR ri.resource_id = p.f->>'resource_id') AND (p.f->>'resource_version' IS NULL OR ri.version = p.f->>'resource_version')))
), grouped AS (
    SELECT client_type,platform,os_version,locale,timezone,client_version,engine_version,runtime_version,
        count(DISTINCT id) AS sessions,count(*) AS turns,
        count(*) FILTER (WHERE stop_reason = 'interrupted') AS interrupted,
        100.0*count(*) FILTER (WHERE stop_reason = 'complete')/NULLIF(count(*) FILTER (WHERE stop_reason <> 'unknown'),0) AS completion_rate,
        100.0*count(*) FILTER (WHERE stop_reason IN ('error','max_turns','output_limit'))/NULLIF(count(*) FILTER (WHERE stop_reason <> 'unknown'),0) AS anomaly_rate,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM (ended_at-started_at))) AS p95_duration_seconds,
        max(ended_at) AS last_active_at FROM facts GROUP BY 1,2,3,4,5,6,7,8
), ordered AS (
    SELECT *,jsonb_build_array(client_type,platform,os_version,locale,timezone,client_version,engine_version,runtime_version)::text AS sort_key FROM grouped
)
SELECT jsonb_build_object('client_type',client_type,'platform',platform,'os_version',os_version,
    'locale',locale,'timezone',timezone,'client_version',client_version,'engine_version',engine_version,
    'runtime_version',runtime_version,'sessions',sessions,'turns',turns,'interrupted',interrupted,
    'completion_rate',completion_rate,'anomaly_rate',anomaly_rate,'p95_duration_seconds',p95_duration_seconds,
    'last_active_at',last_active_at,'sort_key',sort_key)
FROM ordered CROSS JOIN opts p WHERE sort_key > coalesce(p.f->>'cursor_key','')
ORDER BY sort_key LIMIT (sqlc.arg(filters)::jsonb->>'limit')::integer + 1;
