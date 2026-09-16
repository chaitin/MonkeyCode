-- name: LockUser :one
SELECT id FROM users WHERE id = $1 AND status = 'active' AND deleted_at IS NULL FOR UPDATE;

-- name: Active :many
SELECT * FROM endpoints WHERE user_id = $1 AND status = 'active' ORDER BY machine_id;

-- name: Get :one
SELECT * FROM endpoints WHERE user_id = $1 AND machine_id = $2;

-- name: Page :many
SELECT * FROM endpoints WHERE user_id = $1 ORDER BY created_at DESC, id DESC
LIMIT sqlc.arg(page_size)::integer OFFSET sqlc.arg(page_offset)::integer;

-- name: Count :one
SELECT count(*) FROM endpoints WHERE user_id = $1;

-- name: CountActive :one
SELECT count(*) FROM endpoints WHERE user_id = $1 AND status = 'active';

-- name: Register :one
INSERT INTO endpoints (user_id, machine_id, device_name, platform, os_version, arch, client_version, protocol_version, last_seen_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,1,now())
ON CONFLICT (user_id, machine_id) DO UPDATE SET
    device_name = EXCLUDED.device_name, platform = EXCLUDED.platform,
    os_version = EXCLUDED.os_version, arch = EXCLUDED.arch, client_version = EXCLUDED.client_version,
    protocol_version = 1, last_seen_at = now(), updated_at = now()
WHERE endpoints.status = 'active'
RETURNING *;

-- name: Rename :one
UPDATE endpoints SET alias = sqlc.narg(alias)::text, updated_at = now()
WHERE user_id = $1 AND machine_id = $2 RETURNING *;

-- name: Status :one
UPDATE endpoints SET status = sqlc.arg(status)::text,
    revoked_at = CASE WHEN sqlc.arg(status)::text = 'revoked' THEN now() ELSE NULL END,
    updated_at = now()
WHERE user_id = $1 AND machine_id = $2 RETURNING *;

-- name: Touch :exec
UPDATE endpoints SET last_seen_at = greatest(last_seen_at, sqlc.arg(seen_at)::timestamptz)
WHERE user_id = $1 AND machine_id = $2;
