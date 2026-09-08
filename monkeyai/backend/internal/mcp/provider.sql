-- name: GetResource :one
SELECT
    to_jsonb (t)
FROM
    connector_providers t
WHERE
    id = $1
    AND deleted_at IS NULL;

-- name: LockResource :one
SELECT
    to_jsonb (t)
FROM
    connector_providers t
WHERE
    id = $1
    AND deleted_at IS NULL
FOR UPDATE;

-- name: ListResources :many
SELECT
    to_jsonb (t)
FROM
    connector_providers t
WHERE
    deleted_at IS NULL
ORDER BY
    lower(name),
    id;

-- name: PageResources :many
SELECT
    to_jsonb (t)
FROM
    connector_providers t
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
INSERT INTO connector_providers (identifier, name, description, url, authorization_mode, authorization_method,
    header_schema, oauth_config, oauth_client_secret, enabled, id, owner_user_id, ownership_type)
    VALUES (
        CASE WHEN sqlc.arg(DATA)::jsonb ? 'identifier' THEN
            (sqlc.arg(DATA)::jsonb ->> 'identifier')::text
        ELSE
            NULL
        END, CASE WHEN sqlc.arg(DATA)::jsonb ? 'name' THEN
            (sqlc.arg(DATA)::jsonb ->> 'name')::text
        ELSE
            NULL
        END, CASE WHEN sqlc.arg(DATA)::jsonb ? 'description' THEN
            (sqlc.arg(DATA)::jsonb ->> 'description')::text
        ELSE
            '' END, CASE WHEN sqlc.arg(DATA)::JSONB ? 'url' THEN (sqlc.arg(DATA)::JSONB->>'url')::text ELSE NULL END, CASE WHEN sqlc.arg(DATA)::JSONB ? 'authorization_mode' THEN (sqlc.arg(DATA)::JSONB->>'authorization_mode')::text ELSE NULL END, CASE WHEN sqlc.arg(DATA)::JSONB ? 'authorization_method' THEN (sqlc.arg(DATA)::JSONB->>'authorization_method')::text ELSE NULL END, CASE WHEN sqlc.arg(DATA)::JSONB ? 'header_schema' THEN NULLIF(sqlc.arg(DATA)::JSONB->'header_schema', 'null'::JSONB) ELSE '{}'::JSONB END, CASE WHEN sqlc.arg(DATA)::JSONB ? 'oauth_config' THEN NULLIF(sqlc.arg(DATA)::JSONB->'oauth_config', 'null'::JSONB) ELSE '{}'::JSONB END, CASE WHEN sqlc.arg(DATA)::JSONB ? 'oauth_client_secret' THEN (sqlc.arg(DATA)::JSONB->>'oauth_client_secret')::text ELSE ''
        END, CASE WHEN sqlc.arg(DATA)::jsonb ? 'enabled' THEN
            (sqlc.arg(DATA)::jsonb ->> 'enabled')::boolean
        ELSE
            TRUE
	END, (sqlc.arg(DATA)::jsonb ->> 'id')::uuid, (sqlc.arg(DATA)::jsonb ->>
	    'actor_id')::uuid, 'system');

-- name: UpdateResource :exec
UPDATE
    connector_providers
SET
    identifier = CASE WHEN sqlc.arg(DATA)::jsonb ? 'identifier' THEN
        (sqlc.arg(DATA)::jsonb ->> 'identifier')::text
    ELSE
        identifier
    END,
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
    header_schema = CASE WHEN sqlc.arg(DATA)::jsonb ? 'header_schema' THEN
        NULLIF (sqlc.arg(DATA)::jsonb -> 'header_schema', 'null'::jsonb)
    ELSE
        header_schema
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
    revision = revision + 1,
    updated_at = now()
WHERE
    id = (sqlc.arg(DATA)::jsonb ->> 'id')::uuid;

-- name: DeleteResource :exec
UPDATE
    connector_providers
SET
    deleted_at = now(),
    updated_at = now(),
    revision = revision + 1
WHERE
    id = $1;

-- name: TouchResource :exec
UPDATE
    connector_providers
SET
    updated_at = now(),
    revision = revision + 1
WHERE
    id = $1;

-- name: SetResourceEnabled :exec
UPDATE
    connector_providers
SET
    enabled = (sqlc.arg(DATA)::jsonb ->> 'enabled')::boolean,
    updated_at = now(),
    revision = revision + 1
WHERE
    id = (sqlc.arg(DATA)::jsonb ->> 'id')::uuid;
