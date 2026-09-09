-- name: ListModels :many
SELECT
    *
FROM
    models
WHERE
    deleted_at IS NULL
    AND ($1::text = ''
        OR ownership_type = $1::text)
ORDER BY
    created_at DESC;

-- name: GetModel :one
SELECT
    *
FROM
    models
WHERE
    id = $1
    AND deleted_at IS NULL;

-- name: CreateModel :one
INSERT INTO models (ownership_type, owner_user_id, model_id, display_name, protocol, base_url, api_key,
    advanced_config, credit_multiplier, enabled)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE)
RETURNING
    *;

-- name: UpdateModel :one
UPDATE
    models
SET
    model_id = $2,
    display_name = $3,
    protocol = $4,
    base_url = $5,
    api_key = $6,
    advanced_config = $7,
    credit_multiplier = $8,
    updated_at = now()
WHERE
    id = $1
    AND ownership_type = $9
    AND owner_user_id = $10
    AND deleted_at IS NULL
RETURNING
    *;

-- name: SetEnabled :one
UPDATE
    models
SET
    enabled = $2,
    updated_at = now()
WHERE
    id = $1
    AND ownership_type = 'system'
    AND deleted_at IS NULL
RETURNING
    *;

-- name: DeleteModel :execresult
UPDATE
    models
SET
    deleted_at = now(),
    enabled = FALSE,
    updated_at = now()
WHERE
    id = sqlc.arg(id)
    AND ownership_type = sqlc.arg(ownership_type)
    AND (sqlc.arg(ownership_type) = 'system'
        OR owner_user_id = NULLIF (sqlc.arg(owner_user_id)::text, '')::uuid)
    AND deleted_at IS NULL;

-- name: DeleteGrants :execresult
DELETE FROM resource_access_grants
WHERE resource_type = 'model'
    AND resource_id = $1;

-- name: ListAvailable :many
WITH RECURSIVE user_groups (
    group_id
) AS (
    SELECT
        id
    FROM
        GROUPS
    WHERE
        deleted_at IS NULL
        AND id IN (
            SELECT
                group_id
            FROM
                group_users
            WHERE
                user_id = sqlc.arg(owner_user_id)
                AND removed_at IS NULL)
        UNION
        SELECT
            parent.id
        FROM
            GROUPS g
            JOIN user_groups ug ON ug.group_id = g.id
            JOIN GROUPS parent ON parent.id = g.parent_id
        WHERE
            parent.deleted_at IS NULL
            AND g.deleted_at IS NULL
)
SELECT
    m.*
FROM
    models m
WHERE
    m.enabled
    AND m.deleted_at IS NULL
    AND (m.ownership_type = 'user' OR sqlc.arg(system_access)::boolean)
    AND ((sqlc.arg(is_admin)::boolean
            AND m.ownership_type = 'system')
        OR m.owner_user_id = sqlc.arg(owner_user_id)
        OR EXISTS (
            SELECT
                1
            FROM
                resource_access_grants rag
            WHERE
                rag.resource_type = 'model'
                AND rag.resource_id = m.id
                AND ((rag.all_users AND EXISTS (
                        SELECT 1 FROM users u WHERE u.id = sqlc.arg(owner_user_id) AND u.status = 'active' AND u.deleted_at IS NULL
                    ))
                    OR rag.user_id = sqlc.arg(owner_user_id)
                    OR rag.group_id IN (
                        SELECT
                            group_id
                        FROM
                            user_groups))))
    ORDER BY
        m.display_name,
        m.id;

