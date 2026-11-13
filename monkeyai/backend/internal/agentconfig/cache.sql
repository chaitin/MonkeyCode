-- MVCC 行版本同时覆盖资源、标签、成员及授权变更，不读取大字段。
-- 版本校验与目录读取使用同一只读 Repeatable Read 快照。
-- 公开目录增加依赖表时须同步更新指纹；时间相关认证状态另受 valid_until 限制。

-- name: CatalogRulesVersion :one
SELECT md5(concat_ws(':',
    (SELECT md5(COALESCE(string_agg((t.id)::text || ':' || t.xmin::text, ',' ORDER BY t.id), ''))
        FROM users t ),
    (SELECT md5(COALESCE(string_agg((t.id)::text || ':' || t.xmin::text, ',' ORDER BY t.id), ''))
        FROM groups t ),
    (SELECT md5(COALESCE(string_agg((t.id)::text || ':' || t.xmin::text, ',' ORDER BY t.id), ''))
        FROM group_users t ),
    (SELECT md5(COALESCE(string_agg((t.id)::text || ':' || t.xmin::text, ',' ORDER BY t.id), ''))
        FROM resource_access_grants t ),
    (SELECT md5(COALESCE(string_agg((t.id)::text || ':' || t.xmin::text, ',' ORDER BY t.id), ''))
        FROM settings t WHERE t.key IN ('branding', 'billing')),
    (SELECT md5(COALESCE(string_agg((t.id)::text || ':' || t.xmin::text, ',' ORDER BY t.id), ''))
        FROM user_identities t ),
    (SELECT md5(COALESCE(string_agg((t.id)::text || ':' || t.xmin::text, ',' ORDER BY t.id), ''))
        FROM rules t )
))::text AS state,
    0::double precision AS valid_until;

-- name: CatalogSkillsVersion :one
SELECT md5(concat_ws(':',
    (SELECT md5(COALESCE(string_agg((t.id)::text || ':' || t.xmin::text, ',' ORDER BY t.id), ''))
        FROM experts t ),
    (SELECT md5(COALESCE(string_agg((t.expert_id::text || ':' || t.skill_id::text)::text || ':' || t.xmin::text, ',' ORDER BY t.expert_id::text || ':' || t.skill_id::text), ''))
        FROM expert_skills t ),
    (SELECT md5(COALESCE(string_agg((t.id)::text || ':' || t.xmin::text, ',' ORDER BY t.id), ''))
        FROM users t ),
    (SELECT md5(COALESCE(string_agg((t.id)::text || ':' || t.xmin::text, ',' ORDER BY t.id), ''))
        FROM groups t ),
    (SELECT md5(COALESCE(string_agg((t.id)::text || ':' || t.xmin::text, ',' ORDER BY t.id), ''))
        FROM group_users t ),
    (SELECT md5(COALESCE(string_agg((t.id)::text || ':' || t.xmin::text, ',' ORDER BY t.id), ''))
        FROM resource_access_grants t ),
    (SELECT md5(COALESCE(string_agg((t.id)::text || ':' || t.xmin::text, ',' ORDER BY t.id), ''))
        FROM settings t WHERE t.key IN ('branding', 'billing')),
    (SELECT md5(COALESCE(string_agg((t.id)::text || ':' || t.xmin::text, ',' ORDER BY t.id), ''))
        FROM user_identities t ),
    (SELECT md5(COALESCE(string_agg((t.id)::text || ':' || t.xmin::text, ',' ORDER BY t.id), ''))
        FROM skills t ),
    (SELECT md5(COALESCE(string_agg((t.id)::text || ':' || t.xmin::text, ',' ORDER BY t.id), ''))
        FROM tags t ),
    (SELECT md5(COALESCE(string_agg((t.id)::text || ':' || t.xmin::text, ',' ORDER BY t.id), ''))
        FROM resource_tags t )
))::text AS state,
    0::double precision AS valid_until;

