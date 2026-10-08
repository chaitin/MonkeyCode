BEGIN;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM sessions
        WHERE client_type NOT IN ('desktop', 'web', 'extension', 'mobile')
           OR last_active_at IS NULL
    ) THEN
        RAISE EXCEPTION 'session data cannot be represented by the original constraints';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM settings
        WHERE key = 'session_reporting'
    ) THEN
        RAISE EXCEPTION 'session_reporting setting exists; cannot restore settings constraint';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM endpoints
        WHERE platform = 'web'
           OR protocol_version IS NULL
    ) THEN
        RAISE EXCEPTION 'endpoint data cannot be represented by the original constraints';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM image_calls calls
        WHERE calls.job_id IS NOT NULL
           OR calls.billing_transaction_id IS NOT NULL
              AND calls.billing_transaction_id IS DISTINCT FROM calls.id
           OR NOT EXISTS (
                SELECT 1
                FROM billing_transactions transactions
                WHERE transactions.id = calls.id
           )
    ) THEN
        RAISE EXCEPTION 'image call data cannot restore the original billing foreign key';
    END IF;
END $$;

DROP INDEX image_calls_session_started_idx;

ALTER TABLE image_calls
    DROP CONSTRAINT image_calls_billing_transaction_id_fkey,
    DROP CONSTRAINT image_calls_billing_transaction_id_key,
    DROP CONSTRAINT image_calls_job_id_fkey,
    DROP CONSTRAINT image_calls_job_id_key,
    DROP CONSTRAINT image_calls_session_id_fkey,
    DROP COLUMN session_id,
    DROP COLUMN job_id,
    DROP COLUMN billing_transaction_id,
    ADD CONSTRAINT image_calls_id_fkey
        FOREIGN KEY (id) REFERENCES billing_transactions(id);

DROP INDEX image_jobs_session_idx;

ALTER TABLE image_jobs
    DROP CONSTRAINT image_jobs_session_id_fkey,
    DROP COLUMN session_id;

DROP INDEX session_skill_events_skill_idx;
DROP INDEX session_turn_tools_resource_idx;
DROP INDEX session_turns_model_started_idx;
DROP INDEX session_turns_started_idx;
DROP INDEX session_snapshot_items_resource_idx;

DROP TABLE session_skill_events;
DROP TABLE session_turn_tools;
DROP TABLE session_turns;
DROP TABLE session_resource_snapshot_items;
DROP TABLE session_resource_snapshots;

DROP INDEX sessions_parent_idx;
DROP INDEX sessions_group_started_idx;

ALTER TABLE sessions
    DROP CONSTRAINT sessions_group_id_fkey,
    DROP CONSTRAINT sessions_model_id_fkey,
    DROP CONSTRAINT sessions_parent_session_id_fkey,
    DROP CONSTRAINT sessions_parent_session_id_check,
    DROP CONSTRAINT sessions_state_seq_check,
    DROP CONSTRAINT sessions_acked_turn_check,
    DROP CONSTRAINT sessions_active_seconds_check,
    DROP CONSTRAINT sessions_client_type_check,
    DROP CONSTRAINT sessions_time_check,
    ADD CONSTRAINT sessions_client_type_check CHECK (
        client_type IN ('desktop', 'web', 'extension', 'mobile')
    ),
    ADD CONSTRAINT sessions_time_check CHECK (
        last_active_at >= started_at
        AND (ended_at IS NULL OR ended_at >= started_at)
    ),
    ALTER COLUMN last_active_at SET NOT NULL,
    DROP COLUMN reporting_enabled_at,
    DROP COLUMN purged_at,
    DROP COLUMN client_deleted_at,
    DROP COLUMN active_seconds,
    DROP COLUMN last_stop_reason,
    DROP COLUMN facts_version,
    DROP COLUMN acked_turn,
    DROP COLUMN resources_snapshot_id,
    DROP COLUMN state_received_at,
    DROP COLUMN state_hash,
    DROP COLUMN state_seq,
    DROP COLUMN clock_suspect,
    DROP COLUMN started_at_provisional,
    DROP COLUMN placeholder,
    DROP COLUMN runtime_version,
    DROP COLUMN engine_version,
    DROP COLUMN client_version,
    DROP COLUMN workspace_kind,
    DROP COLUMN mode,
    DROP COLUMN parent_session_id,
    DROP COLUMN model_id,
    DROP COLUMN group_id;

ALTER TABLE endpoints
    DROP CONSTRAINT endpoints_platform_check,
    ADD CONSTRAINT endpoints_platform_check CHECK (
        platform IN ('macos', 'windows', 'linux', 'ios', 'android')
    ),
    ALTER COLUMN protocol_version SET NOT NULL,
    DROP COLUMN last_reported_at,
    DROP COLUMN electron_version,
    DROP COLUMN engine_version,
    DROP COLUMN runtime_version,
    DROP COLUMN timezone,
    DROP COLUMN system_locale,
    DROP COLUMN locale,
    DROP COLUMN channel,
    DROP COLUMN client_name,
    DROP COLUMN client_type;

ALTER TABLE settings
    DROP CONSTRAINT settings_key_check,
    ADD CONSTRAINT settings_key_check CHECK (
        key IN ('branding', 'authentication', 'email', 'billing')
    );

COMMIT;
