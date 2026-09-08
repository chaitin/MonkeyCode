-- name: ModelAvailable :one
SELECT
    EXISTS (
        SELECT
            1
        FROM
            models
        WHERE
            id = $1
            AND ownership_type = 'system'
            AND deleted_at IS NULL
            AND enabled);

-- name: LockProvider :one
SELECT
    to_jsonb (p)
FROM
    connector_providers p
WHERE
    id = $1
    AND ownership_type = 'system'
    AND deleted_at IS NULL FOR SHARE;

-- name: DeleteProviderLinks :execresult
DELETE FROM expert_connector_providers
WHERE expert_id = $1;

-- name: CreateProviderLink :execresult
INSERT INTO expert_connector_providers (expert_id, provider_id, required, tool_allowlist, tool_denylist)
    VALUES ($1, $2, $3, $4, $5);

-- name: ListProviderLinks :many
SELECT
    to_jsonb (x)
FROM
    expert_connector_providers x
WHERE
    expert_id = $1
ORDER BY
    provider_id;

-- name: GetResource :one
SELECT
    to_jsonb (t)
FROM
    experts t
WHERE
    id = $1
    AND deleted_at IS NULL;

-- name: LockResource :one
SELECT
    to_jsonb (t)
FROM
    experts t
WHERE
    id = $1
    AND deleted_at IS NULL
FOR UPDATE;

-- name: ListResources :many
SELECT
    to_jsonb (t)
FROM
    experts t
WHERE
    deleted_at IS NULL
ORDER BY
    lower(name),
    id;

-- name: PageResources :many
SELECT
    to_jsonb (t)
FROM
    experts t
WHERE
    deleted_at IS NULL
    AND (sqlc.arg(filter)::jsonb ->> 'ownership' = ''
        OR 'system' = sqlc.arg(filter)::jsonb ->> 'ownership')
    AND name ILIKE '%' || (sqlc.arg(filter)::jsonb ->> 'search') || '%'
    AND id::text > sqlc.arg(filter)::jsonb ->> 'cursor'
ORDER BY
    id
LIMIT (sqlc.arg(filter)::jsonb ->> 'limit')::integer;

-- name: CreateResource :exec
INSERT INTO experts (name, description, prompt, default_model_id, enabled, id, created_by_user_id)
    VALUES (
        CASE WHEN sqlc.arg(DATA)::jsonb ? 'name' THEN
            (sqlc.arg(DATA)::jsonb ->> 'name')::text
        ELSE
            NULL
        END, CASE WHEN sqlc.arg(DATA)::jsonb ? 'description' THEN
            (sqlc.arg(DATA)::jsonb ->> 'description')::text
        ELSE
            NULL
        END, CASE WHEN sqlc.arg(DATA)::jsonb ? 'prompt' THEN
            (sqlc.arg(DATA)::jsonb ->> 'prompt')::text
        ELSE
            NULL
        END, CASE WHEN sqlc.arg(DATA)::jsonb ? 'default_model_id' THEN
            (sqlc.arg(DATA)::jsonb ->> 'default_model_id')::uuid
        ELSE
            NULL
        END, CASE WHEN sqlc.arg(DATA)::jsonb ? 'enabled' THEN
            (sqlc.arg(DATA)::jsonb ->> 'enabled')::boolean
        ELSE
            TRUE
        END, (sqlc.arg(DATA)::jsonb ->> 'id')::uuid, (sqlc.arg(DATA)::jsonb ->> 'actor_id')::uuid);

-- name: UpdateResource :exec
UPDATE
    experts
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
    prompt = CASE WHEN sqlc.arg(DATA)::jsonb ? 'prompt' THEN
        (sqlc.arg(DATA)::jsonb ->> 'prompt')::text
    ELSE
        prompt
    END,
    default_model_id = CASE WHEN sqlc.arg(DATA)::jsonb ? 'default_model_id' THEN
        (sqlc.arg(DATA)::jsonb ->> 'default_model_id')::uuid
    ELSE
        default_model_id
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
    experts
SET
    deleted_at = now(),
    updated_at = now(),
    revision = revision + 1
WHERE
    id = $1;

-- name: TouchResource :exec
UPDATE
    experts
SET
    updated_at = now(),
    revision = revision + 1
WHERE
    id = $1;

-- name: SetResourceEnabled :exec
UPDATE
    experts
SET
    enabled = (sqlc.arg(DATA)::jsonb ->> 'enabled')::boolean,
    updated_at = now(),
    revision = revision + 1
WHERE
    id = (sqlc.arg(DATA)::jsonb ->> 'id')::uuid;

-- name: LockRule :one
SELECT
    id
FROM
    rules
WHERE
    id = $1
    AND ownership_type = 'system'
    AND deleted_at IS NULL FOR SHARE;

-- name: DeleteRuleLinks :exec
DELETE FROM expert_rules
WHERE expert_id = $1;

-- name: CreateRuleLink :exec
INSERT INTO expert_rules (expert_id, rule_id)
    VALUES ($1, $2);

-- name: ListRuleIDs :many
SELECT
    rule_id::text
FROM
    expert_rules
WHERE
    expert_id = $1
ORDER BY
    rule_id;

-- name: LockSkill :one
SELECT
    id
FROM
    skills
WHERE
    id = $1
    AND ownership_type = 'system'
    AND deleted_at IS NULL FOR SHARE;

-- name: DeleteSkillLinks :exec
DELETE FROM expert_skills
WHERE expert_id = $1;

-- name: CreateSkillLink :exec
INSERT INTO expert_skills (expert_id, skill_id)
    VALUES ($1, $2);

-- name: ListSkillIDs :many
SELECT
    skill_id::text
FROM
    expert_skills
WHERE
    expert_id = $1
ORDER BY
    skill_id;
