-- name: UpdateToolCallDuration :exec
UPDATE mcp_tool_calls
SET duration_ms = sqlc.arg(duration_ms)::integer
WHERE id = sqlc.arg(id)::uuid
    AND started_at=(SELECT billing_activity_time('mcp_tool_calls',sqlc.arg(id)::uuid));

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
-- name: ListSnapshotTools :many
SELECT jsonb_build_object('id', id, 'name', name, 'description', description, 'input_schema', input_schema,
    'enabled', enabled, 'credits_per_call', CASE WHEN sqlc.arg(independent)::boolean THEN 0 ELSE credits_per_call END)
FROM mcp_tools
WHERE connector_id = sqlc.arg(connector_id)
    AND credential_id IS NOT DISTINCT FROM NULLIF(sqlc.arg(credential_id)::text, '')::uuid
    AND config_revision = sqlc.arg(config_revision) AND discovered_at = sqlc.arg(synced_at)
    AND deleted_at IS NULL AND enabled
ORDER BY name;

-- name: SaveSnapshotTools :exec
INSERT INTO mcp_tools (id, connector_id, credential_id, name, description, input_schema, enabled, config_revision, discovered_at)
SELECT (t->>'id')::uuid, sqlc.arg(connector_id)::uuid, NULLIF(sqlc.arg(credential_id)::text, '')::uuid,
    t->>'name', t->>'description', t->'inputSchema', true, sqlc.arg(config_revision)::bigint, sqlc.arg(synced_at)::timestamptz
FROM jsonb_array_elements(sqlc.arg(tools)::jsonb) t
ON CONFLICT (connector_id, credential_id, name) DO UPDATE SET
    description = EXCLUDED.description, input_schema = EXCLUDED.input_schema,
    enabled = CASE WHEN mcp_tools.deleted_at IS NULL THEN mcp_tools.enabled ELSE true END,
    credits_per_call = CASE WHEN mcp_tools.deleted_at IS NULL THEN mcp_tools.credits_per_call ELSE 0 END,
    config_revision = EXCLUDED.config_revision, discovered_at = EXCLUDED.discovered_at, deleted_at = NULL;

-- name: SetConnectorToolsSynced :exec
UPDATE connectors SET tools_synced_at = sqlc.narg(synced_at)::timestamptz WHERE id = sqlc.arg(id)::uuid;

-- name: SetCredentialToolsSynced :exec
UPDATE connector_credentials SET tools_synced_at = sqlc.narg(synced_at)::timestamptz WHERE id = sqlc.arg(id)::uuid;

-- name: TryToolRefreshLock :one
SELECT pg_try_advisory_lock(hashtextextended('monkeyai.mcp.tools.refresh', 0));

-- name: ListToolRefreshTargets :many
SELECT c.id AS connector_id, ''::text AS credential_id, c.url, c.tools_synced_at
FROM connectors c
WHERE c.enabled AND c.deleted_at IS NULL AND c.authorization_mode = 'none'
UNION ALL
SELECT c.id, cr.id::text, c.url, cr.tools_synced_at
FROM connectors c JOIN connector_credentials cr ON cr.connector_id = c.id
WHERE c.enabled AND c.deleted_at IS NULL AND cr.revoked_at IS NULL AND cr.config_revision = c.config_revision
    AND ((c.authorization_mode = 'centralized' AND cr.user_id IS NULL)
        OR (c.authorization_mode = 'independent' AND EXISTS (
            SELECT 1 FROM users u WHERE u.id = cr.user_id AND u.status = 'active' AND u.deleted_at IS NULL)))
    AND ((c.authorization_method = 'http_header' AND cr.http_headers <> '{}'::jsonb)
        OR (c.authorization_method = 'oauth' AND (cr.oauth_refresh_token <> '' OR
            (cr.oauth_access_token <> '' AND (cr.oauth_expires_at IS NULL OR cr.oauth_expires_at > now())))));

-- name: ListTools :many
SELECT
    jsonb_build_object('id', t.id, 'name', t.name, 'enabled', t.enabled, 'credits_per_call', t.credits_per_call)
FROM
    mcp_tools t
WHERE
    connector_id = sqlc.arg(connector_id)
    AND credential_id IS NOT DISTINCT FROM NULLIF (sqlc.arg(credential_id)::text, '')::uuid
    AND deleted_at IS NULL
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
-- name: GetAuthorizationMode :one
SELECT
    authorization_mode
FROM
    connectors
WHERE
    id = $1
    AND deleted_at IS NULL;
