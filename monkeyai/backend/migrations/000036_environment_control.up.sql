BEGIN;
CREATE TABLE environment_control (id integer PRIMARY KEY CHECK(id=1));
INSERT INTO environment_control VALUES(1);
CREATE TABLE environment_presets (
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
CREATE TABLE environment_hosts (
 host_id uuid PRIMARY KEY REFERENCES engine_hosts(id),
 enabled boolean NOT NULL DEFAULT false,
 cpu_millis bigint NOT NULL CHECK(cpu_millis>=0),
 memory_bytes bigint NOT NULL CHECK(memory_bytes>=0),
 storage_bytes bigint NOT NULL CHECK(storage_bytes>=0),
 max_environments integer NOT NULL CHECK(max_environments BETWEEN 0 AND 10000),
 protocol integer NOT NULL DEFAULT 0,
 sync_at timestamptz
);
CREATE TABLE environment_quotas (
 user_id uuid PRIMARY KEY REFERENCES users(id),
 max_environments integer NOT NULL CHECK(max_environments BETWEEN 0 AND 1000),
 max_running integer NOT NULL CHECK(max_running BETWEEN 0 AND 1000),
 cpu_millis bigint NOT NULL CHECK(cpu_millis>=0),
 memory_bytes bigint NOT NULL CHECK(memory_bytes>=0),
 storage_bytes bigint NOT NULL CHECK(storage_bytes>=0)
);
CREATE TABLE environments (
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
CREATE INDEX environments_user_idx ON environments(user_id,created_at DESC,id DESC);
CREATE INDEX environments_host_idx ON environments(host_id,id);
CREATE TABLE environment_operations (
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
COMMIT;
