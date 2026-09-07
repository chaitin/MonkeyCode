BEGIN;

LOCK TABLE groups, group_users, resource_access_grants, users, settings, billing_quotas, credit_accounts, billing_transactions, credit_ledger_entries IN SHARE ROW EXCLUSIVE MODE;

DROP INDEX IF EXISTS groups_one_active_root_key;

-- 将旧系统组的有效授权保留为当前成员的直接授权，不再按角色自动扩展。
WITH RECURSIVE descendants(root_id, id) AS (
    SELECT id, id FROM groups
    WHERE id IN ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002')
      AND deleted_at IS NULL
    UNION
    SELECT d.root_id, g.id FROM groups g
    JOIN descendants d ON g.parent_id = d.id
    WHERE g.deleted_at IS NULL
), members(group_id, user_id) AS (
    SELECT g.id, u.id FROM groups g CROSS JOIN users u
    WHERE g.id = '00000000-0000-0000-0000-000000000001'
      AND g.deleted_at IS NULL AND u.deleted_at IS NULL
    UNION
    SELECT g.id, u.id FROM groups g CROSS JOIN users u
    WHERE g.id = '00000000-0000-0000-0000-000000000002'
      AND g.deleted_at IS NULL AND u.deleted_at IS NULL AND u.role = 'admin'
    UNION
    SELECT d.root_id, gu.user_id FROM descendants d
    JOIN group_users gu ON gu.group_id = d.id AND gu.removed_at IS NULL
    JOIN users u ON u.id = gu.user_id AND u.deleted_at IS NULL
)
INSERT INTO resource_access_grants (
    resource_type, resource_id, user_id, access_level,
    usage_requirement, granted_by_user_id, created_at
)
SELECT g.resource_type, g.resource_id, m.user_id,
       CASE WHEN bool_or(g.access_level = 'read_write') THEN 'read_write' ELSE 'read_only' END,
       CASE WHEN bool_or(g.usage_requirement = 'required') THEN 'required' ELSE 'optional' END,
       min(g.granted_by_user_id::text)::uuid, min(g.created_at)
FROM resource_access_grants g
JOIN members m ON m.group_id = g.group_id
GROUP BY g.resource_type, g.resource_id, m.user_id
ON CONFLICT (resource_type, resource_id, user_id) WHERE user_id IS NOT NULL
DO UPDATE SET
    access_level = CASE WHEN resource_access_grants.access_level = 'read_write' OR EXCLUDED.access_level = 'read_write' THEN 'read_write' ELSE 'read_only' END,
    usage_requirement = CASE WHEN resource_access_grants.usage_requirement = 'required' OR EXCLUDED.usage_requirement = 'required' THEN 'required' ELSE 'optional' END,
    updated_at = now();

-- 团队额度改存计费设置；管理员组的既有额度转为当前成员或直属子组的显式额度。
UPDATE settings s SET value=jsonb_set(s.value,'{root_credits}',to_jsonb(q.credits_per_cycle::text)), revision=revision+1
FROM billing_quotas q
WHERE s.key='billing' AND q.group_id='00000000-0000-0000-0000-000000000001' AND q.deleted_at IS NULL;

INSERT INTO billing_quotas(subject_type,user_id,credits_per_cycle,updated_by_user_id)
SELECT 'user',u.id,q.credits_per_cycle,q.updated_by_user_id FROM users u CROSS JOIN billing_quotas q
WHERE q.group_id='00000000-0000-0000-0000-000000000002' AND q.deleted_at IS NULL
  AND u.deleted_at IS NULL
  AND (u.billing_group_id=q.group_id OR (u.billing_group_id IS NULL AND u.role='admin'))
ON CONFLICT (user_id) WHERE subject_type='user' AND deleted_at IS NULL DO NOTHING;

INSERT INTO billing_quotas(subject_type,group_id,credits_per_cycle,updated_by_user_id)
SELECT 'group',g.id,q.credits_per_cycle,q.updated_by_user_id FROM groups g JOIN billing_quotas q ON q.group_id=g.parent_id
WHERE q.group_id='00000000-0000-0000-0000-000000000002' AND q.deleted_at IS NULL AND g.deleted_at IS NULL
ON CONFLICT (group_id) WHERE subject_type='group' AND deleted_at IS NULL DO NOTHING;

UPDATE users SET billing_group_id=NULL
WHERE billing_group_id IN ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002');
UPDATE credit_accounts SET group_id=NULL
WHERE group_id IN ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002');
UPDATE billing_transactions SET group_id=NULL
WHERE group_id IN ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002');
-- 仅迁移分组引用，流水金额、顺序、余额及业务标识保持不变。
ALTER TABLE credit_ledger_entries DISABLE TRIGGER credit_ledger_immutable;
UPDATE credit_ledger_entries SET metadata=metadata || jsonb_build_object('legacy_group_id',group_id),group_id=NULL
WHERE group_id IN ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002');
ALTER TABLE credit_ledger_entries ENABLE TRIGGER credit_ledger_immutable;
DELETE FROM billing_quotas
WHERE group_id IN ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002');

UPDATE groups SET parent_id = NULL, updated_at = now()
WHERE parent_id IN ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002');

DELETE FROM group_users
WHERE group_id IN ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002');

DELETE FROM resource_access_grants
WHERE group_id IN ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002');

DELETE FROM groups
WHERE id IN ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002');

COMMIT;