-- name: UpdateTool :one
WITH setting AS (
    SELECT c.id AS connector_id, cr.id AS credential_id, c.config_revision,
        COALESCE(NULLIF(sqlc.arg(name)::text, ''), (
            SELECT t.name FROM mcp_tools t
            WHERE t.id = sqlc.arg(id)::uuid AND t.connector_id = c.id
                AND t.credential_id IS NOT DISTINCT FROM cr.id AND t.deleted_at IS NULL
        )) AS name
    FROM connectors c
    LEFT JOIN connector_credentials cr ON cr.connector_id = c.id
        AND c.authorization_mode = 'centralized' AND cr.user_id IS NULL
        AND cr.revoked_at IS NULL AND cr.config_revision = c.config_revision
    WHERE c.id = sqlc.arg(connector_id)::uuid AND c.ownership_type = 'system'
        AND c.deleted_at IS NULL AND c.authorization_mode IN ('none', 'centralized')
        AND (c.authorization_mode = 'centralized' OR sqlc.arg(credits_per_call) = 0)
        AND (c.authorization_mode = 'none' OR cr.id IS NOT NULL)
)
INSERT INTO mcp_tools (id, connector_id, credential_id, name, enabled, credits_per_call, config_revision)
SELECT sqlc.arg(id)::uuid, connector_id, credential_id, name,
    sqlc.arg(enabled)::boolean, sqlc.arg(credits_per_call), config_revision
FROM setting WHERE name IS NOT NULL
ON CONFLICT (connector_id, credential_id, name) DO UPDATE SET
    enabled = EXCLUDED.enabled, credits_per_call = EXCLUDED.credits_per_call,
    config_revision = EXCLUDED.config_revision, updated_at = now(), deleted_at = NULL
RETURNING jsonb_build_object('id', mcp_tools.id, 'name', mcp_tools.name,
    'enabled', mcp_tools.enabled, 'credits_per_call', mcp_tools.credits_per_call);

-- name: UpdateIndependentTool :one
UPDATE mcp_tools t
SET enabled = sqlc.arg(enabled)::boolean, credits_per_call = 0, updated_at = now()
FROM connectors c
WHERE t.id = sqlc.arg(id)::uuid AND t.connector_id = sqlc.arg(connector_id)::uuid
    AND c.id = t.connector_id AND c.ownership_type = 'system'
    AND c.authorization_mode = 'independent' AND c.deleted_at IS NULL
    AND t.deleted_at IS NULL
RETURNING jsonb_build_object('id', t.id, 'name', t.name,
    'enabled', t.enabled, 'credits_per_call', t.credits_per_call);

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
    tools_synced_at = CASE WHEN (sqlc.arg(data)::jsonb->>'auth_change')::boolean THEN NULL ELSE tools_synced_at END,
    last_error = CASE WHEN (sqlc.arg(data)::jsonb->>'auth_change')::boolean THEN NULL ELSE last_error END,
    revision = revision + 1, updated_at = now()
WHERE id = (sqlc.arg(data)::jsonb->>'id')::uuid AND revoked_at IS NULL
RETURNING to_jsonb(connector_credentials);

-- name: RevokeCredential :exec
UPDATE connector_credentials SET revoked_at = now(), revision = revision + 1, updated_at = now() WHERE id = $1;

-- name: ListExpiringCredentials :many
SELECT to_jsonb(c) AS connector, to_jsonb(cr) AS credential
FROM connector_credentials cr
JOIN connectors c ON c.id = cr.connector_id
WHERE c.deleted_at IS NULL AND c.enabled AND c.authorization_method = 'oauth'
    AND cr.revoked_at IS NULL AND cr.config_revision = c.config_revision
    AND cr.oauth_refresh_token <> ''
    AND (cr.oauth_access_token = '' OR cr.oauth_expires_at <= now() + interval '30 seconds')
    AND (cr.user_id IS NULL OR EXISTS (
        SELECT 1 FROM users u WHERE u.id = cr.user_id AND u.status = 'active' AND u.deleted_at IS NULL
    ))
ORDER BY cr.oauth_expires_at NULLS FIRST, cr.id;

-- name: RefreshCredential :one
UPDATE connector_credentials SET oauth_access_token = $2, oauth_refresh_token = $3,
    oauth_expires_at = $4, updated_at = now()
WHERE id = $1 AND revoked_at IS NULL
RETURNING to_jsonb(connector_credentials);

-- name: ExpireCredential :exec
UPDATE connector_credentials SET oauth_access_token = '', oauth_refresh_token = '', oauth_expires_at = now(),
    revision = revision + 1, connection_status = 'error', last_error = 'OAuth 已失效，请重新授权',
    tools_synced_at = NULL, updated_at = now()
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
