ALTER TABLE environments ADD COLUMN deleted_at timestamptz;

UPDATE environments
SET deleted_at=COALESCE(observed_at,updated_at)
WHERE desired='deleted' AND phase='deleted' AND observed_generation=generation;

ALTER TABLE environments ADD CONSTRAINT environments_deleted_at_check
CHECK(deleted_at IS NULL OR (desired='deleted' AND phase='deleted' AND observed_generation=generation));
