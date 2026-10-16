-- name: CreateKey :one
INSERT INTO api_keys (user_id, name, key_prefix, key_hash, scopes, expires_at,machine_id,runtime_grant_id)
SELECT $1,$2,$3,$4,$5,$6,sqlc.narg(machine_id)::uuid,sqlc.narg(runtime_grant_id)::uuid
WHERE sqlc.narg(runtime_grant_id)::uuid IS NULL OR EXISTS (
    SELECT 1 FROM oauth_grants g JOIN endpoints e ON e.user_id=g.user_id AND e.machine_id=g.machine_id
    WHERE g.id=sqlc.narg(runtime_grant_id)::uuid AND g.user_id=$1 AND g.machine_id=sqlc.narg(machine_id)::uuid
        AND g.purpose='runtime' AND g.revoked_at IS NULL AND g.expires_at>now()
        AND e.active_grant_id=g.id AND e.deployment_mode='standalone' AND e.remote_access_state='enabled'
)
RETURNING *;

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
    AND (k.runtime_grant_id IS NULL OR EXISTS (
        SELECT 1 FROM oauth_grants g JOIN endpoints e ON e.user_id=g.user_id AND e.machine_id=g.machine_id
        WHERE g.id=k.runtime_grant_id AND g.user_id=k.user_id AND g.machine_id=k.machine_id AND g.purpose='runtime'
            AND g.revoked_at IS NULL AND g.expires_at>now() AND e.active_grant_id=g.id
            AND e.remote_access_state='enabled' AND e.deployment_mode='standalone'))
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
    k.revoked_at,
    k.machine_id,
    k.runtime_grant_id
FROM
    api_keys k
    JOIN users u ON u.id = k.user_id
WHERE (sqlc.arg(all_users)::boolean
    OR k.user_id = NULLIF (sqlc.arg(user_id)::text, '')::uuid)
    AND (sqlc.arg(runtime_grant_id)::text='' OR k.runtime_grant_id=NULLIF(sqlc.arg(runtime_grant_id)::text,'')::uuid)
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
        OR user_id = NULLIF (sqlc.arg(user_id)::text, '')::uuid)
    AND (sqlc.arg(runtime_grant_id)::text='' OR runtime_grant_id=NULLIF(sqlc.arg(runtime_grant_id)::text,'')::uuid);

-- name: RevokeRuntimeKeys :exec
UPDATE api_keys SET revoked_at=coalesce(revoked_at,now()) WHERE runtime_grant_id=$1;

-- name: CleanupRuntimeKeys :exec
UPDATE api_keys k SET revoked_at=now()
WHERE k.runtime_grant_id IS NOT NULL AND k.revoked_at IS NULL AND NOT EXISTS (
    SELECT 1 FROM oauth_grants g WHERE g.id=k.runtime_grant_id AND g.revoked_at IS NULL AND g.expires_at>now());
