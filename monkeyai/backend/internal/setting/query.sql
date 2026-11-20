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
        value = EXCLUDED.value,
        schema_version = EXCLUDED.schema_version,
        updated_by_user_id = EXCLUDED.updated_by_user_id,
        updated_at = now()
    RETURNING KEY,
    value,
    schema_version,
    updated_by_user_id,
    updated_at;
