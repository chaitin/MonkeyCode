-- name: ListReferences :many
SELECT
    jsonb_build_object('id', e.id, 'name', e.name)
FROM
    experts e
    JOIN expert_rules x ON x.expert_id = e.id
WHERE
    x.rule_id = $1
    AND e.deleted_at IS NULL;

-- name: GetResource :one
SELECT
    to_jsonb (t)
FROM
    rules t
WHERE
    id = $1
    AND deleted_at IS NULL;

-- name: LockResource :one
SELECT
    to_jsonb (t)
FROM
    rules t
WHERE
    id = $1
    AND deleted_at IS NULL
FOR UPDATE;

-- name: ListResources :many
SELECT
    to_jsonb (t)
FROM
    rules t
WHERE
    deleted_at IS NULL
ORDER BY
    lower(name),
    id;

-- name: PageResources :many
SELECT
    to_jsonb (t)
FROM
    rules t
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
INSERT INTO rules (name, content, id, owner_user_id, ownership_type)
    VALUES (
        CASE WHEN sqlc.arg(DATA)::jsonb ? 'name' THEN
            (sqlc.arg(DATA)::jsonb ->> 'name')::text
        ELSE
            NULL
        END, CASE WHEN sqlc.arg(DATA)::jsonb ? 'content' THEN
            (sqlc.arg(DATA)::jsonb ->> 'content')::text
        ELSE
            NULL
	END, (sqlc.arg(DATA)::jsonb ->> 'id')::uuid, (sqlc.arg(DATA)::jsonb ->>
	    'actor_id')::uuid, COALESCE(sqlc.arg(DATA)::jsonb ->> 'ownership_type', 'system'));

-- name: UpdateResource :exec
UPDATE
    rules
SET
    name = CASE WHEN sqlc.arg(DATA)::jsonb ? 'name' THEN
        (sqlc.arg(DATA)::jsonb ->> 'name')::text
    ELSE
        name
    END,
    content = CASE WHEN sqlc.arg(DATA)::jsonb ? 'content' THEN
        (sqlc.arg(DATA)::jsonb ->> 'content')::text
    ELSE
        content
    END,
    revision = revision + 1,
    updated_at = now()
WHERE
    id = (sqlc.arg(DATA)::jsonb ->> 'id')::uuid;

-- name: DeleteResource :exec
UPDATE
    rules
SET
    deleted_at = now(),
    updated_at = now(),
    revision = revision + 1
WHERE
    id = $1;

-- name: TouchResource :exec
UPDATE
    rules
SET
    updated_at = now(),
    revision = revision + 1
WHERE
    id = $1;
