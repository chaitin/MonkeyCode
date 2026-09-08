-- name: LockGroups :execresult
SELECT
    pg_advisory_xact_lock(741209);

-- name: GetGroup :one
SELECT
    id
FROM
    GROUPS
WHERE
    id = $1
    AND deleted_at IS NULL;

-- name: LockBillingGroup :one
SELECT
    billing_group_id
FROM
    users
WHERE
    id = $1
    AND deleted_at IS NULL
FOR UPDATE;

-- name: SetBillingGroup :execresult
UPDATE
    users
SET
    billing_group_id = $2,
    updated_at = now()
WHERE
    id = $1;

-- name: LockInitialAdmin :execresult
SELECT
    pg_advisory_xact_lock(hashtext('monkeyai:initial-admin'));

-- name: CountUsers :one
SELECT
    count(*)
FROM
    users
WHERE
    deleted_at IS NULL;

-- name: CreateInitialAdmin :execresult
INSERT INTO users (name, email, password_hash, ROLE, status)
    VALUES ($1, $2, $3, 'admin', 'active');

-- name: GetPasswordUser :one
SELECT
    id,
    name,
    email,
    coalesce(avatar_url, '')::text AS avatar_url,
    ROLE,
    status,
    joined_at,
    last_login_at,
    password_hash
FROM
    users
WHERE
    lower(email) = $1
    AND ROLE = sqlc.arg(role)
    AND status = 'active'
    AND deleted_at IS NULL
    AND password_hash IS NOT NULL;

-- name: TouchLogin :execresult
UPDATE
    users
SET
    last_login_at = now(),
    updated_at = now()
WHERE
    id = $1;

-- name: CreateAuthorizationRequest :one
INSERT INTO oauth_authorization_requests (client_id, redirect_uri, state, code_challenge, code_challenge_method, expires_at)
    VALUES ($1, $2, $3, $4, $5, $6)
RETURNING
    id;

-- name: GetAuthorizationRequest :one
SELECT
    id,
    client_id,
    redirect_uri,
    state,
    code_challenge,
    code_challenge_method,
    expires_at,
    completed_at
FROM
    oauth_authorization_requests
WHERE
    id = $1;

-- name: CompleteAuthorizationRequest :execresult
UPDATE
    oauth_authorization_requests
SET
    completed_at = now()
WHERE
    id = $1
    AND completed_at IS NULL
    AND expires_at > now();

-- name: CreateAuthorizationCode :execresult
INSERT INTO oauth_authorization_codes (code_hash, authorization_request_id, user_id, client_id, redirect_uri,
    code_challenge, expires_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7);

-- name: GetAuthorizationCode :one
SELECT
    id,
    user_id,
    client_id,
    redirect_uri,
    code_challenge,
    expires_at,
    redeemed_at
FROM
    oauth_authorization_codes
WHERE
    code_hash = $1;

-- name: RedeemAuthorizationCode :execresult
UPDATE
    oauth_authorization_codes
SET
    redeemed_at = now()
WHERE
    id = $1
    AND redeemed_at IS NULL
    AND expires_at > now();

-- name: CreateToken :execresult
INSERT INTO oauth_tokens (user_id, client_id, access_token_hash, refresh_token_hash, access_expires_at, refresh_expires_at)
    VALUES ($1, $2, $3, $4, $5, $6);

-- name: RevokeRefreshToken :one
UPDATE
    oauth_tokens
SET
    revoked_at = now()
WHERE
    refresh_token_hash = $1
    AND client_id = $2
    AND revoked_at IS NULL
    AND refresh_expires_at > now()
RETURNING
    user_id;

-- name: CreateLoginState :execresult
INSERT INTO oauth_login_states (state_hash, connection_id, authorization_request_id, purpose, expires_at)
    VALUES (sqlc.arg(state_hash), sqlc.arg(connection_id), NULLIF (sqlc.arg(authorization_request_id)::text, '')::uuid,
	sqlc.arg(purpose), sqlc.arg(expires_at));

-- name: ConsumeLoginState :one
UPDATE
    oauth_login_states
SET
    consumed_at = now()
WHERE
    state_hash = $1
    AND consumed_at IS NULL
    AND expires_at > now()
