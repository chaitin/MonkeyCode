-- name: CountTools :one
SELECT
    count(*)
FROM
    mcp_tools
WHERE
    connector_id = $1
    AND deleted_at IS NULL;
-- name: UserActive :one
SELECT
    EXISTS (
        SELECT
            1
        FROM
            users
        WHERE
            id = sqlc.arg(id)
            AND status = 'active'
            AND deleted_at IS NULL
            AND (NOT sqlc.arg(is_admin)::boolean
                OR ROLE = 'admin')) AS active;
-- name: GetConnector :one
SELECT
    to_jsonb (c)
FROM
    connectors c
WHERE
    c.id = $1
    AND c.deleted_at IS NULL
    AND c.enabled;
-- name: ListTools :many
SELECT
    to_jsonb (t)
FROM
    mcp_tools t
WHERE
    connector_id = sqlc.arg(connector_id)
    AND credential_id IS NOT DISTINCT FROM NULLIF (sqlc.arg(credential_id)::text, '')::uuid
    AND config_revision = sqlc.arg(config_revision)
    AND deleted_at IS NULL
    AND (sqlc.arg(is_admin)::boolean
        OR enabled)
ORDER BY
    name,
    id;
-- name: LockConnector :one
SELECT
    to_jsonb (c)
FROM
    connectors c
WHERE
    id = $1
    AND deleted_at IS NULL
    AND enabled
FOR UPDATE;
-- name: LockCredential :one
SELECT
    to_jsonb (c)
FROM
    connector_credentials c
WHERE
    id = $1
    AND revoked_at IS NULL
FOR UPDATE;
-- name: InvalidateTools :execresult
UPDATE
    mcp_tools
SET
    deleted_at = now()
WHERE
    connector_id = sqlc.arg(connector_id)
    AND credential_id IS NOT DISTINCT FROM NULLIF (sqlc.arg(credential_id)::text, '')::uuid;
-- name: UpsertTool :execresult
INSERT INTO mcp_tools (connector_id, credential_id, name, description, input_schema, config_revision, enabled)
    VALUES (sqlc.arg(connector_id), NULLIF (sqlc.arg(credential_id)::text, '')::uuid,
	sqlc.arg(name), sqlc.arg(description), sqlc.arg(input_schema), sqlc.arg(config_revision), sqlc.arg(enabled))
ON CONFLICT (connector_id, credential_id, name)
    DO UPDATE SET
        description = EXCLUDED.description,
        input_schema = EXCLUDED.input_schema,
        config_revision = EXCLUDED.config_revision,
        enabled = mcp_tools.enabled OR EXCLUDED.enabled,
        discovered_at = now(),
        updated_at = now(),
        deleted_at = NULL;
-- name: GetAuthorizationMode :one
SELECT
    authorization_mode
FROM
    connectors
WHERE
    id = $1
    AND deleted_at IS NULL;
-- name: UpdateTool :one
UPDATE
    mcp_tools t
SET
    enabled = $3,
    credits_per_call = $4,
    updated_at = now()
FROM
    connectors c
WHERE
    t.id = $2
    AND t.connector_id = $1
    AND c.id = t.connector_id
    AND c.ownership_type = 'system'
    AND c.deleted_at IS NULL
    AND t.deleted_at IS NULL
RETURNING
    to_jsonb (t);

-- name: LockIconConnector :one
SELECT to_jsonb(c) FROM connectors c
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
    AND ((ownership_type = 'system' AND sqlc.arg(user_id)::text = '')
        OR (ownership_type = 'user' AND owner_user_id = NULLIF(sqlc.arg(user_id)::text, '')::uuid))
FOR UPDATE;

-- name: SetConnectorIcon :exec
UPDATE connectors SET icon_s3_key = $2, revision = revision + 1, updated_at = now() WHERE id = $1;

-- name: GetConnectorIcon :one
SELECT icon_s3_key FROM connectors WHERE id = $1 AND deleted_at IS NULL;

