BEGIN;
CREATE TABLE IF NOT EXISTS hosts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id),
 name text NOT NULL CHECK(octet_length(name) BETWEEN 1 AND 128),
 architecture text NOT NULL CHECK(architecture IN ('amd64','arm64')),
 version text NOT NULL,
 public_key bytea UNIQUE CHECK(octet_length(public_key)=32),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','revoked')),
 enabled boolean NOT NULL DEFAULT false,
 max_environments integer NOT NULL DEFAULT 0 CHECK(max_environments BETWEEN 0 AND 1000000),
 last_seen_at timestamptz,
 report jsonb NOT NULL DEFAULT '{}'::jsonb,
 exchange_protocol integer NOT NULL DEFAULT 0 CHECK(exchange_protocol>=0),
 environment_synced_at timestamptz,
 activated_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS hosts_created_idx ON hosts(created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS hosts_user_idx ON hosts(user_id);

CREATE TABLE IF NOT EXISTS host_environment_configs (
 host_id uuid PRIMARY KEY REFERENCES hosts(id),
 resource jsonb CHECK(resource IS NULL OR jsonb_typeof(resource)='object'),
 user_max_environments integer NOT NULL DEFAULT 3 CHECK(user_max_environments BETWEEN 0 AND 1000000),
 billing jsonb NOT NULL DEFAULT '{"enabled":false,"cpu_credits_per_core_hour":"0","memory_credits_per_gib_hour":"0"}'::jsonb CHECK(jsonb_typeof(billing)='object')
);

CREATE TABLE IF NOT EXISTS host_upgrades (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 host_id uuid NOT NULL REFERENCES hosts(id),
 from_version text NOT NULL,
 target_version text NOT NULL,
 installer_sha256 text NOT NULL CHECK(installer_sha256 ~ '^[a-f0-9]{64}$'),
 manifest_sha256 text NOT NULL CHECK(manifest_sha256 ~ '^[a-f0-9]{64}$'),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','succeeded','failed')),
 reason text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS host_upgrades_active_key ON host_upgrades(host_id) WHERE status IN ('pending','running');
CREATE INDEX IF NOT EXISTS host_upgrades_history_idx ON host_upgrades(host_id,created_at DESC,id DESC);

CREATE TABLE IF NOT EXISTS environment_quotas (
 host_id uuid NOT NULL REFERENCES hosts(id),
 user_id uuid NOT NULL REFERENCES users(id),
 max_environments integer NOT NULL CHECK(max_environments BETWEEN 0 AND 1000000),
 PRIMARY KEY(host_id,user_id)
);
CREATE INDEX IF NOT EXISTS environment_quotas_user_idx ON environment_quotas(user_id,host_id);

CREATE TABLE IF NOT EXISTS environments (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id),
 host_id uuid NOT NULL REFERENCES hosts(id),
 name text NOT NULL CHECK(octet_length(name) BETWEEN 1 AND 128),
 instance_id uuid NOT NULL,
 generation bigint NOT NULL CHECK(generation>0),
 desired text NOT NULL CHECK(desired IN ('running','stopped','deleted')),
 phase text NOT NULL DEFAULT 'pending' CHECK(phase IN ('pending','preparing','starting','running','stopping','stopped','deleting','deleted','failed')),
 observed_generation bigint NOT NULL DEFAULT 0 CHECK(observed_generation BETWEEN 0 AND generation),
 spec jsonb NOT NULL CHECK(jsonb_typeof(spec)='object'),
 cpu_millis bigint NOT NULL CHECK(cpu_millis>0),
 memory_bytes bigint NOT NULL CHECK(memory_bytes>0),
 usage jsonb,
 reason text NOT NULL DEFAULT '',
 billing_stop_reason text NOT NULL DEFAULT '' CHECK(billing_stop_reason IN ('','insufficient_credits','billing_unavailable')),
 observed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS environments_user_idx ON environments(user_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS environments_host_idx ON environments(host_id,id);

CREATE TABLE IF NOT EXISTS environment_runtimes (
 environment_id uuid PRIMARY KEY REFERENCES environments(id),
 machine_id uuid UNIQUE,
 public_key bytea CHECK(octet_length(public_key)=32),
 instance_id uuid,
 generation bigint CHECK(generation>0),
 runtime_version text NOT NULL DEFAULT '',
 CHECK((machine_id IS NULL AND public_key IS NULL AND instance_id IS NULL AND generation IS NULL)
 OR (machine_id IS NOT NULL AND public_key IS NOT NULL AND instance_id IS NOT NULL AND generation IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS environment_operations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 environment_id uuid NOT NULL REFERENCES environments(id),
 user_id uuid NOT NULL REFERENCES users(id),
 generation bigint NOT NULL CHECK(generation>0),
 desired text NOT NULL CHECK(desired IN ('running','stopped','deleted')),
 kind text NOT NULL DEFAULT 'lifecycle' CHECK(kind IN ('create','lifecycle','runtime_upgrade')),
 target_version text NOT NULL DEFAULT '',
 request_key text NOT NULL CHECK(octet_length(request_key) BETWEEN 1 AND 128),
 request_hash text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','succeeded','failed','superseded')),
 reason text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 UNIQUE(environment_id,request_key),
 UNIQUE(environment_id,generation)
);
CREATE UNIQUE INDEX IF NOT EXISTS environment_creation_key ON environment_operations(user_id,request_key) WHERE kind='create';

CREATE TABLE IF NOT EXISTS environment_billing_periods (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 environment_id uuid NOT NULL REFERENCES environments(id),
 user_id uuid NOT NULL REFERENCES users(id),
 generation bigint NOT NULL CHECK(generation>0),
 pricing jsonb NOT NULL CHECK(jsonb_typeof(pricing)='object'),
 cpu_millis bigint NOT NULL CHECK(cpu_millis>0),
 memory_bytes bigint NOT NULL CHECK(memory_bytes>0),
 started_at timestamptz NOT NULL,
 confirmed_until timestamptz NOT NULL,
 closed_at timestamptz,
 settled_seconds bigint NOT NULL DEFAULT 0 CHECK(settled_seconds>=0),
 settled_amount numeric(24,6) NOT NULL DEFAULT 0 CHECK(settled_amount>=0),
 CHECK(confirmed_until>=started_at),
 CHECK(closed_at IS NULL OR closed_at=confirmed_until),
 CHECK(settled_seconds<=EXTRACT(EPOCH FROM confirmed_until-started_at))
);
CREATE UNIQUE INDEX IF NOT EXISTS environment_billing_open_key ON environment_billing_periods(environment_id) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS environment_billing_user_idx ON environment_billing_periods(user_id,started_at DESC);
CREATE INDEX IF NOT EXISTS environment_billing_unsettled_idx ON environment_billing_periods(confirmed_until) WHERE closed_at IS NULL OR settled_seconds<EXTRACT(EPOCH FROM confirmed_until-started_at);

ALTER TABLE oauth_grants DROP CONSTRAINT IF EXISTS oauth_grants_scopes_check;
ALTER TABLE oauth_grants ADD CONSTRAINT oauth_grants_scopes_check CHECK(
 scopes <@ ARRAY['device:bind','device:publish','device:connect','device:manage',
 'session:report','session:read','session:control','files:read','files:write','resources:manage',
 'environment:read','environment:manage']::text[]
);
ALTER TABLE resource_access_grants DROP CONSTRAINT IF EXISTS resource_access_grants_resource_type_check;
ALTER TABLE resource_access_grants ADD CONSTRAINT resource_access_grants_resource_type_check
 CHECK(resource_type IN ('model','skill','rule','connector','expert','kb','host'));

DO $$
DECLARE rel regclass; child regclass;
BEGIN
 FOR rel IN
  SELECT source_relation FROM billing_activity_partition_state WHERE table_name='billing_transactions'
  UNION SELECT target_relation FROM billing_activity_partition_state WHERE table_name='billing_transactions'
 LOOP
  EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS billing_transactions_category_check',rel);
  FOR child IN SELECT relid FROM pg_partition_tree(rel) WHERE level>0 ORDER BY level LOOP
   EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS billing_transactions_category_check',child);
  END LOOP;
  EXECUTE format('ALTER TABLE %s ADD CONSTRAINT billing_transactions_category_check CHECK (category IN (''model'',''tool'',''image'',''video'',''environment''))',rel);
 END LOOP;
 FOR rel IN SELECT source_relation FROM billing_ledger_partition_state UNION SELECT target_relation FROM billing_ledger_partition_state LOOP
  EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS credit_ledger_entries_category_check',rel);
  FOR child IN SELECT relid FROM pg_partition_tree(rel) WHERE level>0 ORDER BY level LOOP
   EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS credit_ledger_entries_category_check',child);
  END LOOP;
  EXECUTE format('ALTER TABLE %s ADD CONSTRAINT credit_ledger_entries_category_check CHECK (category IN (''model'',''tool'',''image'',''video'',''environment'',''other''))',rel);
 END LOOP;
END $$;
COMMIT;