RETURNING
    connection_id,
    coalesce(authorization_request_id::text, '')::text AS authorization_request_id,
    purpose;

-- name: CreateBrowserSession :execresult
INSERT INTO browser_sessions (token_hash, user_id, authentication_method, expires_at)
    VALUES ($1, $2, $3, $4);

-- name: GetBrowserUser :one
SELECT
    u.id,
    u.name,
    u.email,
    coalesce(u.avatar_url, '')::text AS avatar_url,
    u.role,
    u.status,
    u.joined_at,
    u.last_login_at,
    s.authentication_method
FROM
    browser_sessions s
    JOIN users u ON u.id = s.user_id
WHERE
    s.token_hash = $1
    AND s.revoked_at IS NULL
    AND s.expires_at > now()
    AND u.status = 'active'
    AND u.deleted_at IS NULL;

-- name: GetTokenUser :one
SELECT
    u.id,
    u.name,
    u.email,
    coalesce(u.avatar_url, '')::text AS avatar_url,
    u.role,
    u.status,
    u.joined_at,
    u.last_login_at
FROM
    oauth_tokens t
    JOIN users u ON u.id = t.user_id
WHERE
    t.access_token_hash = $1
    AND t.revoked_at IS NULL
    AND t.access_expires_at > now()
    AND u.status = 'active'
    AND u.deleted_at IS NULL;

-- name: RevokeBrowserSession :execresult
UPDATE
    browser_sessions
SET
    revoked_at = now()
WHERE
    token_hash = $1
    AND revoked_at IS NULL;

-- name: RevokeToken :execresult
UPDATE
    oauth_tokens
SET
    revoked_at = now()
WHERE
    client_id = $2
    AND revoked_at IS NULL
    AND (access_token_hash = $1
        OR refresh_token_hash = $1);

-- name: ListUsers :many
SELECT
    id,
    name,
    email,
    coalesce(avatar_url, '')::text AS avatar_url,
    ROLE,
    status,
    joined_at,
    last_login_at
FROM
    users
WHERE
    deleted_at IS NULL
ORDER BY
    joined_at DESC;

-- name: CreateUser :one
INSERT INTO users (name, email, ROLE, password_hash)
    VALUES ($1, $2, $3, $4)
RETURNING
    id, name, email, coalesce(avatar_url, '')::text AS avatar_url, ROLE, status, joined_at, last_login_at;

-- name: GetUser :one
SELECT
    id,
    name,
    email,
    coalesce(avatar_url, '')::text AS avatar_url,
    ROLE,
    status,
    joined_at,
    last_login_at
FROM
    users
WHERE
    id = $1
    AND deleted_at IS NULL;

-- name: UpdateUser :one
UPDATE
    users
SET
    name = sqlc.arg(name),
    ROLE = sqlc.arg(role),
    status = sqlc.arg(status),
    disabled_at = sqlc.arg(disabled_at),
    password_hash = CASE WHEN sqlc.arg(password_hash)::text = '' THEN
        password_hash
    ELSE
        sqlc.arg(password_hash)::text
    END,
    updated_at = now()
WHERE
    id = sqlc.arg(id)
    AND deleted_at IS NULL
RETURNING
    id,
    name,
    email,
    coalesce(avatar_url, '')::text AS avatar_url,
    ROLE,
    status,
    joined_at,
    last_login_at;

-- name: GetIdentityUser :one
SELECT
    u.id,
    u.name,
    u.email,
    coalesce(u.avatar_url, '')::text AS avatar_url,
    u.role,
    u.status,
    u.joined_at,
    u.last_login_at
FROM
    user_identities i
    JOIN users u ON u.id = i.user_id
WHERE
    i.provider = $1
    AND i.issuer = $2
    AND i.provider_subject = $3
    AND i.deleted_at IS NULL
    AND u.deleted_at IS NULL;

-- name: UpdateIdentityUser :one
UPDATE
    users
SET
    name = sqlc.arg(name),
    avatar_url = NULLIF (sqlc.arg(avatar_url)::text, ''),
    last_login_at = now(),
    updated_at = now()
WHERE
    id = sqlc.arg(id)
RETURNING
    id,
    name,
    email,
    coalesce(avatar_url, '')::text AS avatar_url,
    ROLE,
    status,
    joined_at,
    last_login_at;

