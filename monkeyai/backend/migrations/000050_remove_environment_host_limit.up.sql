BEGIN;
ALTER TABLE hosts DROP COLUMN max_environments;
COMMIT;
