ALTER TABLE engine_hosts ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
