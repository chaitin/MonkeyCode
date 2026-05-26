DROP INDEX IF EXISTS idx_notify_channels_kind_target_id;
ALTER TABLE notify_channels DROP COLUMN IF EXISTS target_id;
DROP INDEX IF EXISTS idx_notify_channels_wechat_mp_owner;
ALTER TABLE notify_channels DROP COLUMN IF EXISTS metadata;
