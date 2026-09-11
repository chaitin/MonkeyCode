-- name: GetResource :one
SELECT
    to_jsonb (t)
FROM
    connectors t
WHERE
    id = $1
    AND deleted_at IS NULL;

-- name: LockResource :one
SELECT
    to_jsonb (t)
FROM
    connectors t
WHERE
    id = $1
    AND deleted_at IS NULL
FOR UPDATE;

-- name: ListResources :many
SELECT
    to_jsonb (t)
FROM
    connectors t
WHERE
    deleted_at IS NULL
ORDER BY
    lower(name),
    id;

-- name: PageResources :many
SELECT
    to_jsonb (t)
FROM
    connectors t
WHERE
    deleted_at IS NULL
    AND (sqlc.arg(filter)::jsonb ->> 'ownership' = ''
        OR t.ownership_type = sqlc.arg(filter)::jsonb ->> 'ownership')
    AND name ILIKE '%' || (sqlc.arg(filter)::jsonb ->> 'search') || '%'
    AND id::text > sqlc.arg(filter)::jsonb ->> 'cursor'
ORDER BY
    id
LIMIT (sqlc.arg(filter)::jsonb ->> 'limit')::integer;

-- name: CreateResource :exec
INSERT INTO connectors (name, description, url, authorization_mode, authorization_method, oauth_config,
    oauth_client_secret, enabled, config_revision, connection_status, id, owner_user_id, ownership_type)
    VALUES (
        CASE WHEN sqlc.arg(DATA)::jsonb ? 'name' THEN
            (sqlc.arg(DATA)::jsonb ->> 'name')::text
        ELSE
            NULL
        END, CASE WHEN sqlc.arg(DATA)::jsonb ? 'description' THEN
            (sqlc.arg(DATA)::jsonb ->> 'description')::text
        ELSE
            '' END, CASE WHEN sqlc.arg(DATA)::JSONB ? 'url' THEN (sqlc.arg(DATA)::JSONB->>'url')::text ELSE NULL END, CASE WHEN sqlc.arg(DATA)::JSONB ? 'authorization_mode' THEN (sqlc.arg(DATA)::JSONB->>'authorization_mode')::text ELSE NULL END, CASE WHEN sqlc.arg(DATA)::JSONB ? 'authorization_method' THEN (sqlc.arg(DATA)::JSONB->>'authorization_method')::text ELSE NULL END, CASE WHEN sqlc.arg(DATA)::JSONB ? 'oauth_config' THEN NULLIF(sqlc.arg(DATA)::JSONB->'oauth_config', 'null'::JSONB) ELSE '{}'::JSONB END, CASE WHEN sqlc.arg(DATA)::JSONB ? 'oauth_client_secret' THEN (sqlc.arg(DATA)::JSONB->>'oauth_client_secret')::text ELSE ''
        END, CASE WHEN sqlc.arg(DATA)::jsonb ? 'enabled' THEN
            (sqlc.arg(DATA)::jsonb ->> 'enabled')::boolean
        ELSE
            TRUE
        END, CASE WHEN sqlc.arg(DATA)::jsonb ? 'config_revision' THEN
            (sqlc.arg(DATA)::jsonb ->> 'config_revision')::bigint
        ELSE
            1
        END, CASE WHEN sqlc.arg(DATA)::jsonb ? 'connection_status' THEN
            (sqlc.arg(DATA)::jsonb ->> 'connection_status')::text
        ELSE
            'unknown'
	END, (sqlc.arg(DATA)::jsonb ->> 'id')::uuid, (sqlc.arg(DATA)::jsonb ->>
	    'actor_id')::uuid, COALESCE(sqlc.arg(DATA)::jsonb ->> 'ownership_type', 'system'));

-- name: UpdateResource :exec
UPDATE
    connectors
SET
    name = CASE WHEN sqlc.arg(DATA)::jsonb ? 'name' THEN
        (sqlc.arg(DATA)::jsonb ->> 'name')::text
    ELSE
        name
    END,
    description = CASE WHEN sqlc.arg(DATA)::jsonb ? 'description' THEN
        (sqlc.arg(DATA)::jsonb ->> 'description')::text
    ELSE
        description
    END,
    url = CASE WHEN sqlc.arg(DATA)::jsonb ? 'url' THEN
        (sqlc.arg(DATA)::jsonb ->> 'url')::text
    ELSE
        url
    END,
    authorization_mode = CASE WHEN sqlc.arg(DATA)::jsonb ? 'authorization_mode' THEN
        (sqlc.arg(DATA)::jsonb ->> 'authorization_mode')::text
    ELSE
        authorization_mode
    END,
    authorization_method = CASE WHEN sqlc.arg(DATA)::jsonb ? 'authorization_method' THEN
        (sqlc.arg(DATA)::jsonb ->> 'authorization_method')::text
    ELSE
        authorization_method
    END,
    oauth_config = CASE WHEN sqlc.arg(DATA)::jsonb ? 'oauth_config' THEN
        NULLIF (sqlc.arg(DATA)::jsonb -> 'oauth_config', 'null'::jsonb)
    ELSE
        oauth_config
    END,
    oauth_client_secret = CASE WHEN sqlc.arg(DATA)::jsonb ? 'oauth_client_secret' THEN
        (sqlc.arg(DATA)::jsonb ->> 'oauth_client_secret')::text
    ELSE
        oauth_client_secret
    END,
    enabled = CASE WHEN sqlc.arg(DATA)::jsonb ? 'enabled' THEN
        (sqlc.arg(DATA)::jsonb ->> 'enabled')::boolean
    ELSE
        enabled
    END,
    config_revision = CASE WHEN sqlc.arg(DATA)::jsonb ? 'config_revision' THEN
        (sqlc.arg(DATA)::jsonb ->> 'config_revision')::bigint
    ELSE
        config_revision
    END,
    connection_status = CASE WHEN sqlc.arg(DATA)::jsonb ? 'connection_status' THEN
        (sqlc.arg(DATA)::jsonb ->> 'connection_status')::text
    ELSE
        connection_status
    END,
    last_checked_at = CASE WHEN (sqlc.arg(DATA)::jsonb ->> 'config_revision')::bigint IS DISTINCT FROM config_revision THEN NULL ELSE last_checked_at END,
    last_error = CASE WHEN (sqlc.arg(DATA)::jsonb ->> 'config_revision')::bigint IS DISTINCT FROM config_revision THEN NULL ELSE last_error END,
    revision = revision + 1,
    updated_at = now()
WHERE
    id = (sqlc.arg(DATA)::jsonb ->> 'id')::uuid;

-- name: DeleteResource :exec
WITH revoked AS (
    UPDATE connector_credentials
    SET revoked_at = now(), revision = revision + 1, updated_at = now()
    WHERE connector_credentials.connector_id = $1 AND connector_credentials.revoked_at IS NULL
), invalidated AS (
    UPDATE mcp_tools SET deleted_at = now() WHERE connector_id = $1 AND deleted_at IS NULL
)
UPDATE
    connectors
SET
    deleted_at = now(),
    updated_at = now(),
    revision = revision + 1
WHERE
    connectors.id = $1;

-- name: TouchResource :exec
UPDATE
    connectors
SET
    updated_at = now(),
    revision = revision + 1
WHERE
    id = $1;

-- name: SetResourceEnabled :exec
UPDATE
    connectors
SET
    enabled = (sqlc.arg(DATA)::jsonb ->> 'enabled')::boolean,
    updated_at = now(),
    revision = revision + 1
WHERE
    id = (sqlc.arg(DATA)::jsonb ->> 'id')::uuid;
