-- name: LockIconProvider :one
SELECT
    to_jsonb (p)
FROM
    connector_providers p
WHERE
    id = $1
    AND ownership_type = 'system'
    AND deleted_at IS NULL
FOR UPDATE;

-- name: SetProviderIcon :execresult
UPDATE
    connector_providers
SET
    icon_s3_key = $2,
    revision = revision + 1,
    updated_at = now()
WHERE
    id = $1;

-- name: GetProviderIcon :one
SELECT
    icon_s3_key
FROM
    connector_providers
WHERE
    id = $1
    AND deleted_at IS NULL;

-- name: CreateOAuthRequest :execresult
INSERT INTO connector_oauth_requests (id, connector_id, user_id, centralized, config_revision, state_hash, verifier,
    redirect_uri, expires_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + interval '10 minutes');

-- name: GetOAuthStatus :one
SELECT
    jsonb_build_object('id', id, 'status', CASE WHEN status = 'pending'
            AND expires_at <= now() THEN
            'expired'
        ELSE
            status
        END)
FROM
    connector_oauth_requests
WHERE
    id = $1
    AND user_id = $2;

-- name: ConsumeOAuthRequest :one
UPDATE
    connector_oauth_requests
SET
    consumed_at = now(),
    status = 'processing'
WHERE
    state_hash = $1
    AND consumed_at IS NULL
    AND expires_at > now()
RETURNING
    to_jsonb (connector_oauth_requests);

-- name: SetOAuthStatus :execresult
UPDATE
    connector_oauth_requests
SET
    status = $2
WHERE
    id = $1;

-- name: UpsertOAuthCredential :execresult
INSERT INTO connector_credentials (connector_id, user_id, METHOD, oauth_access_token, oauth_refresh_token,
    oauth_expires_at, config_revision)
    VALUES (sqlc.arg(connector_id), NULLIF (sqlc.arg(user_id)::text, '')::uuid, 'oauth',
	sqlc.arg(oauth_access_token), sqlc.arg(oauth_refresh_token), sqlc.arg(oauth_expires_at), sqlc.arg(config_revision))
ON CONFLICT (connector_id, user_id)
    DO UPDATE SET
        oauth_access_token = EXCLUDED.oauth_access_token,
        oauth_refresh_token = EXCLUDED.oauth_refresh_token,
        oauth_expires_at = EXCLUDED.oauth_expires_at,
        config_revision = EXCLUDED.config_revision,
        status = 'authorized',
        revoked_at = NULL,
        updated_at = now();

-- name: InvalidateUserTools :execresult
UPDATE
    mcp_tools
SET
    deleted_at = now()
WHERE
    credential_id IN (
        SELECT
            cc.id
        FROM
            connector_credentials cc
        WHERE
            cc.connector_id = sqlc.arg(connector_id)
            AND cc.user_id IS NOT DISTINCT FROM NULLIF (sqlc.arg(user_id)::text, '')::uuid);

-- name: LockAuthorizedCredential :one
SELECT
    to_jsonb (c)
FROM
    connector_credentials c
WHERE
    id = $1
    AND revoked_at IS NULL
    AND status = 'authorized'
FOR UPDATE;

-- name: CredentialFresh :one
SELECT
    oauth_expires_at IS NULL
    OR oauth_expires_at > now() + interval '30 seconds'
FROM
    connector_credentials
WHERE
    id = $1;

-- name: RefreshCredential :one
UPDATE
    connector_credentials
SET
    oauth_access_token = $2,
    oauth_refresh_token = $3,
    oauth_expires_at = $4,
    updated_at = now()
WHERE
    id = $1
RETURNING
    to_jsonb (connector_credentials);

-- name: ListProviderReferences :many
SELECT
    jsonb_build_object('id', id, 'name', name, 'type', 'connector')
FROM
    connectors c
WHERE
    c.provider_id = $1
    AND c.deleted_at IS NULL
UNION ALL
SELECT
    jsonb_build_object('id', e.id, 'name', e.name, 'type', 'expert')
FROM
    experts e
    JOIN expert_connector_providers x ON x.expert_id = e.id
WHERE
    x.provider_id = $1
    AND e.deleted_at IS NULL;

-- name: ProviderInUse :one
SELECT
    EXISTS (
        SELECT
            1
        FROM
            connectors
        WHERE
            provider_id = $1
            AND deleted_at IS NULL);

-- name: UpdateProviderSecrets :execresult
UPDATE
    connectors
