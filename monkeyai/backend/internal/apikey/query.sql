-- name: CreateKey :one
INSERT INTO api_keys (user_id, name, key_prefix, key_hash, scopes, expires_at)
    VALUES ($1, $2, $3, $4, $5, $6)
RETURNING
    id, user_id, name, key_prefix, scopes, expires_at, last_used_at, created_at, revoked_at;

-- name: AuthenticateKey :one
SELECT
    k.id,
    k.user_id
FROM
    api_keys k
    JOIN users u ON u.id = k.user_id
WHERE
    k.key_hash = sqlc.arg(key_hash)
    AND sqlc.arg(scope)::text = ANY (k.scopes)
    AND k.revoked_at IS NULL
    AND k.expires_at > now()
    AND u.status = 'active'
    AND u.deleted_at IS NULL;

-- name: TouchKey :execresult
UPDATE
    api_keys
SET
    last_used_at = now()
WHERE
    id = $1
    AND (last_used_at IS NULL
        OR last_used_at < now() - interval '5 minutes');

-- name: ListKeys :many
SELECT
    k.id,
    k.user_id,
    u.name AS user_name,
    k.name,
    k.key_prefix,
    k.scopes,
    k.expires_at,
    k.last_used_at,
    k.created_at,
    k.revoked_at
FROM
    api_keys k
    JOIN users u ON u.id = k.user_id
WHERE (sqlc.arg(all_users)::boolean
    OR k.user_id = NULLIF (sqlc.arg(user_id)::text, '')::uuid)
ORDER BY
    k.created_at DESC;

-- name: RevokeKey :execrows
UPDATE
    api_keys
SET
    revoked_at = now()
WHERE
    id = sqlc.arg(id)
    AND revoked_at IS NULL
    AND (sqlc.arg(user_id)::text = ''
        OR user_id = NULLIF (sqlc.arg(user_id)::text, '')::uuid);
