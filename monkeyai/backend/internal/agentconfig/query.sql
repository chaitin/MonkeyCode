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
-- name: CatalogTags :many
SELECT rt.resource_id::text AS resource_id, t.id::text AS id, t.name
FROM resource_tags rt JOIN tags t ON t.id = rt.tag_id
WHERE rt.resource_type = sqlc.arg(resource_type)::text
    AND rt.resource_id::text = ANY(sqlc.arg(resource_ids)::text[])
    AND t.deleted_at IS NULL
ORDER BY lower(t.name), t.id;

-- name: CatalogRules :many
SELECT jsonb_build_object(
    'id', t.id,
    'ownership_type', t.ownership_type,
    'owner_user_id', t.owner_user_id,
    'enabled', t.enabled,
    'revision', t.revision,
    'name', t.name,
    'description', t.description,
    'name_i18n', t.name_i18n,
    'description_i18n', t.description_i18n,
    'content', t.content
)
FROM rules t
WHERE t.deleted_at IS NULL
    AND (sqlc.arg(all_resources)::boolean
        OR t.id::text = ANY(sqlc.arg(resource_ids)::text[]));

-- name: CatalogSkills :many
SELECT jsonb_build_object(
    'id', t.id,
    'ownership_type', t.ownership_type,
    'owner_user_id', t.owner_user_id,
    'enabled', t.enabled,
    'revision', t.revision,
    'name', t.name,
    'description', t.description,
    'name_i18n', t.name_i18n,
    'description_i18n', t.description_i18n,
    'package_file_name', t.package_file_name,
    'package_s3_key', t.package_s3_key,
    'package_size_bytes', t.package_size_bytes,
    'package_sha256', t.package_sha256,
    'file_count', t.file_count
)
FROM skills t
WHERE t.deleted_at IS NULL
    AND (sqlc.arg(all_resources)::boolean
        OR t.id::text = ANY(sqlc.arg(resource_ids)::text[]));

-- name: CatalogExperts :many
SELECT jsonb_build_object(
    'id', t.id,
    'ownership_type', t.ownership_type,
    'owner_user_id', t.owner_user_id,
    'enabled', t.enabled,
    'revision', t.revision,
    'name', t.name,
    'description', t.description,
    'name_i18n', t.name_i18n,
    'description_i18n', t.description_i18n,
    'prompt', t.prompt,
    'avatar_s3_key', t.avatar_s3_key
)
FROM experts t
WHERE t.deleted_at IS NULL
    AND (sqlc.arg(all_resources)::boolean
        OR t.id::text = ANY(sqlc.arg(resource_ids)::text[]));

-- name: CatalogConnectors :many
SELECT jsonb_build_object(
    'id', t.id,
    'ownership_type', t.ownership_type,
    'owner_user_id', t.owner_user_id,
    'enabled', t.enabled,
    'revision', t.revision,
    'name', t.name,
    'description', t.description,
    'name_i18n', t.name_i18n,
    'description_i18n', t.description_i18n,
    'authorization_mode', t.authorization_mode,
    'authorization_method', t.authorization_method,
    'auth_header_name', t.auth_header_name,
    'config_revision', t.config_revision,
    'connection_status', t.connection_status,
    'icon_s3_key', t.icon_s3_key
)
FROM connectors t
WHERE t.deleted_at IS NULL
    AND (sqlc.arg(all_resources)::boolean
        OR t.id::text = ANY(sqlc.arg(resource_ids)::text[]));
-- name: CatalogRuleLinks :many
SELECT to_jsonb(t)
FROM expert_rules t
WHERE sqlc.arg(all_resources)::boolean
    OR expert_id::text = ANY(sqlc.arg(expert_ids)::text[])
ORDER BY expert_id;

-- name: CatalogSkillLinks :many
SELECT to_jsonb(t)
FROM expert_skills t
WHERE sqlc.arg(all_resources)::boolean
    OR expert_id::text = ANY(sqlc.arg(expert_ids)::text[])
ORDER BY expert_id;

-- name: CatalogConnectorLinks :many
SELECT to_jsonb(t)
FROM expert_connectors t
WHERE sqlc.arg(all_resources)::boolean
    OR expert_id::text = ANY(sqlc.arg(expert_ids)::text[])
ORDER BY expert_id;

