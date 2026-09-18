-- 回滚仅恢复字段结构，不恢复已移除的独立计费归属。
ALTER TABLE users ADD COLUMN billing_group_id uuid REFERENCES groups (id);