-- name: ListConnectorReferences :many
SELECT jsonb_build_object('id', e.id, 'name', e.name, 'type', 'expert')
FROM experts e JOIN expert_connectors x ON x.expert_id = e.id
WHERE x.connector_id = $1 AND e.deleted_at IS NULL;

-- name: InvalidateConnectorTools :exec
UPDATE mcp_tools SET deleted_at = now() WHERE connector_id = $1 AND deleted_at IS NULL;

-- name: RevokeConnectorCredentials :exec
UPDATE connector_credentials SET revoked_at = now(), revision = revision + 1, updated_at = now()
WHERE connector_id = $1 AND revoked_at IS NULL;

-- name: ListCredentials :many
SELECT to_jsonb(c) FROM connector_credentials c
WHERE connector_id = sqlc.arg(connector_id)
    AND user_id IS NOT DISTINCT FROM NULLIF(sqlc.arg(user_id)::text, '')::uuid
    AND revoked_at IS NULL
ORDER BY created_at, id;

-- name: ListToolContexts :many
SELECT to_jsonb(c) FROM connector_credentials c
WHERE connector_id = $1 AND revoked_at IS NULL ORDER BY user_id, created_at, id;

-- name: GetCredential :one
SELECT to_jsonb(c) FROM connector_credentials c
WHERE id = sqlc.arg(id) AND connector_id = sqlc.arg(connector_id) AND revoked_at IS NULL;

-- name: GetCentralCredential :one
SELECT to_jsonb(c) FROM connector_credentials c
WHERE connector_id = $1 AND user_id IS NULL AND revoked_at IS NULL;

-- name: CreateCredential :one
INSERT INTO connector_credentials(id, connector_id, user_id, name, http_headers,
    oauth_access_token, oauth_refresh_token, oauth_expires_at, config_revision)
VALUES ((sqlc.arg(data)::jsonb->>'id')::uuid,
    (sqlc.arg(data)::jsonb->>'connector_id')::uuid,
    NULLIF(sqlc.arg(data)::jsonb->>'user_id', '')::uuid,
    sqlc.arg(data)::jsonb->>'name', COALESCE(sqlc.arg(data)::jsonb->'http_headers', '{}'::jsonb),
    COALESCE(sqlc.arg(data)::jsonb->>'oauth_access_token', ''),
    COALESCE(sqlc.arg(data)::jsonb->>'oauth_refresh_token', ''),
    (sqlc.arg(data)::jsonb->>'oauth_expires_at')::timestamptz,
    (sqlc.arg(data)::jsonb->>'config_revision')::bigint)
RETURNING to_jsonb(connector_credentials);

-- name: UpdateCredential :one
UPDATE connector_credentials SET
    name = COALESCE(sqlc.arg(data)::jsonb->>'name', name),
    http_headers = COALESCE(sqlc.arg(data)::jsonb->'http_headers', http_headers),
    oauth_access_token = COALESCE(sqlc.arg(data)::jsonb->>'oauth_access_token', oauth_access_token),
    oauth_refresh_token = COALESCE(sqlc.arg(data)::jsonb->>'oauth_refresh_token', oauth_refresh_token),
    oauth_expires_at = CASE WHEN sqlc.arg(data)::jsonb ? 'oauth_expires_at'
        THEN (sqlc.arg(data)::jsonb->>'oauth_expires_at')::timestamptz ELSE oauth_expires_at END,
    config_revision = COALESCE((sqlc.arg(data)::jsonb->>'config_revision')::bigint, config_revision),
    connection_status = CASE WHEN (sqlc.arg(data)::jsonb->>'auth_change')::boolean THEN 'unknown' ELSE connection_status END,
    last_checked_at = CASE WHEN (sqlc.arg(data)::jsonb->>'auth_change')::boolean THEN NULL ELSE last_checked_at END,
    last_error = CASE WHEN (sqlc.arg(data)::jsonb->>'auth_change')::boolean THEN NULL ELSE last_error END,
    revision = revision + 1, updated_at = now()
