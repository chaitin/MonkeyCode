BEGIN;
CREATE TABLE engine_hosts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK (octet_length(name) BETWEEN 1 AND 128),
 architecture text NOT NULL CHECK (architecture IN ('amd64','arm64')),
 version text NOT NULL,
 public_key bytea UNIQUE CHECK (octet_length(public_key)=32),
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','revoked')),
 enrollment_hash text NOT NULL UNIQUE,
 enrollment_expires_at timestamptz NOT NULL,
 enrolled_at timestamptz,
 challenge text,
 challenge_expires_at timestamptz,
 last_seen_at timestamptz,
 report jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX engine_hosts_created_idx ON engine_hosts(created_at DESC,id DESC);
COMMIT;