SET
    oauth_client_secret = $2,
    revision = revision + 1,
    updated_at = now()
WHERE
    provider_id = $1
    AND deleted_at IS NULL;

-- name: GetEnabledProvider :one
SELECT
    to_jsonb (p)
FROM
    connector_providers p
WHERE
    id = $1
    AND ownership_type = 'system'
    AND deleted_at IS NULL
    AND enabled FOR SHARE;

-- name: HasCentralCredential :one
SELECT
    EXISTS (
        SELECT
            1
        FROM
            connector_credentials
        WHERE
            connector_id = $1
            AND user_id IS NULL
            AND status = 'authorized'
            AND revoked_at IS NULL
            AND config_revision = $2
            AND (oauth_expires_at IS NULL
                OR oauth_expires_at > now()));

-- name: CountTools :one
SELECT
    count(*)
FROM
    mcp_tools
WHERE
    connector_id = $1
    AND deleted_at IS NULL;

-- name: GetIconKey :one
SELECT
    icon_s3_key
FROM
    connector_providers
WHERE
    id = $1;

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
    JOIN connector_providers p ON p.id = c.provider_id
WHERE
    c.id = $1
    AND c.deleted_at IS NULL
    AND c.enabled
    AND p.deleted_at IS NULL
    AND p.enabled;

-- name: GetCredential :one
SELECT
    to_jsonb (c)
FROM
    connector_credentials c
WHERE
    connector_id = sqlc.arg(connector_id)
    AND user_id IS NOT DISTINCT FROM NULLIF (sqlc.arg(user_id)::text, '')::uuid
    AND revoked_at IS NULL
    AND status = 'authorized'
    AND config_revision = sqlc.arg(config_revision);

-- name: RevokeCredential :execresult
UPDATE
    connector_credentials
SET
    revoked_at = now(),
    status = 'revoked',
    updated_at = now()
WHERE
    connector_id = sqlc.arg(connector_id)
    AND user_id IS NOT DISTINCT FROM NULLIF (sqlc.arg(user_id)::text, '')::uuid;

-- name: UpsertHeaderCredential :execresult
INSERT INTO connector_credentials (connector_id, user_id, METHOD, http_headers, config_revision)
    VALUES (sqlc.arg(connector_id), NULLIF (sqlc.arg(user_id)::text, '')::uuid, 'http_header',
	sqlc.arg(http_headers), sqlc.arg(config_revision))
ON CONFLICT (connector_id, user_id)
    DO UPDATE SET
        http_headers = EXCLUDED.http_headers,
        config_revision = EXCLUDED.config_revision,
        revoked_at = NULL,
        status = 'authorized',
        updated_at = now();

-- name: InvalidateConnectorUserTools :execresult
UPDATE
    mcp_tools mt
SET
    deleted_at = now()
WHERE
    mt.connector_id = sqlc.arg(connector_id)
    AND mt.credential_id IN (
        SELECT
            cc.id
        FROM
            connector_credentials cc
        WHERE
            cc.connector_id = sqlc.arg(connector_id)
            AND cc.user_id IS NOT DISTINCT FROM NULLIF (sqlc.arg(user_id)::text, '')::uuid);

-- name: CredentialCurrent :one
SELECT
    oauth_expires_at IS NULL
    OR oauth_expires_at > now()
FROM
    connector_credentials
WHERE
    id = $1;

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

-- name: MarkConnectionFailed :execresult
UPDATE
    connectors
SET
    connection_status = 'error',
    last_checked_at = now(),
    last_error = 'MCP 连接或工具发现失败',
    updated_at = now()
WHERE
    id = $1;

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
INSERT INTO mcp_tools (connector_id, credential_id, name, description, input_schema, config_revision)
    VALUES (sqlc.arg(connector_id), NULLIF (sqlc.arg(credential_id)::text, '')::uuid,
	sqlc.arg(name), sqlc.arg(description), sqlc.arg(input_schema), sqlc.arg(config_revision))
ON CONFLICT (connector_id, credential_id, name)
    DO UPDATE SET
        description = EXCLUDED.description,
        input_schema = EXCLUDED.input_schema,
        config_revision = EXCLUDED.config_revision,
        discovered_at = now(),
        updated_at = now(),
        deleted_at = NULL;

-- name: MarkConnected :execresult
UPDATE
    connectors
SET
    connection_status = 'connected',
    last_checked_at = now(),
    last_error = NULL,
    updated_at = now()
WHERE
    id = $1;

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
