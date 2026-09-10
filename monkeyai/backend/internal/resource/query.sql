-- name: ListGroups :many
SELECT
    jsonb_build_object('id', id, 'parent_id', parent_id, 'name', name)
FROM
    GROUPS
WHERE
    deleted_at IS NULL
ORDER BY
    name,
    id;

-- name: ListUsers :many
SELECT
    jsonb_build_object('id', id, 'name', name, 'email', email)
FROM
    users
WHERE
    deleted_at IS NULL
    AND status = 'active'
ORDER BY
    name,
    id;

-- name: ListTags :many
SELECT
    jsonb_build_object('id', id, 'name', name)
FROM
    tags
WHERE
    deleted_at IS NULL
ORDER BY
    lower(name),
    id;

-- name: CreateTag :one
INSERT INTO tags (name, created_by_user_id)
    VALUES ($1, $2)
RETURNING
    jsonb_build_object('id', id, 'name', name);

-- name: UpdateTag :one
UPDATE
    tags
SET
    name = $2,
    updated_at = now()
WHERE
    id = $1
    AND deleted_at IS NULL
RETURNING
    jsonb_build_object('id', id, 'name', name);

-- name: DeleteTag :one
UPDATE
    tags
SET
    deleted_at = now(),
    updated_at = now()
WHERE
    id = $1
    AND deleted_at IS NULL
RETURNING
    jsonb_build_object('id', id);

-- name: LockRecipients :many
SELECT
    id
FROM
    users
WHERE
    id::text = ANY ($1::text[])
    AND deleted_at IS NULL
    AND status = 'active'
ORDER BY
    id FOR SHARE;

-- name: RevokeShares :execresult
DELETE FROM resource_access_grants
WHERE resource_type = sqlc.arg(resource_type)
    AND resource_id = sqlc.arg(resource_id)
    AND user_id::text = ANY (sqlc.arg(user_ids)::text[]);

-- name: CreateShares :execresult
INSERT INTO resource_access_grants (resource_type, resource_id, user_id, access_level, granted_by_user_id)
SELECT
    sqlc.arg(resource_type),
    sqlc.arg(resource_id),
    u.id,
    'read_only',
    sqlc.arg(granted_by_user_id)
FROM
    users u
WHERE
    u.id::text = ANY (sqlc.arg(user_ids)::text[])
ON CONFLICT (resource_type,
    resource_id,
    user_id)
WHERE
    user_id IS NOT NULL
        DO NOTHING;

-- name: HasAccess :one
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
                user_id = sqlc.narg(user_id)
                AND removed_at IS NULL)
        UNION
        SELECT
            parent.id
        FROM
            GROUPS g
            JOIN user_groups ug ON ug.group_id = g.id
            JOIN GROUPS parent ON parent.id = g.parent_id
        WHERE
            g.deleted_at IS NULL
            AND parent.deleted_at IS NULL
)
SELECT
    EXISTS (
        SELECT
            1
        FROM
            resource_access_grants rag
        WHERE
            rag.resource_type = sqlc.arg(resource_type)
            AND rag.resource_id = sqlc.arg(resource_id)
            AND ((rag.all_users AND EXISTS (
                    SELECT 1 FROM users u WHERE u.id = sqlc.narg(user_id) AND u.status = 'active' AND u.deleted_at IS NULL
                ))
                OR rag.user_id = sqlc.narg(user_id)
                OR rag.group_id IN (
                    SELECT
                        group_id
                    FROM
                        user_groups)));

-- name: ListGrants :many
SELECT
    jsonb_build_object('user_id', rag.user_id, 'group_id', rag.group_id, 'all_users', rag.all_users, 'usage_requirement', rag.usage_requirement,
        'user', CASE WHEN u.id IS NOT NULL THEN jsonb_build_object('id', u.id, 'name', u.name, 'email', u.email) END)
FROM
    resource_access_grants rag
    LEFT JOIN users u ON u.id = rag.user_id AND u.deleted_at IS NULL
WHERE
    rag.resource_type = $1
    AND rag.resource_id = $2
ORDER BY
    rag.group_id,
    rag.user_id;

-- name: ListSharedUsers :many
SELECT
    rag.resource_id,
    u.id,
    u.name,
    u.email
FROM
    resource_access_grants rag
    JOIN users u ON u.id = rag.user_id AND u.deleted_at IS NULL
WHERE
    rag.resource_type = sqlc.arg(resource_type)
    AND rag.resource_id::text = ANY (sqlc.arg(resource_ids)::text[])
ORDER BY
    rag.resource_id,
    u.id;

-- name: DeleteGrants :execresult
DELETE FROM resource_access_grants
WHERE resource_type = $1
    AND resource_id = $2;

-- name: SubjectExists :one
SELECT
    EXISTS (
        SELECT
            1
        FROM
            users
        WHERE
            id = NULLIF (sqlc.arg(user_id)::text, '')::uuid
            AND deleted_at IS NULL
            AND status = 'active'
        UNION ALL
        SELECT
            1
        FROM
            GROUPS
        WHERE
            id = NULLIF (sqlc.arg(group_id)::text, '')::uuid
            AND deleted_at IS NULL);

-- name: CreateGrant :execresult
INSERT INTO resource_access_grants (resource_type, resource_id, user_id, group_id, all_users, access_level, usage_requirement,
    granted_by_user_id)
    VALUES (sqlc.arg(resource_type), sqlc.arg(resource_id), NULLIF (sqlc.arg(user_id)::text,
	'')::UUID,NULLIF(sqlc.arg(group_id)::text,'')::uuid, sqlc.arg(all_users), 'read_only', sqlc.arg(usage_requirement), sqlc.arg(granted_by_user_id));

-- name: GetOwnerName :one
SELECT
    name
FROM
    users
WHERE
    id = $1;

-- name: CanUseSystem :one
SELECT EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = $1 AND u.status = 'active' AND u.deleted_at IS NULL
        AND (NOT EXISTS (
            SELECT 1 FROM settings WHERE key = 'billing' AND value->>'charging_mode' = 'remote'
        ) OR EXISTS (
            SELECT 1 FROM user_identities i
            WHERE i.user_id = u.id AND i.provider = 'baizhiyun' AND i.deleted_at IS NULL
        ))
)::boolean;
