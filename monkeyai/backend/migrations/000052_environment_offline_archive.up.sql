ALTER TABLE environments ADD COLUMN archived_at timestamptz
 CHECK (archived_at IS NULL OR (desired='deleted' AND generation<>observed_generation));

CREATE INDEX environments_pending_archive ON environments(host_id)
 WHERE desired='deleted' AND archived_at IS NULL AND generation<>observed_generation;
