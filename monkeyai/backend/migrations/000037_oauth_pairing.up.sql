CREATE TABLE IF NOT EXISTS oauth_pairing_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_user_id uuid NOT NULL REFERENCES users(id),
    secret_hash text NOT NULL,
    device_code_hash text,
    user_code_hash text,
    code_challenge text,
    code_challenge_method text CHECK (code_challenge_method IN ('S256')),
    machine_id uuid,
    display_name text CHECK (display_name IS NULL OR octet_length(display_name) BETWEEN 1 AND 128),
    platform text CHECK (platform IS NULL OR platform IN ('android','ios','harmonyos')),
    os_version text CHECK (os_version IS NULL OR octet_length(os_version) BETWEEN 1 AND 64),
    arch text CHECK (arch IS NULL OR octet_length(arch) BETWEEN 1 AND 32),
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','joined','approved','consumed','denied','expired')),
    failed_attempts int NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
    interval_ms bigint NOT NULL DEFAULT 5000 CHECK (interval_ms >= 5000),
    next_poll_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    CHECK (expires_at > created_at),
    CHECK (status NOT IN ('joined','approved','consumed')
        OR (device_code_hash IS NOT NULL AND user_code_hash IS NOT NULL
            AND code_challenge IS NOT NULL AND machine_id IS NOT NULL
            AND display_name IS NOT NULL AND platform IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS oauth_pairing_requests_expiry ON oauth_pairing_requests(expires_at);
CREATE INDEX IF NOT EXISTS oauth_pairing_requests_creator ON oauth_pairing_requests(creator_user_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS oauth_pairing_requests_device_code ON oauth_pairing_requests(device_code_hash)
    WHERE device_code_hash IS NOT NULL;
