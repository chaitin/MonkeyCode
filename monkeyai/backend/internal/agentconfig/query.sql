-- name: ListGrants :many
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
    jsonb_build_object('kind', resource_type, 'id', resource_id, 'required',
	bool_or(usage_requirement = 'required'))
FROM
    resource_access_grants rag
WHERE
    (rag.all_users AND EXISTS (
        SELECT 1 FROM users u WHERE u.id = sqlc.narg(user_id) AND u.status = 'active' AND u.deleted_at IS NULL
    ))
    OR rag.user_id = sqlc.narg(user_id)
    OR rag.group_id IN (
        SELECT
            group_id
        FROM
            user_groups)
GROUP BY
    resource_type,
    resource_id;

-- name: ListModels :many
SELECT
    jsonb_build_object('id', id, 'ownership_type', ownership_type, 'owner_user_id', owner_user_id, 'enabled', enabled)
FROM
    models
WHERE
    deleted_at IS NULL;

-- name: IsAdmin :one
SELECT
    ROLE = 'admin'
FROM
    users
WHERE
    id = $1
    AND status = 'active'
    AND deleted_at IS NULL;

-- name: CredentialCurrent :one
SELECT
    oauth_expires_at IS NULL
    OR oauth_expires_at > now()
FROM
    connector_credentials
WHERE
    id = $1;

-- name: ListSkillTags :many
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

-- name: CatalogRules :many
SELECT
    to_jsonb (t)
FROM
    rules t
WHERE
    deleted_at IS NULL;

-- name: CatalogSkills :many
SELECT
    to_jsonb (t)
FROM
    skills t
WHERE
    deleted_at IS NULL;

-- name: CatalogExperts :many
SELECT
    to_jsonb (t)
FROM
    experts t
WHERE
    deleted_at IS NULL;

-- name: CatalogConnectors :many
SELECT
    to_jsonb (t)
FROM
    connectors t
WHERE
    deleted_at IS NULL;

-- name: CatalogProviders :many
SELECT
    to_jsonb (t)
FROM
    connector_providers t
WHERE
    deleted_at IS NULL;

-- name: CatalogRuleLinks :many
SELECT
    to_jsonb (t)
FROM
    expert_rules t
ORDER BY
    expert_id;

-- name: CatalogSkillLinks :many
SELECT
    to_jsonb (t)
FROM
    expert_skills t
ORDER BY
    expert_id;

-- name: CatalogProviderLinks :many
SELECT
    to_jsonb (t)
FROM
    expert_connector_providers t
ORDER BY
    expert_id;
