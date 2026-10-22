BEGIN;

-- 000027_apikey_runtime_binding.down.sql
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'api_keys' AND column_name = 'runtime_grant_id'
    ) THEN
        UPDATE api_keys SET revoked_at=now() WHERE runtime_grant_id IS NOT NULL AND revoked_at IS NULL;
    END IF;
END;
$$;
ALTER TABLE api_keys
    DROP CONSTRAINT IF EXISTS api_keys_runtime_binding_check,
    DROP CONSTRAINT IF EXISTS api_keys_device_fkey,
    DROP COLUMN IF EXISTS machine_id,
    DROP COLUMN IF EXISTS runtime_grant_id;

-- 000026_identity_device_grant.down.sql
DELETE FROM oauth_login_states WHERE purpose='device';
ALTER TABLE oauth_login_states
    DROP CONSTRAINT IF EXISTS oauth_login_states_purpose_check,
    DROP CONSTRAINT IF EXISTS oauth_login_states_request_check,
    DROP CONSTRAINT IF EXISTS oauth_login_states_check,
    DROP COLUMN IF EXISTS device_request_id,
    ADD CONSTRAINT oauth_login_states_purpose_check CHECK (purpose IN ('client','admin')),
    ADD CONSTRAINT oauth_login_states_check CHECK ((purpose='client' AND authorization_request_id IS NOT NULL) OR (purpose='admin' AND authorization_request_id IS NULL));
DO $$
BEGIN
    IF to_regclass('oauth_grants') IS NOT NULL THEN
        UPDATE oauth_grants SET revoked_at=now(),revoke_reason='device_grant_downgrade'
        WHERE purpose='runtime' AND revoked_at IS NULL;
        UPDATE oauth_tokens t SET revoked_at=now() FROM oauth_grants g
        WHERE t.grant_id=g.id AND g.purpose='runtime' AND t.revoked_at IS NULL;
    END IF;
END;
$$;
ALTER TABLE IF EXISTS oauth_grants
    DROP CONSTRAINT IF EXISTS oauth_grants_requested_device_check,
    DROP COLUMN IF EXISTS requested_machine_id,
    DROP COLUMN IF EXISTS requested_key_id,
    DROP COLUMN IF EXISTS restore_approved;
DROP TABLE IF EXISTS oauth_device_requests;

-- 000025_session_index.down.sql
DROP INDEX IF EXISTS sessions_owner_machine_index;
ALTER TABLE sessions DROP COLUMN IF EXISTS last_live_report_at, DROP COLUMN IF EXISTS live_boot_id, DROP COLUMN IF EXISTS live_lease_epoch;

-- 000024_relay_connections.down.sql
DROP TABLE IF EXISTS device_client_connections;

-- 000023_endpoint_execution.down.sql
ALTER TABLE sessions DROP COLUMN IF EXISTS host_verified, DROP COLUMN IF EXISTS host_revision;
ALTER TABLE endpoints
    DROP CONSTRAINT IF EXISTS endpoints_execution_access_check,
    DROP CONSTRAINT IF EXISTS endpoints_execution_key_check,
    DROP COLUMN IF EXISTS execution_protocols,
    DROP COLUMN IF EXISTS execution_public_key,
    DROP COLUMN IF EXISTS key_id,
    DROP COLUMN IF EXISTS deployment_mode,
    DROP COLUMN IF EXISTS remote_access_state,
    DROP COLUMN IF EXISTS active_grant_id,
    DROP COLUMN IF EXISTS registration_version,
    DROP COLUMN IF EXISTS grant_version,
    DROP COLUMN IF EXISTS lease_epoch;

-- 000022_identity_grants.down.sql
-- 回滚前收敛族撤销状态，重复回滚时授权表或绑定列可能已不存在。
DO $$
BEGIN
    IF to_regclass('oauth_grants') IS NOT NULL AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'oauth_tokens' AND column_name = 'grant_id'
    ) THEN
        UPDATE oauth_tokens t SET revoked_at = g.revoked_at
        FROM oauth_grants g WHERE t.grant_id = g.id AND g.revoked_at IS NOT NULL AND t.revoked_at IS NULL;
    END IF;
END;
$$;
DROP TRIGGER IF EXISTS oauth_tokens_legacy_grant ON oauth_tokens;
DROP FUNCTION IF EXISTS oauth_legacy_grant();
ALTER TABLE oauth_tokens
    DROP CONSTRAINT IF EXISTS oauth_tokens_grant_fkey,
    DROP COLUMN IF EXISTS grant_id,
    DROP COLUMN IF EXISTS parent_id,
    DROP COLUMN IF EXISTS rotated_at;
ALTER TABLE oauth_authorization_codes DROP COLUMN IF EXISTS scopes, DROP COLUMN IF EXISTS audience;
ALTER TABLE oauth_authorization_requests DROP COLUMN IF EXISTS scopes, DROP COLUMN IF EXISTS audience;
DROP TABLE IF EXISTS oauth_grants;

COMMIT;
