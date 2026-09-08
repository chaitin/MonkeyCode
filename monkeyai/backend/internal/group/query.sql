-- name: ListGroups :many
SELECT
    g.id,
    g.parent_id,
    g.name,
    ARRAY (
        SELECT
            gu.user_id::text
        FROM
            group_users gu
            JOIN users u ON u.id = gu.user_id
        WHERE
            gu.group_id = g.id
            AND gu.removed_at IS NULL
            AND u.deleted_at IS NULL
        ORDER BY
            gu.user_id)::text[] AS member_ids
    FROM
        GROUPS g
    WHERE
        g.deleted_at IS NULL
    ORDER BY
        g.created_at,
        g.id;

-- name: GetGroup :one
SELECT
    g.id,
    g.parent_id,
    g.name,
    ARRAY (
        SELECT
            gu.user_id::text
        FROM
            group_users gu
            JOIN users u ON u.id = gu.user_id
        WHERE
            gu.group_id = g.id
            AND gu.removed_at IS NULL
            AND u.deleted_at IS NULL
        ORDER BY
            gu.user_id)::text[] AS member_ids
    FROM
        GROUPS g
    WHERE
        g.deleted_at IS NULL
        AND g.id = $1;

-- name: LockGroups :execresult
SELECT
    pg_advisory_xact_lock(741209);

-- name: WouldCreateCycle :one
WITH RECURSIVE ancestors (
    id,
    parent_id
) AS (
    SELECT
        g.id,
        g.parent_id
    FROM
        GROUPS g
    WHERE
        g.id = sqlc.arg(id)
        AND g.deleted_at IS NULL
    UNION
    SELECT
        g.id,
        g.parent_id
    FROM
        GROUPS g
        JOIN ancestors a ON g.id = a.parent_id
    WHERE
        g.deleted_at IS NULL
)
SELECT
    EXISTS (
        SELECT
            1
        FROM
            ancestors
        WHERE
            id = NULLIF (sqlc.arg(group_id)::text, '')::uuid);

-- name: NameExists :one
SELECT
    EXISTS (
        SELECT
            1
        FROM
            GROUPS
        WHERE
            deleted_at IS NULL
            AND parent_id IS NOT DISTINCT FROM sqlc.narg(parent_id)::uuid
            AND lower(name) = lower(sqlc.arg(name))
            AND id IS DISTINCT FROM NULLIF (sqlc.arg(group_id)::text, '')::uuid);

-- name: CreateGroup :one
INSERT INTO GROUPS (parent_id, name, created_by_user_id)
    VALUES ($1, $2, $3)
RETURNING
    id;

-- name: UpdateGroup :execresult
UPDATE
    GROUPS
SET
    parent_id = $2,
    name = $3,
    updated_at = now()
WHERE
    id = $1;

-- name: LockMembers :many
SELECT
    id
FROM
    users
WHERE
    id = ANY ($1::uuid[])
    AND deleted_at IS NULL FOR SHARE;

-- name: RemoveMembers :execresult
UPDATE
    group_users
SET
    removed_at = now()
WHERE
    group_id = sqlc.arg(group_id)
    AND removed_at IS NULL
    AND NOT (user_id = ANY (sqlc.arg(user_ids)::uuid[]));

-- name: AddMembers :execresult
INSERT INTO group_users (group_id, user_id, assigned_by_user_id)
SELECT
    sqlc.arg(group_id),
    unnest(sqlc.arg(user_ids)::uuid[]),
    sqlc.arg(assigned_by_user_id)
ON CONFLICT (group_id,
    user_id)
WHERE
    removed_at IS NULL
        DO NOTHING;

-- name: TouchGroup :execresult
UPDATE
    GROUPS
SET
    updated_at = now()
WHERE
    id = $1;

-- name: HasChildren :one
SELECT
    EXISTS (
        SELECT
            1
        FROM
            GROUPS
        WHERE
            parent_id = $1
            AND deleted_at IS NULL);

-- name: HasBillingUsers :one
SELECT
    EXISTS (
        SELECT
            1
        FROM
            users
        WHERE
            billing_group_id = $1
            AND deleted_at IS NULL);

-- name: DeleteGroup :execresult
UPDATE
    GROUPS
SET
    deleted_at = now(),
    updated_at = now()
WHERE
    id = $1;

-- name: RemoveAllMembers :execresult
UPDATE
    group_users
SET
    removed_at = now()
WHERE
    group_id = $1
    AND removed_at IS NULL;

-- name: DeleteGrants :execresult
DELETE FROM resource_access_grants
WHERE group_id = $1;
