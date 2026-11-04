-- name: GetSetting :one
SELECT
    KEY,
    value,
    schema_version,
    updated_by_user_id,
    updated_at
FROM
    settings
WHERE
    KEY = $1;

-- name: ListSettings :many
SELECT
    KEY,
    value,
    schema_version,
    updated_by_user_id,
    updated_at
FROM
    settings
ORDER BY
    KEY;

-- name: ProxyInUse :one
SELECT EXISTS (
    SELECT 1 FROM models m WHERE m.proxy_id = $1 AND m.deleted_at IS NULL
    UNION ALL
    SELECT 1 FROM connectors c WHERE c.proxy_id = $1 AND c.deleted_at IS NULL
);

-- name: PutSetting :one
INSERT INTO settings (KEY, value, schema_version, updated_by_user_id)
    VALUES ($1, $2, $3, $4)
ON CONFLICT (KEY)
    DO UPDATE SET
        value = CASE WHEN settings.key = 'branding' THEN
            (EXCLUDED.value - 'logo_s3_key' - 'logo_url') ||
            CASE WHEN settings.value ? 'logo_s3_key' THEN jsonb_build_object('logo_s3_key', settings.value -> 'logo_s3_key') ELSE '{}'::jsonb END
            ELSE EXCLUDED.value END,
        schema_version = EXCLUDED.schema_version,
        updated_by_user_id = EXCLUDED.updated_by_user_id,
        updated_at = now()
    RETURNING KEY,
    value,
    schema_version,
    updated_by_user_id,
    updated_at;

-- name: PutBranding :one
INSERT INTO settings (key, value, schema_version, updated_by_user_id)
VALUES ('branding', jsonb_build_object('workspace_name', sqlc.arg(workspace_name)::text, 'product_name', sqlc.arg(product_name)::text) ||
    CASE WHEN sqlc.arg(logo_key)::text = '' THEN '{}'::jsonb ELSE jsonb_build_object('logo_s3_key', sqlc.arg(logo_key)::text) END,
    1, sqlc.arg(user_id)::uuid)
ON CONFLICT (key) DO UPDATE SET
    value = (settings.value - 'workspace_name' - 'product_name' - 'logo_s3_key' - 'logo_url') || EXCLUDED.value,
    updated_by_user_id = EXCLUDED.updated_by_user_id,
    updated_at = now(),
    revision = settings.revision + 1
RETURNING key, value, schema_version, updated_by_user_id, updated_at;

-- name: PutBrandingLogo :one
INSERT INTO settings (key, value, schema_version, updated_by_user_id)
VALUES ('branding', jsonb_build_object('workspace_name', 'Monkey AI', 'product_name', 'MonkeyAI') ||
    CASE WHEN sqlc.arg(logo_key)::text = '' THEN '{}'::jsonb ELSE jsonb_build_object('logo_s3_key', sqlc.arg(logo_key)::text) END,
    1, sqlc.arg(user_id)::uuid)
ON CONFLICT (key) DO UPDATE SET
    value = (settings.value - 'logo_s3_key' - 'logo_url') ||
        CASE WHEN sqlc.arg(logo_key)::text = '' THEN '{}'::jsonb ELSE jsonb_build_object('logo_s3_key', sqlc.arg(logo_key)::text) END,
    updated_by_user_id = EXCLUDED.updated_by_user_id,
    updated_at = now(),
    revision = settings.revision + 1
RETURNING key, value, schema_version, updated_by_user_id, updated_at;
