BEGIN;

-- 000022_identity_grants.up.sql
CREATE TABLE IF NOT EXISTS oauth_grants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id),
    client_id text NOT NULL,
    scopes text[] NOT NULL DEFAULT '{}',
    audience text NOT NULL DEFAULT 'monkeyai-api' CHECK (audience = 'monkeyai-api'),
    purpose text NOT NULL DEFAULT 'user' CHECK (purpose IN ('user', 'runtime')),
    machine_id uuid,
    key_id text,
    revocation_version bigint NOT NULL DEFAULT 1 CHECK (revocation_version > 0),
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz,
    revoke_reason text,
    UNIQUE (id, user_id, client_id),
    CHECK ((machine_id IS NULL) = (key_id IS NULL)),
    CHECK (scopes <@ ARRAY['device:bind','device:publish','device:connect','device:manage',
        'session:report','session:read','session:control','files:read','files:write','resources:manage']::text[])
);
CREATE INDEX IF NOT EXISTS oauth_grants_user_active_idx ON oauth_grants(user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS oauth_grants_machine_idx ON oauth_grants(user_id, machine_id) WHERE machine_id IS NOT NULL;

ALTER TABLE oauth_authorization_requests
    ADD COLUMN IF NOT EXISTS scopes text[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'monkeyai-api' CHECK (audience = 'monkeyai-api');
ALTER TABLE oauth_authorization_codes
    ADD COLUMN IF NOT EXISTS scopes text[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'monkeyai-api' CHECK (audience = 'monkeyai-api');

ALTER TABLE oauth_tokens
    ADD COLUMN IF NOT EXISTS grant_id uuid,
    ADD COLUMN IF NOT EXISTS parent_id uuid UNIQUE REFERENCES oauth_tokens(id),
    ADD COLUMN IF NOT EXISTS rotated_at timestamptz;

-- 只回填尚未绑定的旧 token，重复执行不得改写现有授权族和刷新链。
INSERT INTO oauth_grants(id, user_id, client_id, expires_at, created_at, revoked_at, revoke_reason)
SELECT id, user_id, client_id, refresh_expires_at, created_at, revoked_at,
    CASE WHEN revoked_at IS NOT NULL THEN 'legacy_revocation' END
FROM oauth_tokens WHERE grant_id IS NULL
ON CONFLICT (id) DO NOTHING;
UPDATE oauth_tokens SET grant_id = id WHERE grant_id IS NULL;

-- 兼容旧版本服务在迁移后的写入，每条旧 token 只能建立无新增权限的独立授权族。
CREATE OR REPLACE FUNCTION oauth_legacy_grant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.grant_id IS NULL THEN
        INSERT INTO oauth_grants(user_id, client_id, expires_at)
        VALUES (NEW.user_id, NEW.client_id, NEW.refresh_expires_at)
        RETURNING id INTO NEW.grant_id;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS oauth_tokens_legacy_grant ON oauth_tokens;
CREATE TRIGGER oauth_tokens_legacy_grant BEFORE INSERT ON oauth_tokens
    FOR EACH ROW EXECUTE FUNCTION oauth_legacy_grant();
ALTER TABLE oauth_tokens
    ALTER COLUMN grant_id SET NOT NULL,
    DROP CONSTRAINT IF EXISTS oauth_tokens_grant_fkey,
    ADD CONSTRAINT oauth_tokens_grant_fkey FOREIGN KEY (grant_id, user_id, client_id)
        REFERENCES oauth_grants(id, user_id, client_id);
CREATE INDEX IF NOT EXISTS oauth_tokens_grant_idx ON oauth_tokens(grant_id);

-- 000023_endpoint_execution.up.sql
ALTER TABLE endpoints
    ADD COLUMN IF NOT EXISTS execution_protocols jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(execution_protocols)='object'),
    ADD COLUMN IF NOT EXISTS execution_public_key bytea CHECK (execution_public_key IS NULL OR octet_length(execution_public_key) = 32),
    ADD COLUMN IF NOT EXISTS key_id text,
    ADD COLUMN IF NOT EXISTS deployment_mode text CHECK (deployment_mode IN ('desktop_managed', 'standalone')),
    ADD COLUMN IF NOT EXISTS remote_access_state text NOT NULL DEFAULT 'disabled' CHECK (remote_access_state IN ('disabled', 'enabled', 'revoked')),
    ADD COLUMN IF NOT EXISTS active_grant_id uuid REFERENCES oauth_grants(id),
    ADD COLUMN IF NOT EXISTS registration_version bigint NOT NULL DEFAULT 0 CHECK (registration_version >= 0),
    ADD COLUMN IF NOT EXISTS grant_version bigint NOT NULL DEFAULT 0 CHECK (grant_version >= 0),
    ADD COLUMN IF NOT EXISTS lease_epoch bigint NOT NULL DEFAULT 0 CHECK (lease_epoch >= 0),
    DROP CONSTRAINT IF EXISTS endpoints_execution_key_check,
    DROP CONSTRAINT IF EXISTS endpoints_execution_access_check,
    ADD CONSTRAINT endpoints_execution_key_check CHECK ((execution_public_key IS NULL) = (key_id IS NULL)),
    ADD CONSTRAINT endpoints_execution_access_check CHECK (remote_access_state <> 'enabled' OR (execution_public_key IS NOT NULL AND active_grant_id IS NOT NULL AND deployment_mode IS NOT NULL));

ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS host_verified boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS host_revision bigint NOT NULL DEFAULT 0 CHECK (host_revision >= 0);

-- 000024_relay_connections.up.sql
CREATE TABLE IF NOT EXISTS device_client_connections (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id),
    machine_id uuid NOT NULL,
    client_grant_id uuid NOT NULL REFERENCES oauth_grants(id),
    grant_version bigint NOT NULL,
    access_version bigint NOT NULL DEFAULT 1 CHECK (access_version > 0),
    scopes text[] NOT NULL,
    protocol jsonb NOT NULL CHECK (jsonb_typeof(protocol) = 'object'),
    ticket_hash text NOT NULL UNIQUE,
    ticket_version bigint NOT NULL DEFAULT 1 CHECK (ticket_version > 0),
    expires_at timestamptz NOT NULL,
    previous_ticket_hash text UNIQUE,
    previous_expires_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (user_id,machine_id) REFERENCES endpoints(user_id,machine_id)
);
CREATE INDEX IF NOT EXISTS device_client_connections_target_idx ON device_client_connections(user_id,machine_id,expires_at) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS device_client_connections_grant_idx ON device_client_connections(client_grant_id) WHERE revoked_at IS NULL;

-- 000025_session_index.up.sql
ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS last_live_report_at timestamptz,
    ADD COLUMN IF NOT EXISTS live_boot_id uuid,
    ADD COLUMN IF NOT EXISTS live_lease_epoch bigint CHECK (live_lease_epoch > 0);
CREATE INDEX IF NOT EXISTS sessions_owner_machine_index ON sessions(owner_user_id,device_id,started_at DESC,id DESC)
    WHERE host_verified AND NOT placeholder AND deleted_at IS NULL AND client_deleted_at IS NULL AND purged_at IS NULL;

-- 000026_identity_device_grant.up.sql
CREATE TABLE IF NOT EXISTS oauth_device_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id text NOT NULL CHECK (client_id='monkeyai-runtime'),
    device_code_hash text NOT NULL UNIQUE,
    user_code_hash text NOT NULL UNIQUE,
    machine_id uuid NOT NULL,
    execution_public_key bytea NOT NULL CHECK (octet_length(execution_public_key)=32),
    key_id text NOT NULL,
    display_name text NOT NULL CHECK (octet_length(display_name) BETWEEN 1 AND 128),
    platform text NOT NULL CHECK (platform IN ('macos','windows','linux')),
    arch text NOT NULL CHECK (octet_length(arch) BETWEEN 1 AND 32),
    requested_scopes text[] NOT NULL,
    approved_scopes text[],
    owner_user_id uuid REFERENCES users(id),
    restore_revoked boolean NOT NULL DEFAULT false,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied','expired','consumed')),
    interval_ms bigint NOT NULL DEFAULT 5000 CHECK (interval_ms>=5000),
    next_poll_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    CHECK (expires_at>created_at),
    CHECK ((status NOT IN ('approved','consumed')) OR (owner_user_id IS NOT NULL AND approved_scopes IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS oauth_device_requests_expiry ON oauth_device_requests(expires_at);
ALTER TABLE oauth_grants
    ADD COLUMN IF NOT EXISTS requested_machine_id uuid,
    ADD COLUMN IF NOT EXISTS requested_key_id text,
    ADD COLUMN IF NOT EXISTS restore_approved boolean NOT NULL DEFAULT false,
    DROP CONSTRAINT IF EXISTS oauth_grants_requested_device_check,
    ADD CONSTRAINT oauth_grants_requested_device_check CHECK ((requested_machine_id IS NULL)=(requested_key_id IS NULL));
ALTER TABLE oauth_login_states
    DROP CONSTRAINT IF EXISTS oauth_login_states_purpose_check,
    DROP CONSTRAINT IF EXISTS oauth_login_states_check,
    DROP CONSTRAINT IF EXISTS oauth_login_states_request_check,
    ADD COLUMN IF NOT EXISTS device_request_id uuid REFERENCES oauth_device_requests(id),
    ADD CONSTRAINT oauth_login_states_purpose_check CHECK (purpose IN ('client','admin','device')),
    ADD CONSTRAINT oauth_login_states_request_check CHECK (
        (purpose='client' AND authorization_request_id IS NOT NULL AND device_request_id IS NULL) OR
        (purpose='admin' AND authorization_request_id IS NULL AND device_request_id IS NULL) OR
        (purpose='device' AND authorization_request_id IS NULL AND device_request_id IS NOT NULL));

-- 000027_apikey_runtime_binding.up.sql
ALTER TABLE api_keys
    ADD COLUMN IF NOT EXISTS machine_id uuid,
    ADD COLUMN IF NOT EXISTS runtime_grant_id uuid REFERENCES oauth_grants(id),
    DROP CONSTRAINT IF EXISTS api_keys_runtime_binding_check,
    DROP CONSTRAINT IF EXISTS api_keys_device_fkey,
    ADD CONSTRAINT api_keys_runtime_binding_check CHECK ((machine_id IS NULL)=(runtime_grant_id IS NULL)),
    ADD CONSTRAINT api_keys_device_fkey FOREIGN KEY(user_id,machine_id) REFERENCES endpoints(user_id,machine_id);
CREATE INDEX IF NOT EXISTS api_keys_runtime_grant_idx ON api_keys(runtime_grant_id) WHERE runtime_grant_id IS NOT NULL;

COMMIT;
