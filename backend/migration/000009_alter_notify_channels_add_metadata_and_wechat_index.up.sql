ALTER TABLE notify_channels ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- 微信公众号绑定并发保护：同一用户最多一条 active wechat_mp 渠道。
-- 业务层 HandleBindEvent 先查后写，没有事务隔离，并发扫码会重复插入。
-- partial unique 索引兜底；不约束其他 kind（保留 webhook 等多渠道场景）。
CREATE UNIQUE INDEX IF NOT EXISTS idx_notify_channels_wechat_mp_owner
    ON notify_channels (owner_id)
    WHERE kind = 'wechat_mp' AND deleted_at IS NULL;

ALTER TABLE notify_channels ADD COLUMN IF NOT EXISTS target_id VARCHAR(64) DEFAULT '' NOT NULL;

-- HandleUnsubscribe 按 openid 反查所有绑定该 openid 的渠道；带 kind 前缀确保只扫 wechat_mp 行。
CREATE INDEX IF NOT EXISTS idx_notify_channels_kind_target_id
    ON notify_channels (kind, target_id)
    WHERE deleted_at IS NULL;
