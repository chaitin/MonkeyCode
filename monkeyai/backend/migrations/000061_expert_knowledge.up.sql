CREATE TABLE expert_knowledge_bases (
    expert_id uuid NOT NULL REFERENCES experts(id) ON DELETE CASCADE,
    kb_id uuid NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    PRIMARY KEY (expert_id, kb_id)
);
CREATE INDEX expert_knowledge_bases_kb_idx ON expert_knowledge_bases(kb_id);

-- 继承的只读权限只参与访问判断，不成为可编辑或永久的直接授权。
CREATE VIEW effective_resource_grants AS
SELECT resource_type, resource_id, user_id, group_id, all_users, access_level, usage_requirement
FROM resource_access_grants
UNION ALL
SELECT 'kb', k.id, g.user_id, g.group_id, g.all_users, 'read_only', 'optional'
FROM resource_access_grants g
JOIN experts e ON g.resource_type = 'expert' AND e.id = g.resource_id
JOIN expert_knowledge_bases x ON x.expert_id = e.id
JOIN knowledge_bases k ON k.id = x.kb_id
WHERE e.ownership_type = 'user' AND e.enabled AND e.deleted_at IS NULL
    AND k.ownership_type = 'user' AND k.owner_user_id = e.owner_user_id AND k.enabled;
