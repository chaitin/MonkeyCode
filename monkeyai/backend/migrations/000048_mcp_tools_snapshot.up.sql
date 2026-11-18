BEGIN;
SET LOCAL lock_timeout = '2s';
ALTER TABLE connectors ADD COLUMN tools_synced_at timestamptz;
ALTER TABLE connector_credentials ADD COLUMN tools_synced_at timestamptz;
COMMIT;
