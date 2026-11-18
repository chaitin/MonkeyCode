BEGIN;
SET LOCAL lock_timeout = '2s';
ALTER TABLE connector_credentials DROP COLUMN tools_synced_at;
ALTER TABLE connectors DROP COLUMN tools_synced_at;
COMMIT;