-- name: ResolveModel :one
WITH RECURSIVE user_groups(group_id) AS (
    SELECT id
    FROM groups
    WHERE deleted_at IS NULL
        AND id IN (
            SELECT group_id FROM group_users
            WHERE user_id = sqlc.arg(user_id) AND removed_at IS NULL
        )
    UNION
    SELECT parent.id
    FROM groups g
    JOIN user_groups ug ON ug.group_id = g.id
    JOIN groups parent ON parent.id = g.parent_id
    WHERE parent.deleted_at IS NULL AND g.deleted_at IS NULL
)
SELECT m.*
FROM models m
JOIN users u ON u.id = sqlc.arg(user_id)
WHERE (m.id::text = sqlc.arg(requested_model)::text OR m.model_id = sqlc.arg(requested_model)::text)
    AND m.enabled AND m.deleted_at IS NULL
    AND (m.ownership_type = 'user' OR sqlc.arg(system_access)::boolean)
    AND (
        (u.role = 'admin' AND m.ownership_type = 'system')
        OR m.owner_user_id = sqlc.arg(user_id)
        OR EXISTS (
            SELECT 1 FROM resource_access_grants rag
            WHERE rag.resource_type = 'model' AND rag.resource_id = m.id
                AND ((rag.all_users AND u.status = 'active' AND u.deleted_at IS NULL)
                    OR rag.user_id = sqlc.arg(user_id) OR rag.group_id IN (SELECT group_id FROM user_groups))
        )
    )
ORDER BY (m.id::text = sqlc.arg(requested_model)::text) DESC, m.created_at, m.id
LIMIT 1;

-- name: ListGroups :many
SELECT
    id,
    parent_id,
    name
FROM
    GROUPS
WHERE
    deleted_at IS NULL
ORDER BY
    name,
    id;

-- name: ListUsers :many
SELECT
    id,
    name,
    email
FROM
    users
WHERE
    status = 'active'
    AND deleted_at IS NULL
ORDER BY
    name,
    id;

-- name: ListGrants :many
SELECT
    resource_id,
    user_id,
    group_id,
    all_users
FROM
    resource_access_grants
WHERE
    resource_type = 'model'
    AND resource_id::text = ANY ($1::text[])
ORDER BY
    resource_id,
    id;

-- name: GrantUser :execresult
INSERT INTO resource_access_grants (resource_type, resource_id, user_id, access_level, granted_by_user_id)
    VALUES ('model', $1, $2, 'read_only', $3);

-- name: GrantGroup :execresult
INSERT INTO resource_access_grants (resource_type, resource_id, group_id, access_level, granted_by_user_id)
    VALUES ('model', $1, $2, 'read_only', $3);

-- name: GrantAllUsers :execresult
INSERT INTO resource_access_grants (resource_type, resource_id, all_users, access_level, granted_by_user_id)
    VALUES ('model', $1, true, 'read_only', $2);

-- name: LockOwned :one
SELECT
    id
FROM
    models
WHERE
    id = $1
    AND owner_user_id = $2
    AND ownership_type = 'user'
    AND deleted_at IS NULL
FOR UPDATE;

-- name: TouchModel :execresult
UPDATE
    models
SET
    updated_at = now()
WHERE
    id = $1;

-- name: ListPeople :many
SELECT
    m.id AS model_id,
    u.id AS user_id,
    u.name,
    u.email,
    TRUE AS creator
FROM
    models m
    JOIN users u ON u.id = m.owner_user_id
WHERE
    m.id::text = ANY (sqlc.arg(model_ids)::text[])
    AND m.owner_user_id <> sqlc.arg(owner_user_id)
UNION ALL
SELECT
    m.id AS model_id,
    u.id AS user_id,
    u.name,
    u.email,
    FALSE AS creator
FROM
    models m
    JOIN resource_access_grants g ON g.resource_type = 'model'
        AND g.resource_id = m.id
    JOIN users u ON u.id = g.user_id
WHERE
    m.id::text = ANY (sqlc.arg(model_ids)::text[])
    AND m.owner_user_id = sqlc.arg(owner_user_id)
    AND u.id <> sqlc.arg(owner_user_id)
    AND u.deleted_at IS NULL
ORDER BY
    1,
    3,
    2;
