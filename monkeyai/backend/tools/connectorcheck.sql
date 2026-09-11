-- 在旧版本数据库执行；只读取候选，不修改结构和数据。
BEGIN READ ONLY;
SELECT link.expert_id, link.provider_id, candidate.candidates,
    CASE jsonb_array_length(candidate.candidates) WHEN 0 THEN 'missing_connector'
        WHEN 1 THEN 'ready' ELSE 'ambiguous_connector' END AS status
FROM (
    SELECT x.expert_id, x.provider_id, e.ownership_type, e.owner_user_id
    FROM expert_connector_providers x JOIN experts e ON e.id = x.expert_id
    WHERE e.deleted_at IS NULL
) link CROSS JOIN LATERAL (
WITH RECURSIVE user_groups AS (
    SELECT g.id, g.parent_id FROM groups g JOIN group_users gu ON gu.group_id = g.id
    WHERE gu.user_id = link.owner_user_id AND gu.removed_at IS NULL AND g.deleted_at IS NULL
    UNION
    SELECT p.id, p.parent_id FROM groups p JOIN user_groups child ON child.parent_id = p.id
    WHERE p.deleted_at IS NULL
)
SELECT COALESCE(jsonb_agg(c.id ORDER BY c.id), '[]'::jsonb) AS candidates
FROM connectors c
WHERE c.provider_id = link.provider_id AND c.deleted_at IS NULL AND c.enabled
    AND (link.ownership_type = 'system' AND c.ownership_type = 'system'
        OR link.ownership_type = 'user' AND EXISTS (
            SELECT 1 FROM users u WHERE u.id = link.owner_user_id AND u.status = 'active' AND u.deleted_at IS NULL
        ) AND (c.ownership_type = 'user' AND c.owner_user_id = link.owner_user_id
            OR EXISTS (SELECT 1 FROM resource_access_grants g
                WHERE g.resource_type = 'connector' AND g.resource_id = c.id
                    AND (g.all_users OR g.user_id = link.owner_user_id OR g.group_id IN (SELECT id FROM user_groups))))
        AND (c.ownership_type = 'user'
            OR NOT EXISTS (SELECT 1 FROM settings WHERE key = 'billing' AND value->>'charging_mode' = 'remote')
            OR EXISTS (SELECT 1 FROM user_identities i WHERE i.user_id = link.owner_user_id
                AND i.provider = 'baizhiyun' AND i.deleted_at IS NULL)))
) candidate
ORDER BY link.expert_id, link.provider_id;
COMMIT;
