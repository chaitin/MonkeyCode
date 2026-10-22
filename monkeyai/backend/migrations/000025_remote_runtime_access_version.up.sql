ALTER TABLE device_client_connections
    ADD COLUMN IF NOT EXISTS access_version bigint NOT NULL DEFAULT 1 CHECK (access_version > 0);
