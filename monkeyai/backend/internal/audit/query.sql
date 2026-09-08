-- name: Create :exec
INSERT INTO audits (actor_type, actor_user_id, actor_name, actor_email, action, category,
    target_type, target_id, request_params, source_ip, user_agent, result, error_message, occurred_at, request_id)
VALUES ('user', sqlc.narg(actor_user_id), sqlc.arg(actor_name), sqlc.narg(actor_email), sqlc.arg(action), sqlc.arg(category),
    sqlc.narg(target_type), sqlc.narg(target_id), sqlc.arg(request_params), NULLIF(sqlc.arg(source_ip)::text, '')::inet,
    sqlc.narg(user_agent), sqlc.arg(result), sqlc.narg(error_message), sqlc.arg(occurred_at), sqlc.narg(request_id));

-- name: Actor :one
SELECT name, email FROM users WHERE id = $1;

-- name: Complete :execrows
UPDATE audits SET result = sqlc.arg(result), error_message = sqlc.narg(error_message),
    request_params = request_params || jsonb_build_object('request', sqlc.arg(request_params)::jsonb)
WHERE request_id = sqlc.arg(request_id);

-- name: Page :one
WITH filtered AS NOT MATERIALIZED (
    SELECT * FROM audits
    WHERE (sqlc.arg(category)::text = '' OR category = sqlc.arg(category))
      AND (sqlc.arg(result)::text = '' OR result = sqlc.arg(result))
      AND (sqlc.arg(actor)::text = '' OR strpos(lower(actor_name || ' ' || coalesce(actor_email, '')), lower(sqlc.arg(actor))) > 0)
      AND (sqlc.arg(ip)::text = '' OR strpos(coalesce(host(source_ip), ''), sqlc.arg(ip)) > 0)
      AND (sqlc.arg(params)::text = '' OR strpos(lower(request_params::text), lower(sqlc.arg(params))) > 0)
      AND (sqlc.narg(since)::timestamptz IS NULL OR occurred_at >= sqlc.narg(since))
      AND (sqlc.narg(until)::timestamptz IS NULL OR occurred_at < sqlc.narg(until))
), page AS (
    SELECT id, actor_type, actor_user_id, actor_name, actor_email, action, category, target_type, target_id,
        request_params, host(source_ip) AS source_ip, user_agent, result, error_message, occurred_at, request_id
    FROM filtered ORDER BY occurred_at DESC, id DESC LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset)
)
SELECT jsonb_build_object('total', (SELECT count(*) FROM filtered), 'items',
    coalesce((SELECT jsonb_agg(to_jsonb(page) ORDER BY occurred_at DESC, id DESC) FROM page), '[]'::jsonb))::jsonb AS data;
