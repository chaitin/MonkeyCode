BEGIN;

ALTER TABLE settings
    DROP CONSTRAINT settings_key_check,
    ADD CONSTRAINT settings_key_check CHECK (
        key IN ('branding', 'authentication', 'email', 'billing', 'session_reporting')
    );

ALTER TABLE sessions
    ADD COLUMN group_id uuid,
    ADD COLUMN model_id uuid,
    ADD COLUMN parent_session_id uuid,
    ADD COLUMN mode text,
    ADD COLUMN workspace_kind text,
    ADD COLUMN client_version text,
    ADD COLUMN engine_version text,
    ADD COLUMN runtime_version text,
    ADD COLUMN placeholder boolean NOT NULL DEFAULT false,
    ADD COLUMN started_at_provisional boolean NOT NULL DEFAULT false,
    ADD COLUMN clock_suspect boolean NOT NULL DEFAULT false,
    ADD COLUMN state_seq bigint NOT NULL DEFAULT 0,
    ADD COLUMN state_hash bytea,
    ADD COLUMN state_received_at timestamptz,
    ADD COLUMN resources_snapshot_id text,
    ADD COLUMN acked_turn integer NOT NULL DEFAULT 0,
    ADD COLUMN facts_version integer,
    ADD COLUMN last_stop_reason text,
    ADD COLUMN active_seconds bigint NOT NULL DEFAULT 0,
    ADD COLUMN client_deleted_at timestamptz,
    ADD COLUMN purged_at timestamptz,
    ADD COLUMN reporting_enabled_at timestamptz,
    ADD CONSTRAINT sessions_group_id_fkey FOREIGN KEY (group_id) REFERENCES groups (id),
    ADD CONSTRAINT sessions_model_id_fkey FOREIGN KEY (model_id) REFERENCES models (id),
    ADD CONSTRAINT sessions_parent_session_id_fkey FOREIGN KEY (parent_session_id) REFERENCES sessions (id),
    ADD CONSTRAINT sessions_parent_session_id_check CHECK (parent_session_id IS DISTINCT FROM id),
    ADD CONSTRAINT sessions_state_seq_check CHECK (state_seq >= 0),
    ADD CONSTRAINT sessions_acked_turn_check CHECK (acked_turn >= 0),
    ADD CONSTRAINT sessions_active_seconds_check CHECK (active_seconds >= 0);

ALTER TABLE sessions
    ALTER COLUMN last_active_at DROP NOT NULL,
    DROP CONSTRAINT sessions_client_type_check,
    DROP CONSTRAINT sessions_time_check,
    ADD CONSTRAINT sessions_client_type_check CHECK (
        client_type IN ('desktop', 'web', 'extension', 'mobile', 'unknown')
    ),
    ADD CONSTRAINT sessions_time_check CHECK (
        ended_at IS NULL OR ended_at >= started_at
    );

CREATE INDEX sessions_group_started_idx
    ON sessions (group_id, started_at DESC)
    WHERE group_id IS NOT NULL AND purged_at IS NULL;

CREATE INDEX sessions_parent_idx
    ON sessions (parent_session_id)
    WHERE parent_session_id IS NOT NULL;

CREATE TABLE session_resource_snapshots (
    session_id uuid NOT NULL REFERENCES sessions(id),
    snapshot_id text NOT NULL,
    revision bigint,
    state_version bigint,
    items jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array'),
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id, snapshot_id)
);

CREATE TABLE session_resource_snapshot_items (
    session_id uuid NOT NULL,
    snapshot_id text NOT NULL,
    resource_id text NOT NULL,
    kind text NOT NULL,
    name text,
    source text,
    version text,
    digest text,
    enabled boolean NOT NULL,
    available boolean NOT NULL,
    status text,
    reason text,
    PRIMARY KEY (session_id, snapshot_id, resource_id),
    FOREIGN KEY (session_id, snapshot_id)
        REFERENCES session_resource_snapshots(session_id, snapshot_id)
        ON DELETE CASCADE
);

CREATE INDEX session_snapshot_items_resource_idx
    ON session_resource_snapshot_items (resource_id, enabled);