-- name: GetUserByEmail :one
SELECT
    id,
    name,
    email,
    coalesce(avatar_url, '')::text AS avatar_url,
    ROLE,
    status,
    joined_at,
    last_login_at
FROM
    users
WHERE
    lower(email) = lower($1)
    AND deleted_at IS NULL;

-- name: CreateIdentityUser :one
INSERT INTO users (name, email, avatar_url, ROLE, last_login_at)
    VALUES (sqlc.arg(name), sqlc.arg(email), NULLIF (sqlc.arg(avatar_url)::text, ''),
	'user', now())
ON CONFLICT (lower(email))
WHERE
    deleted_at IS NULL
        DO UPDATE SET
            name = EXCLUDED.name,
            avatar_url = EXCLUDED.avatar_url,
            last_login_at = now(),
            updated_at = now()
        WHERE
            users.role = 'user'
            AND users.status = 'active'
        RETURNING
            id,
            name,
            email,
            coalesce(avatar_url, '')::text AS avatar_url,
            ROLE,
            status,
            joined_at,
            last_login_at;

-- name: UpsertIdentity :execresult
INSERT INTO user_identities (user_id, provider, issuer, provider_subject, username, email, avatar_url)
    VALUES (sqlc.arg(user_id), sqlc.arg(provider), sqlc.arg(issuer), sqlc.arg(provider_subject),
	NULLIF (sqlc.arg(provider_username)::text, ''), NULLIF(sqlc.arg(provider_email)::text,''), NULLIF (sqlc.arg(provider_avatar_url)::text, ''));

-- name: SearchUsers :many
SELECT
    id,
    name,
    email
FROM
    users
WHERE
    status = 'active'
    AND deleted_at IS NULL
    AND id <> $1
    AND (strpos(lower(name), lower($2)) > 0
        OR strpos(lower(email), lower($2)) > 0)
ORDER BY
    lower(name),
    id
LIMIT $3;

-- name: LockEmailDelivery :exec
SELECT pg_advisory_xact_lock(741210);

-- name: CleanEmailDeliveries :exec
DELETE FROM email_code_deliveries WHERE created_at < now() - interval '1 hour';

-- name: CleanEmailCodes :exec
DELETE FROM email_codes WHERE expires_at < now();

-- name: EmailDeliveryLimited :one
SELECT (count(*) FILTER (WHERE email = sqlc.arg(email)) >= 10
 OR count(*) FILTER (WHERE ip_hash = sqlc.arg(ip_hash)) >= 30
 OR count(*) FILTER (WHERE email = sqlc.arg(email) AND created_at > now() - interval '1 minute') > 0)::boolean AS limited
FROM email_code_deliveries;

-- name: RecordEmailDelivery :exec
INSERT INTO email_code_deliveries (email, ip_hash) VALUES ($1, $2);

-- name: SaveEmailCode :exec
INSERT INTO email_codes (email, purpose, code_hash, expires_at) VALUES ($1, $2, $3, $4)
ON CONFLICT (email, purpose) DO UPDATE SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, attempts = 0, ready = false;

-- name: ReadyEmailCode :exec
UPDATE email_codes SET ready = true WHERE email = $1 AND purpose = $2 AND code_hash = $3;

-- name: GetEmailCode :one
SELECT code_hash, attempts FROM email_codes WHERE email = $1 AND purpose = $2 AND ready AND expires_at > now() FOR UPDATE;

-- name: FailEmailCode :exec
UPDATE email_codes SET attempts = attempts + 1 WHERE email = $1 AND purpose = $2;

-- name: DeleteEmailCode :exec
DELETE FROM email_codes WHERE email = $1 AND purpose = $2;

-- name: ResetPassword :one
UPDATE users SET password_hash = $2, updated_at = now()
WHERE lower(email) = $1 AND deleted_at IS NULL AND status = 'active' RETURNING id;

-- name: RevokeUserSessions :exec
UPDATE browser_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL;

-- name: RevokeUserTokens :exec
UPDATE oauth_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL;

-- name: RevokeUserCodes :exec
UPDATE oauth_authorization_codes SET redeemed_at = now() WHERE user_id = $1 AND redeemed_at IS NULL;
