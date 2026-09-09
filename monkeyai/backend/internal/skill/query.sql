-- name: ListReferences :many
SELECT
    jsonb_build_object('id', e.id, 'name', e.name)
FROM
    experts e
    JOIN expert_skills x ON x.expert_id = e.id
WHERE
    x.skill_id = $1
    AND e.deleted_at IS NULL;

-- name: ListTags :many
SELECT
    jsonb_build_object('id', t.id, 'name', t.name)
FROM
    tags t
    JOIN resource_tags rt ON rt.tag_id = t.id
WHERE
    rt.resource_type = 'skill'
    AND rt.resource_id = $1
    AND t.deleted_at IS NULL
ORDER BY
    t.id;

-- name: DeleteTags :execresult
DELETE FROM resource_tags
WHERE resource_type = 'skill'
    AND resource_id = $1;

-- name: TagExists :one
SELECT
    EXISTS (
        SELECT
            1
        FROM
            tags
        WHERE
            id = $1
            AND deleted_at IS NULL);

-- name: CreateTagLink :execresult
INSERT INTO resource_tags (resource_type, resource_id, tag_id, assigned_by_user_id)
    VALUES ('skill', $1, $2, $3);

-- name: GetSkill :one
SELECT
    to_jsonb (t)
FROM
    skills t
WHERE
    id = $1
    AND deleted_at IS NULL;

-- name: GetResource :one
SELECT
    to_jsonb (t)
FROM
    skills t
WHERE
    id = $1
    AND deleted_at IS NULL;

-- name: LockResource :one
SELECT
    to_jsonb (t)
FROM
    skills t
WHERE
    id = $1
    AND deleted_at IS NULL
FOR UPDATE;

-- name: ListResources :many
SELECT
    to_jsonb (t)
FROM
    skills t
WHERE
    deleted_at IS NULL
ORDER BY
    lower(name),
    id;

-- name: PageResources :many
SELECT
    to_jsonb (t)
FROM
    skills t
WHERE
    deleted_at IS NULL
    AND (sqlc.arg(filter)::jsonb ->> 'ownership' = ''
        OR t.ownership_type = sqlc.arg(filter)::jsonb ->> 'ownership')
    AND name ILIKE '%' || (sqlc.arg(filter)::jsonb ->> 'search') || '%'
    AND id::text > sqlc.arg(filter)::jsonb ->> 'cursor'
ORDER BY
    id
LIMIT (sqlc.arg(filter)::jsonb ->> 'limit')::integer;

-- name: CreateResource :exec
INSERT INTO skills (name, description, package_file_name, package_s3_key, package_size_bytes, package_sha256,
    file_count, enabled, id, owner_user_id, ownership_type)
    VALUES (
        CASE WHEN sqlc.arg(DATA)::jsonb ? 'name' THEN
            (sqlc.arg(DATA)::jsonb ->> 'name')::text
        ELSE
            NULL
        END, CASE WHEN sqlc.arg(DATA)::jsonb ? 'description' THEN
            (sqlc.arg(DATA)::jsonb ->> 'description')::text
        ELSE
            NULL
        END, CASE WHEN sqlc.arg(DATA)::jsonb ? 'package_file_name' THEN
            (sqlc.arg(DATA)::jsonb ->> 'package_file_name')::text
        ELSE
            NULL
        END, CASE WHEN sqlc.arg(DATA)::jsonb ? 'package_s3_key' THEN
            (sqlc.arg(DATA)::jsonb ->> 'package_s3_key')::text
        ELSE
            NULL
        END, CASE WHEN sqlc.arg(DATA)::jsonb ? 'package_size_bytes' THEN
            (sqlc.arg(DATA)::jsonb ->> 'package_size_bytes')::bigint
        ELSE
            NULL
        END, CASE WHEN sqlc.arg(DATA)::jsonb ? 'package_sha256' THEN
            (sqlc.arg(DATA)::jsonb ->> 'package_sha256')::text
        ELSE
            NULL
        END, CASE WHEN sqlc.arg(DATA)::jsonb ? 'file_count' THEN
            (sqlc.arg(DATA)::jsonb ->> 'file_count')::integer
        ELSE
            0
        END, CASE WHEN sqlc.arg(DATA)::jsonb ? 'enabled' THEN
            (sqlc.arg(DATA)::jsonb ->> 'enabled')::boolean
        ELSE
            TRUE
	END, (sqlc.arg(DATA)::jsonb ->> 'id')::uuid, (sqlc.arg(DATA)::jsonb ->>
	    'actor_id')::uuid, COALESCE(sqlc.arg(DATA)::jsonb ->> 'ownership_type', 'system'));

-- name: UpdateResource :exec
UPDATE
    skills
SET
    name = CASE WHEN sqlc.arg(DATA)::jsonb ? 'name' THEN
        (sqlc.arg(DATA)::jsonb ->> 'name')::text
    ELSE
        name
    END,
    description = CASE WHEN sqlc.arg(DATA)::jsonb ? 'description' THEN
        (sqlc.arg(DATA)::jsonb ->> 'description')::text
    ELSE
        description
    END,
    package_file_name = CASE WHEN sqlc.arg(DATA)::jsonb ? 'package_file_name' THEN
        (sqlc.arg(DATA)::jsonb ->> 'package_file_name')::text
    ELSE
        package_file_name
    END,
    package_s3_key = CASE WHEN sqlc.arg(DATA)::jsonb ? 'package_s3_key' THEN
        (sqlc.arg(DATA)::jsonb ->> 'package_s3_key')::text
    ELSE
        package_s3_key
    END,
    package_size_bytes = CASE WHEN sqlc.arg(DATA)::jsonb ? 'package_size_bytes' THEN
        (sqlc.arg(DATA)::jsonb ->> 'package_size_bytes')::bigint
    ELSE
        package_size_bytes
    END,
    package_sha256 = CASE WHEN sqlc.arg(DATA)::jsonb ? 'package_sha256' THEN
        (sqlc.arg(DATA)::jsonb ->> 'package_sha256')::text
    ELSE
        package_sha256
    END,
    file_count = CASE WHEN sqlc.arg(DATA)::jsonb ? 'file_count' THEN
        (sqlc.arg(DATA)::jsonb ->> 'file_count')::integer
    ELSE
        file_count
    END,
    enabled = CASE WHEN sqlc.arg(DATA)::jsonb ? 'enabled' THEN
        (sqlc.arg(DATA)::jsonb ->> 'enabled')::boolean
    ELSE
        enabled
    END,
    revision = revision + 1,
    updated_at = now()
WHERE
    id = (sqlc.arg(DATA)::jsonb ->> 'id')::uuid;

-- name: DeleteResource :exec
UPDATE
    skills
SET
    deleted_at = now(),
    updated_at = now(),
    revision = revision + 1
WHERE
    id = $1;

-- name: TouchResource :exec
UPDATE
    skills
SET
    updated_at = now(),
    revision = revision + 1
WHERE
    id = $1;

-- name: SetResourceEnabled :exec
UPDATE
    skills
SET
    enabled = (sqlc.arg(DATA)::jsonb ->> 'enabled')::boolean,
    updated_at = now(),
    revision = revision + 1
WHERE
    id = (sqlc.arg(DATA)::jsonb ->> 'id')::uuid;