-- name: CatalogRulesPage :one
WITH candidates AS (
    SELECT id, ownership_type, owner_user_id, name, description, name_i18n, description_i18n, enabled
    FROM rules
    WHERE sqlc.arg(resource_type)::text = 'rule' AND deleted_at IS NULL
), matching AS (
    SELECT c.id
    FROM candidates c
    WHERE c.enabled
        AND (c.ownership_type <> 'system' OR sqlc.arg(system_access)::boolean)
        AND ((c.ownership_type = 'user' AND c.owner_user_id::text = sqlc.arg(user_id)::text)
            OR c.id::text = ANY(sqlc.arg(granted_ids)::text[]))
        AND (sqlc.arg(owner_filter)::text IN ('', 'all')
            OR (sqlc.arg(owner_filter)::text = 'team' AND c.ownership_type = 'system')
            OR (sqlc.arg(owner_filter)::text = 'mine' AND c.ownership_type = 'user' AND c.owner_user_id::text = sqlc.arg(user_id)::text)
            OR (sqlc.arg(owner_filter)::text = 'shared' AND c.ownership_type = 'user' AND c.owner_user_id::text <> sqlc.arg(user_id)::text))
        AND (sqlc.arg(search_query)::text = ''
            OR strpos(lower(c.name || ' ' || COALESCE((
                SELECT string_agg(value #>> '{}', ' ' ORDER BY key COLLATE "C")
                FROM jsonb_each(c.name_i18n) WHERE jsonb_typeof(value) = 'string'
            ), '')), sqlc.arg(search_query)::text) > 0
            OR strpos(lower(c.description || ' ' || COALESCE((
                SELECT string_agg(value #>> '{}', ' ' ORDER BY key COLLATE "C")
                FROM jsonb_each(c.description_i18n) WHERE jsonb_typeof(value) = 'string'
            ), '')), sqlc.arg(search_query)::text) > 0)
        AND COALESCE(cardinality(sqlc.arg(tag_ids)::text[]), 0) = 0
)
SELECT ARRAY(SELECT id::text FROM matching ORDER BY id
    LIMIT sqlc.arg(page_size)::integer OFFSET sqlc.arg(page_offset)::integer)::text[] AS resource_ids,
    (SELECT count(*) FROM matching)::bigint AS total_count;


-- name: CatalogSkillsPage :one
WITH candidates AS (
    SELECT id, ownership_type, owner_user_id, name, description, name_i18n, description_i18n, enabled
    FROM skills
    WHERE sqlc.arg(resource_type)::text = 'skill' AND deleted_at IS NULL
), matching AS (
    SELECT c.id
    FROM candidates c
    WHERE c.enabled
        AND (c.ownership_type <> 'system' OR sqlc.arg(system_access)::boolean)
        AND ((c.ownership_type = 'user' AND c.owner_user_id::text = sqlc.arg(user_id)::text)
            OR c.id::text = ANY(sqlc.arg(granted_ids)::text[]))
        AND (sqlc.arg(owner_filter)::text IN ('', 'all')
            OR (sqlc.arg(owner_filter)::text = 'team' AND c.ownership_type = 'system')
            OR (sqlc.arg(owner_filter)::text = 'mine' AND c.ownership_type = 'user' AND c.owner_user_id::text = sqlc.arg(user_id)::text)
            OR (sqlc.arg(owner_filter)::text = 'shared' AND c.ownership_type = 'user' AND c.owner_user_id::text <> sqlc.arg(user_id)::text))
        AND (sqlc.arg(search_query)::text = ''
            OR strpos(lower(c.name || ' ' || COALESCE((
                SELECT string_agg(value #>> '{}', ' ' ORDER BY key COLLATE "C")
                FROM jsonb_each(c.name_i18n) WHERE jsonb_typeof(value) = 'string'
            ), '')), sqlc.arg(search_query)::text) > 0
            OR strpos(lower(c.description || ' ' || COALESCE((
                SELECT string_agg(value #>> '{}', ' ' ORDER BY key COLLATE "C")
                FROM jsonb_each(c.description_i18n) WHERE jsonb_typeof(value) = 'string'
            ), '')), sqlc.arg(search_query)::text) > 0)
        AND (COALESCE(cardinality(sqlc.arg(tag_ids)::text[]), 0) = 0
            OR (sqlc.arg(resource_type)::text <> 'rule' AND EXISTS (
                SELECT 1 FROM resource_tags rt JOIN tags t ON t.id = rt.tag_id
                WHERE rt.resource_type = sqlc.arg(resource_type)::text
                    AND rt.resource_id = c.id AND t.deleted_at IS NULL
                    AND t.id::text = ANY(sqlc.arg(tag_ids)::text[])
            )))
)
SELECT ARRAY(SELECT id::text FROM matching ORDER BY id
    LIMIT sqlc.arg(page_size)::integer OFFSET sqlc.arg(page_offset)::integer)::text[] AS resource_ids,
    (SELECT count(*) FROM matching)::bigint AS total_count;


-- name: CatalogExpertsPage :one
WITH candidates AS (
    SELECT id, ownership_type, owner_user_id, name, description, name_i18n, description_i18n, enabled
    FROM experts
    WHERE sqlc.arg(resource_type)::text = 'expert' AND deleted_at IS NULL
), matching AS (
    SELECT c.id
    FROM candidates c
    WHERE c.enabled
        AND (c.ownership_type <> 'system' OR sqlc.arg(system_access)::boolean)
        AND ((c.ownership_type = 'user' AND c.owner_user_id::text = sqlc.arg(user_id)::text)
            OR c.id::text = ANY(sqlc.arg(granted_ids)::text[]))
        AND (sqlc.arg(owner_filter)::text IN ('', 'all')
            OR (sqlc.arg(owner_filter)::text = 'team' AND c.ownership_type = 'system')
            OR (sqlc.arg(owner_filter)::text = 'mine' AND c.ownership_type = 'user' AND c.owner_user_id::text = sqlc.arg(user_id)::text)
            OR (sqlc.arg(owner_filter)::text = 'shared' AND c.ownership_type = 'user' AND c.owner_user_id::text <> sqlc.arg(user_id)::text))
        AND (sqlc.arg(search_query)::text = ''
            OR strpos(lower(c.name || ' ' || COALESCE((
                SELECT string_agg(value #>> '{}', ' ' ORDER BY key COLLATE "C")
                FROM jsonb_each(c.name_i18n) WHERE jsonb_typeof(value) = 'string'
            ), '')), sqlc.arg(search_query)::text) > 0
            OR strpos(lower(c.description || ' ' || COALESCE((
                SELECT string_agg(value #>> '{}', ' ' ORDER BY key COLLATE "C")
                FROM jsonb_each(c.description_i18n) WHERE jsonb_typeof(value) = 'string'
            ), '')), sqlc.arg(search_query)::text) > 0)
        AND (COALESCE(cardinality(sqlc.arg(tag_ids)::text[]), 0) = 0
            OR (sqlc.arg(resource_type)::text <> 'rule' AND EXISTS (
                SELECT 1 FROM resource_tags rt JOIN tags t ON t.id = rt.tag_id
                WHERE rt.resource_type = sqlc.arg(resource_type)::text
                    AND rt.resource_id = c.id AND t.deleted_at IS NULL
                    AND t.id::text = ANY(sqlc.arg(tag_ids)::text[])
            )))
)
SELECT ARRAY(SELECT id::text FROM matching ORDER BY id
    LIMIT sqlc.arg(page_size)::integer OFFSET sqlc.arg(page_offset)::integer)::text[] AS resource_ids,
    (SELECT count(*) FROM matching)::bigint AS total_count;


-- name: CatalogConnectorsPage :one
WITH candidates AS (
    SELECT id, ownership_type, owner_user_id, name, description, name_i18n, description_i18n, enabled
    FROM connectors
    WHERE sqlc.arg(resource_type)::text = 'connector' AND deleted_at IS NULL
), matching AS (
    SELECT c.id
    FROM candidates c
    WHERE c.enabled
        AND (c.ownership_type <> 'system' OR sqlc.arg(system_access)::boolean)
        AND ((c.ownership_type = 'user' AND c.owner_user_id::text = sqlc.arg(user_id)::text)
            OR c.id::text = ANY(sqlc.arg(granted_ids)::text[]))
        AND (sqlc.arg(owner_filter)::text IN ('', 'all')
            OR (sqlc.arg(owner_filter)::text = 'team' AND c.ownership_type = 'system')
            OR (sqlc.arg(owner_filter)::text = 'mine' AND c.ownership_type = 'user' AND c.owner_user_id::text = sqlc.arg(user_id)::text)
            OR (sqlc.arg(owner_filter)::text = 'shared' AND c.ownership_type = 'user' AND c.owner_user_id::text <> sqlc.arg(user_id)::text))
        AND (sqlc.arg(search_query)::text = ''
            OR strpos(lower(c.name || ' ' || COALESCE((
                SELECT string_agg(value #>> '{}', ' ' ORDER BY key COLLATE "C")
                FROM jsonb_each(c.name_i18n) WHERE jsonb_typeof(value) = 'string'
            ), '')), sqlc.arg(search_query)::text) > 0
            OR strpos(lower(c.description || ' ' || COALESCE((
                SELECT string_agg(value #>> '{}', ' ' ORDER BY key COLLATE "C")
                FROM jsonb_each(c.description_i18n) WHERE jsonb_typeof(value) = 'string'
            ), '')), sqlc.arg(search_query)::text) > 0)
        AND (COALESCE(cardinality(sqlc.arg(tag_ids)::text[]), 0) = 0
            OR (sqlc.arg(resource_type)::text <> 'rule' AND EXISTS (
                SELECT 1 FROM resource_tags rt JOIN tags t ON t.id = rt.tag_id
                WHERE rt.resource_type = sqlc.arg(resource_type)::text
                    AND rt.resource_id = c.id AND t.deleted_at IS NULL
                    AND t.id::text = ANY(sqlc.arg(tag_ids)::text[])
            )))
)
SELECT ARRAY(SELECT id::text FROM matching ORDER BY id
    LIMIT sqlc.arg(page_size)::integer OFFSET sqlc.arg(page_offset)::integer)::text[] AS resource_ids,
    (SELECT count(*) FROM matching)::bigint AS total_count;
