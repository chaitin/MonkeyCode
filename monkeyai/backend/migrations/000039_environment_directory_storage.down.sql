BEGIN;
-- 普通目录预设没有磁盘限额，无法无损还原旧版必填配额；存在时拒绝回滚。
ALTER TABLE IF EXISTS environment_presets DROP CONSTRAINT IF EXISTS environment_presets_storage_bytes_check;
ALTER TABLE IF EXISTS environment_presets ADD CONSTRAINT environment_presets_storage_bytes_check CHECK (storage_bytes > 0);
COMMIT;