CREATE TABLE session_turns (
    session_id uuid NOT NULL REFERENCES sessions(id),
    turn_index integer NOT NULL CHECK (turn_index > 0),
    facts_version integer NOT NULL,
    report_hash bytea NOT NULL,
    input_seq bigint NOT NULL,
    started_at timestamptz NOT NULL,
    ended_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    stop_reason text NOT NULL CHECK (
        stop_reason IN (
            'complete', 'interrupted', 'error',
            'max_turns', 'output_limit', 'unknown'
        )
    ),
    error_code text,
    recovered boolean NOT NULL DEFAULT false,

    model_id uuid REFERENCES models(id),
    thinking_enabled boolean,
    thinking_effort text,
    resources_snapshot_id text NOT NULL,
    client_version text,
    engine_version text,

    input_tokens bigint,
    output_tokens bigint,
    cache_creation_input_tokens bigint,
    cache_read_input_tokens bigint,
    subagent_input_tokens bigint,
    subagent_output_tokens bigint,
    subagent_cache_creation_input_tokens bigint,
    subagent_cache_read_input_tokens bigint,
    context_used bigint,
    context_window bigint,

    input_kind text NOT NULL,
    input_client_type text,
    input_machine_id text,
    command_skill_id text,
    attachments integer NOT NULL DEFAULT 0,
    canvas_nodes integer NOT NULL DEFAULT 0,
    steers integer NOT NULL DEFAULT 0,
    files_created integer NOT NULL DEFAULT 0,
    files_updated integer NOT NULL DEFAULT 0,
    files_deleted integer NOT NULL DEFAULT 0,
    compactions integer NOT NULL DEFAULT 0,
    permissions_asked integer NOT NULL DEFAULT 0,
    permissions_allowed integer NOT NULL DEFAULT 0,
    permissions_denied integer NOT NULL DEFAULT 0,
    truncated boolean NOT NULL DEFAULT false,

    PRIMARY KEY (session_id, turn_index),
    FOREIGN KEY (session_id, resources_snapshot_id)
        REFERENCES session_resource_snapshots(session_id, snapshot_id),
    CHECK (ended_at >= started_at),
    CHECK (input_tokens IS NULL OR input_tokens >= 0),
    CHECK (output_tokens IS NULL OR output_tokens >= 0),
    CHECK (context_used IS NULL OR context_used >= 0),
    CHECK (context_window IS NULL OR context_window >= 0),
    CHECK (attachments >= 0 AND canvas_nodes >= 0 AND steers >= 0),
    CHECK (files_created >= 0 AND files_updated >= 0 AND files_deleted >= 0),
    CHECK (compactions >= 0 AND permissions_asked >= 0),
    CHECK (permissions_allowed >= 0 AND permissions_denied >= 0)
);

CREATE INDEX session_turns_started_idx
    ON session_turns (started_at);

CREATE INDEX session_turns_model_started_idx
    ON session_turns (model_id, started_at)
    WHERE model_id IS NOT NULL;

CREATE TABLE session_turn_tools (
    session_id uuid NOT NULL,
    turn_index integer NOT NULL,
    ordinal integer NOT NULL CHECK (ordinal >= 0),
    category text NOT NULL CHECK (
        category IN ('builtin', 'skill', 'workflow', 'agent',
                     'connector', 'local_mcp')
    ),
    name text,
    resource_id text,
    resource_origin text,
    resource_version text,
    server text,
    target text,
    calls integer NOT NULL CHECK (calls > 0),
    failed integer NOT NULL CHECK (failed >= 0 AND failed <= calls),
    duration_ms bigint NOT NULL CHECK (duration_ms >= 0),
    PRIMARY KEY (session_id, turn_index, ordinal),
    FOREIGN KEY (session_id, turn_index)
        REFERENCES session_turns(session_id, turn_index)
        ON DELETE CASCADE
);

CREATE INDEX session_turn_tools_resource_idx
    ON session_turn_tools (category, resource_id);

CREATE TABLE session_skill_events (
    session_id uuid NOT NULL,
    turn_index integer NOT NULL,
    ordinal integer NOT NULL CHECK (ordinal >= 0),
    skill_id text,
    name text,
    origin text,
    version text,
    digest text,
    trigger text NOT NULL CHECK (trigger IN ('user', 'model', 'workflow')),
    ok boolean NOT NULL,
    reason text,
    PRIMARY KEY (session_id, turn_index, ordinal),
    FOREIGN KEY (session_id, turn_index)
        REFERENCES session_turns(session_id, turn_index)
        ON DELETE CASCADE
);

CREATE INDEX session_skill_events_skill_idx
    ON session_skill_events (skill_id, trigger)
    WHERE skill_id IS NOT NULL;

ALTER TABLE endpoints
    DROP CONSTRAINT endpoints_platform_check,
    ALTER COLUMN protocol_version DROP NOT NULL,
    ADD CONSTRAINT endpoints_platform_check CHECK (
        platform IN ('macos', 'windows', 'linux', 'ios', 'android', 'web')
    );

ALTER TABLE endpoints
    ADD COLUMN client_type text,
    ADD COLUMN client_name text,
    ADD COLUMN channel text,
    ADD COLUMN locale text,
    ADD COLUMN system_locale text,
    ADD COLUMN timezone text,
    ADD COLUMN runtime_version text,
    ADD COLUMN engine_version text,
    ADD COLUMN electron_version text,
    ADD COLUMN last_reported_at timestamptz;

ALTER TABLE image_jobs
    ADD COLUMN session_id uuid REFERENCES sessions(id);

CREATE INDEX image_jobs_session_idx
    ON image_jobs (session_id, created_at)
    WHERE session_id IS NOT NULL;

ALTER TABLE image_calls
    DROP CONSTRAINT image_calls_id_fkey,
    ADD COLUMN billing_transaction_id uuid,
    ADD COLUMN job_id uuid,
    ADD COLUMN session_id uuid REFERENCES sessions(id);

UPDATE image_calls
SET billing_transaction_id = id;

ALTER TABLE image_calls
    ADD CONSTRAINT image_calls_billing_transaction_id_key UNIQUE (billing_transaction_id),
    ADD CONSTRAINT image_calls_billing_transaction_id_fkey
        FOREIGN KEY (billing_transaction_id) REFERENCES billing_transactions(id),
    ADD CONSTRAINT image_calls_job_id_key UNIQUE (job_id),
    ADD CONSTRAINT image_calls_job_id_fkey
        FOREIGN KEY (job_id) REFERENCES image_jobs(id);

CREATE INDEX image_calls_session_started_idx
    ON image_calls (session_id, started_at)
    WHERE session_id IS NOT NULL;

COMMIT;
