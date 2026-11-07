BEGIN;
CREATE TABLE IF NOT EXISTS engine_hosts (
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
CREATE INDEX IF NOT EXISTS engine_hosts_created_idx ON engine_hosts(created_at DESC,id DESC);

CREATE TABLE IF NOT EXISTS environment_control (id integer PRIMARY KEY CHECK(id=1));
INSERT INTO environment_control VALUES(1) ON CONFLICT (id) DO NOTHING;
CREATE TABLE IF NOT EXISTS environment_presets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK(octet_length(name) BETWEEN 1 AND 128),
 enabled boolean NOT NULL DEFAULT true,
 architecture text NOT NULL CHECK(architecture IN ('amd64','arm64')),
 configuration jsonb NOT NULL,
 cpu_millis bigint NOT NULL CHECK(cpu_millis>0),
 memory_bytes bigint NOT NULL CHECK(memory_bytes>0),
 storage_bytes bigint NOT NULL CHECK(storage_bytes>0),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS environment_hosts (
 host_id uuid PRIMARY KEY REFERENCES engine_hosts(id),
 enabled boolean NOT NULL DEFAULT false,
 cpu_millis bigint NOT NULL CHECK(cpu_millis>=0),
 memory_bytes bigint NOT NULL CHECK(memory_bytes>=0),
 storage_bytes bigint NOT NULL CHECK(storage_bytes>=0),
 max_environments integer NOT NULL CHECK(max_environments BETWEEN 0 AND 10000),
 protocol integer NOT NULL DEFAULT 0,
 sync_at timestamptz
);
CREATE TABLE IF NOT EXISTS environment_quotas (
 user_id uuid PRIMARY KEY REFERENCES users(id),
 max_environments integer NOT NULL CHECK(max_environments BETWEEN 0 AND 1000),
 max_running integer NOT NULL CHECK(max_running BETWEEN 0 AND 1000),
 cpu_millis bigint NOT NULL CHECK(cpu_millis>=0),
 memory_bytes bigint NOT NULL CHECK(memory_bytes>=0),
 storage_bytes bigint NOT NULL CHECK(storage_bytes>=0)
);
CREATE TABLE IF NOT EXISTS environments (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id),
 host_id uuid NOT NULL REFERENCES engine_hosts(id),
 preset_id uuid NOT NULL REFERENCES environment_presets(id),
 name text NOT NULL CHECK(octet_length(name) BETWEEN 1 AND 128),
 generation bigint NOT NULL CHECK(generation>0),
 instance_id uuid NOT NULL,
 desired text NOT NULL CHECK(desired IN ('running','stopped','deleted')),
 phase text NOT NULL DEFAULT 'pending' CHECK(phase IN ('pending','preparing','starting','running','stopping','stopped','deleting','deleted','failed')),
 observed_generation bigint NOT NULL DEFAULT 0,
 reason text NOT NULL DEFAULT '',
 spec jsonb NOT NULL,
 cpu_millis bigint NOT NULL,
 memory_bytes bigint NOT NULL,
 storage_bytes bigint NOT NULL,
 compute_reserved boolean NOT NULL DEFAULT true,
 request_key text NOT NULL CHECK(octet_length(request_key) BETWEEN 1 AND 128),
 request_hash text NOT NULL,
 observed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,request_key)
);
CREATE INDEX IF NOT EXISTS environments_user_idx ON environments(user_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS environments_host_idx ON environments(host_id,id);
CREATE TABLE IF NOT EXISTS environment_operations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 environment_id uuid NOT NULL REFERENCES environments(id),
 generation bigint NOT NULL,
 desired text NOT NULL CHECK(desired IN ('running','stopped','deleted')),
 request_key text NOT NULL CHECK(octet_length(request_key) BETWEEN 1 AND 128),
 request_hash text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','succeeded','failed','superseded')),
 reason text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 UNIQUE(environment_id,request_key),
 UNIQUE(environment_id,generation)
);

CREATE TABLE IF NOT EXISTS environment_runtime (
 environment_id uuid PRIMARY KEY REFERENCES environments(id),
 machine_id uuid NOT NULL UNIQUE,
 public_key bytea NOT NULL CHECK(octet_length(public_key)=32),
 instance_id uuid NOT NULL,
 generation bigint NOT NULL CHECK(generation>0),
 request_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE oauth_grants DROP CONSTRAINT IF EXISTS oauth_grants_scopes_check;
ALTER TABLE oauth_grants ADD CONSTRAINT oauth_grants_scopes_check CHECK (
 scopes <@ ARRAY['device:bind','device:publish','device:connect','device:manage',
 'session:report','session:read','session:control','files:read','files:write','resources:manage',
 'environment:read','environment:manage']::text[]
);
COMMIT;
