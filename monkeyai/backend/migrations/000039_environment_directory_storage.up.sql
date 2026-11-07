BEGIN;
ALTER TABLE environment_presets DROP CONSTRAINT IF EXISTS environment_presets_storage_bytes_check;
ALTER TABLE environment_presets ADD CONSTRAINT environment_presets_storage_bytes_check CHECK (storage_bytes >= 0);
COMMIT;
