-- 只恢复字段结构，已删除的默认模型绑定无法恢复。
ALTER TABLE experts ADD COLUMN default_model_id uuid REFERENCES models(id);
