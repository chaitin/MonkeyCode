ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;

UPDATE tasks
SET last_active_at = COALESCE(last_active_at, created_at, CURRENT_TIMESTAMP);

ALTER TABLE tasks
    ALTER COLUMN last_active_at SET DEFAULT CURRENT_TIMESTAMP,
    ALTER COLUMN last_active_at SET NOT NULL;