-- name: CatalogConnectorsVersion :one
SELECT md5(concat_ws(':',
    (SELECT md5(COALESCE(string_agg((t.id)::text || ':' || t.xmin::text, ',' ORDER BY t.id), ''))
        FROM experts t ),
    (SELECT md5(COALESCE(string_agg((t.expert_id::text || ':' || t.connector_id::text)::text || ':' || t.xmin::text, ',' ORDER BY t.expert_id::text || ':' || t.connector_id::text), ''))
        FROM expert_connectors t ),
    (SELECT md5(COALESCE(string_agg((t.id)::text || ':' || t.xmin::text, ',' ORDER BY t.id), ''))
        FROM users t ),
    (SELECT md5(COALESCE(string_agg((t.id)::text || ':' || t.xmin::text, ',' ORDER BY t.id), ''))
        FROM groups t ),
    (SELECT md5(COALESCE(string_agg((t.id)::text || ':' || t.xmin::text, ',' ORDER BY t.id), ''))
        FROM group_users t ),
    (SELECT md5(COALESCE(string_agg((t.id)::text || ':' || t.xmin::text, ',' ORDER BY t.id), ''))
        FROM resource_access_grants t ),
    (SELECT md5(COALESCE(string_agg((t.id)::text || ':' || t.xmin::text, ',' ORDER BY t.id), ''))
        FROM settings t WHERE t.key IN ('branding', 'billing')),
    (SELECT md5(COALESCE(string_agg((t.id)::text || ':' || t.xmin::text, ',' ORDER BY t.id), ''))
        FROM user_identities t ),
    (SELECT md5(COALESCE(string_agg((t.id)::text || ':' || t.xmin::text, ',' ORDER BY t.id), ''))
        FROM connectors t ),
    (SELECT md5(COALESCE(string_agg((t.id)::text || ':' || t.xmin::text, ',' ORDER BY t.id), ''))
        FROM tags t ),
    (SELECT md5(COALESCE(string_agg((t.id)::text || ':' || t.xmin::text, ',' ORDER BY t.id), ''))
        FROM resource_tags t ),
    (SELECT md5(COALESCE(string_agg((t.id)::text || ':' || t.xmin::text, ',' ORDER BY t.id), ''))
        FROM connector_credentials t ),
    (SELECT md5(COALESCE(string_agg((t.id)::text || ':' || t.xmin::text, ',' ORDER BY t.id), ''))
        FROM mcp_tools t )
))::text AS state,
    COALESCE((SELECT EXTRACT(EPOCH FROM min(t.oauth_expires_at))::double precision
        FROM connector_credentials t
        WHERE t.revoked_at IS NULL AND t.oauth_refresh_token = '' AND t.oauth_access_token <> ''
            AND EXTRACT(EPOCH FROM t.oauth_expires_at) > sqlc.arg(valid_after)::double precision), 0)::double precision AS valid_until;

-- name: CatalogExpertsVersion :one
SELECT md5(concat_ws(':',
    (SELECT md5(COALESCE(string_agg((t.id)::text || ':' || t.xmin::text, ',' ORDER BY t.id), ''))
        FROM users t ),
    (SELECT md5(COALESCE(string_agg((t.id)::text || ':' || t.xmin::text, ',' ORDER BY t.id), ''))
        FROM groups t ),
    (SELECT md5(COALESCE(string_agg((t.id)::text || ':' || t.xmin::text, ',' ORDER BY t.id), ''))
        FROM group_users t ),
    (SELECT md5(COALESCE(string_agg((t.id)::text || ':' || t.xmin::text, ',' ORDER BY t.id), ''))
        FROM resource_access_grants t ),
    (SELECT md5(COALESCE(string_agg((t.id)::text || ':' || t.xmin::text, ',' ORDER BY t.id), ''))
        FROM settings t WHERE t.key IN ('branding', 'billing')),
    (SELECT md5(COALESCE(string_agg((t.id)::text || ':' || t.xmin::text, ',' ORDER BY t.id), ''))
        FROM user_identities t ),
    (SELECT md5(COALESCE(string_agg((t.id)::text || ':' || t.xmin::text, ',' ORDER BY t.id), ''))
        FROM rules t ),
    (SELECT md5(COALESCE(string_agg((t.id)::text || ':' || t.xmin::text, ',' ORDER BY t.id), ''))
        FROM skills t ),
    (SELECT md5(COALESCE(string_agg((t.id)::text || ':' || t.xmin::text, ',' ORDER BY t.id), ''))
        FROM experts t ),
    (SELECT md5(COALESCE(string_agg((t.id)::text || ':' || t.xmin::text, ',' ORDER BY t.id), ''))
        FROM connectors t ),
    (SELECT md5(COALESCE(string_agg((t.id)::text || ':' || t.xmin::text, ',' ORDER BY t.id), ''))
        FROM tags t ),
    (SELECT md5(COALESCE(string_agg((t.id)::text || ':' || t.xmin::text, ',' ORDER BY t.id), ''))
        FROM resource_tags t ),
    (SELECT md5(COALESCE(string_agg((t.expert_id::text || ':' || t.rule_id::text)::text || ':' || t.xmin::text, ',' ORDER BY t.expert_id::text || ':' || t.rule_id::text), ''))
        FROM expert_rules t ),
    (SELECT md5(COALESCE(string_agg((t.expert_id::text || ':' || t.skill_id::text)::text || ':' || t.xmin::text, ',' ORDER BY t.expert_id::text || ':' || t.skill_id::text), ''))
        FROM expert_skills t ),
    (SELECT md5(COALESCE(string_agg((t.expert_id::text || ':' || t.connector_id::text)::text || ':' || t.xmin::text, ',' ORDER BY t.expert_id::text || ':' || t.connector_id::text), ''))
        FROM expert_connectors t ),
    (SELECT md5(COALESCE(string_agg((t.id)::text || ':' || t.xmin::text, ',' ORDER BY t.id), ''))
        FROM connector_credentials t ),
    (SELECT md5(COALESCE(string_agg((t.id)::text || ':' || t.xmin::text, ',' ORDER BY t.id), ''))
        FROM mcp_tools t )
))::text AS state,
    COALESCE((SELECT EXTRACT(EPOCH FROM min(t.oauth_expires_at))::double precision
        FROM connector_credentials t
        WHERE t.revoked_at IS NULL AND t.oauth_refresh_token = '' AND t.oauth_access_token <> ''
            AND EXTRACT(EPOCH FROM t.oauth_expires_at) > sqlc.arg(valid_after)::double precision), 0)::double precision AS valid_until;
