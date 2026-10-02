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

-- name: RegisterDevice :one
INSERT INTO endpoints (
    user_id, machine_id, device_name, platform, os_version, arch, client_version,
    protocol_version, client_type, client_name, channel, locale, system_locale,
    timezone, runtime_version, engine_version, electron_version, last_reported_at
) VALUES (
    sqlc.arg(user_id)::uuid, sqlc.arg(machine_id)::uuid, sqlc.arg(device_name)::text,
    sqlc.arg(platform)::text, sqlc.arg(os_version)::text, sqlc.arg(arch)::text,
    sqlc.arg(client_version)::text, sqlc.narg(protocol_version)::integer,
    sqlc.narg(client_type)::text, sqlc.narg(client_name)::text, sqlc.narg(channel)::text,
    sqlc.narg(locale)::text, sqlc.narg(system_locale)::text, sqlc.narg(timezone)::text,
    sqlc.narg(runtime_version)::text, sqlc.narg(engine_version)::text,
    sqlc.narg(electron_version)::text, now()
)
ON CONFLICT (user_id, machine_id) DO UPDATE SET
    device_name = EXCLUDED.device_name, platform = EXCLUDED.platform,
    os_version = EXCLUDED.os_version, arch = EXCLUDED.arch,
    client_version = EXCLUDED.client_version, protocol_version = EXCLUDED.protocol_version,
    client_type = EXCLUDED.client_type, client_name = EXCLUDED.client_name,
    channel = EXCLUDED.channel, locale = EXCLUDED.locale,
    system_locale = EXCLUDED.system_locale, timezone = EXCLUDED.timezone,
    runtime_version = EXCLUDED.runtime_version, engine_version = EXCLUDED.engine_version,
    electron_version = EXCLUDED.electron_version, last_reported_at = now(), updated_at = now()
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
