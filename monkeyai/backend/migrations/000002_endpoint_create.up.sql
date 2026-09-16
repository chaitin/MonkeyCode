BEGIN;

CREATE TABLE endpoints (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id),
    machine_id uuid NOT NULL,
    device_name text NOT NULL CHECK (octet_length(device_name) BETWEEN 1 AND 128),
    alias text CHECK (alias IS NULL OR octet_length(alias) BETWEEN 1 AND 128),
    platform text NOT NULL CHECK (platform IN ('macos', 'windows', 'linux', 'ios', 'android')),
    os_version text NOT NULL CHECK (octet_length(os_version) BETWEEN 1 AND 64),
    arch text NOT NULL CHECK (octet_length(arch) BETWEEN 1 AND 32),
    client_version text NOT NULL CHECK (octet_length(client_version) BETWEEN 1 AND 64),
    protocol_version integer NOT NULL CHECK (protocol_version > 0),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz,
    revoked_at timestamptz,
    UNIQUE (user_id, machine_id),
    CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);
CREATE INDEX endpoints_user_created ON endpoints(user_id, created_at DESC, id DESC);

COMMIT;