WHERE id = (sqlc.arg(data)::jsonb->>'id')::uuid AND revoked_at IS NULL
RETURNING to_jsonb(connector_credentials);

-- name: RevokeCredential :exec
UPDATE connector_credentials SET revoked_at = now(), revision = revision + 1, updated_at = now() WHERE id = $1;

-- name: RefreshCredential :one
UPDATE connector_credentials SET oauth_access_token = $2, oauth_refresh_token = $3,
    oauth_expires_at = $4, updated_at = now()
WHERE id = $1 AND revoked_at IS NULL
RETURNING to_jsonb(connector_credentials);

-- name: ExpireCredential :exec
UPDATE connector_credentials SET oauth_access_token = '', oauth_refresh_token = '', oauth_expires_at = now(),
    revision = revision + 1, connection_status = 'error', last_error = 'OAuth 已失效，请重新授权', updated_at = now()
WHERE id = $1 AND revoked_at IS NULL;

-- name: SetCredentialTest :exec
UPDATE connector_credentials SET connection_status = $2, last_checked_at = now(), last_error = NULLIF($3, ''), updated_at = now()
WHERE id = $1;

-- name: SetConnectionTest :exec
UPDATE connectors SET connection_status = $2, last_checked_at = now(), last_error = NULLIF($3, ''), updated_at = now()
WHERE id = $1;

-- name: CreateOAuthRequest :one
INSERT INTO connector_oauth_requests(id, connector_id, user_id, credential_id, credential_revision, name,
    config_revision, state_hash, verifier, redirect_uri, expires_at)
VALUES ((sqlc.arg(data)::jsonb->>'id')::uuid, (sqlc.arg(data)::jsonb->>'connector_id')::uuid,
    (sqlc.arg(data)::jsonb->>'user_id')::uuid, NULLIF(sqlc.arg(data)::jsonb->>'credential_id','')::uuid,
    (sqlc.arg(data)::jsonb->>'credential_revision')::bigint, sqlc.arg(data)::jsonb->>'name',
    (sqlc.arg(data)::jsonb->>'config_revision')::bigint, sqlc.arg(data)::jsonb->>'state_hash',
    sqlc.arg(data)::jsonb->>'verifier', sqlc.arg(data)::jsonb->>'redirect_uri', now() + interval '10 minutes')
RETURNING to_jsonb(connector_oauth_requests);

-- name: ConsumeOAuthRequest :one
UPDATE connector_oauth_requests SET consumed_at = now(), status = 'processing'
WHERE state_hash = sqlc.arg(state_hash) AND connector_id = sqlc.arg(connector_id)
    AND status = 'pending' AND consumed_at IS NULL AND expires_at > now()
RETURNING to_jsonb(connector_oauth_requests);

-- name: GetOAuthStatus :one
SELECT jsonb_build_object('id', id, 'credential_id', credential_id, 'expires_at', expires_at,
    'status', CASE WHEN status = 'pending' AND expires_at <= now() THEN 'expired'
        WHEN status = 'processing' AND consumed_at < now() - interval '2 minutes' THEN 'failed' ELSE status END)
FROM connector_oauth_requests WHERE id = $1 AND user_id = $2;

-- name: FinishOAuthRequest :execrows
UPDATE connector_oauth_requests SET status = sqlc.arg(status),
    credential_id = COALESCE(NULLIF(sqlc.arg(credential_id)::text, '')::uuid, credential_id)
WHERE id = sqlc.arg(id) AND status = 'processing' AND consumed_at > now() - interval '2 minutes';

-- name: CleanupOAuthRequests :exec
WITH expired AS (
    UPDATE connector_oauth_requests SET status = CASE WHEN status = 'pending' THEN 'expired' ELSE 'failed' END
    WHERE (status = 'pending' AND expires_at <= now())
        OR (status = 'processing' AND consumed_at < now() - interval '2 minutes')
)
DELETE FROM connector_oauth_requests WHERE expires_at < now() - interval '1 day';
