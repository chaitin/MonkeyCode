BEGIN;

CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    email text NOT NULL,
    avatar_url text,
    password_hash text,
    role text NOT NULL DEFAULT 'user',
    status text NOT NULL DEFAULT 'active',
    joined_at timestamptz NOT NULL DEFAULT now(),
    disabled_at timestamptz,
    last_login_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    CONSTRAINT users_role_check CHECK (role IN ('admin', 'user')),
    CONSTRAINT users_status_check CHECK (status IN ('active', 'disabled')),
    CONSTRAINT users_disabled_at_check CHECK (
        (status = 'active' AND disabled_at IS NULL)
        OR status = 'disabled'
    )
);

CREATE UNIQUE INDEX users_email_active_key
    ON users (lower(email))
    WHERE deleted_at IS NULL;

CREATE INDEX users_status_idx
    ON users (status)
    WHERE deleted_at IS NULL;

CREATE TABLE user_identities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users (id),
    provider text NOT NULL,
    issuer text NOT NULL,
    provider_subject text NOT NULL,
    username text,
    email text,
    avatar_url text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    CONSTRAINT user_identities_provider_check CHECK (
        provider IN ('github', 'google', 'microsoft', 'gitlab', 'oidc')
    )
);

CREATE UNIQUE INDEX user_identities_subject_active_key
    ON user_identities (provider, issuer, provider_subject)
    WHERE deleted_at IS NULL;

CREATE INDEX user_identities_user_idx
    ON user_identities (user_id)
    WHERE deleted_at IS NULL;

CREATE TABLE groups (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id uuid REFERENCES groups (id),
    name text NOT NULL,
    created_by_user_id uuid REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    CONSTRAINT groups_not_own_parent_check CHECK (parent_id IS DISTINCT FROM id)
);

CREATE UNIQUE INDEX groups_one_active_root_key
    ON groups ((true))
    WHERE parent_id IS NULL AND deleted_at IS NULL;

CREATE INDEX groups_parent_idx
    ON groups (parent_id)
    WHERE deleted_at IS NULL;

CREATE TABLE group_users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id uuid NOT NULL REFERENCES groups (id),
    user_id uuid NOT NULL REFERENCES users (id),
    assigned_by_user_id uuid NOT NULL REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    removed_at timestamptz
);

CREATE UNIQUE INDEX group_users_active_key
    ON group_users (group_id, user_id)
    WHERE removed_at IS NULL;

CREATE INDEX group_users_user_idx
    ON group_users (user_id)
    WHERE removed_at IS NULL;

CREATE TABLE settings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    key text NOT NULL UNIQUE,
    value jsonb NOT NULL DEFAULT '{}'::jsonb,
    schema_version integer NOT NULL DEFAULT 1,
    updated_by_user_id uuid NOT NULL REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT settings_key_check CHECK (
        key IN ('branding', 'authentication', 'email', 'billing')
    ),
    CONSTRAINT settings_value_check CHECK (jsonb_typeof(value) = 'object'),
    CONSTRAINT settings_schema_version_check CHECK (schema_version > 0)
);

CREATE TABLE models (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ownership_type text NOT NULL,
    owner_user_id uuid NOT NULL REFERENCES users (id),
    model_id text NOT NULL,
    display_name text NOT NULL,
    protocol text NOT NULL,
    base_url text NOT NULL,
    api_key text NOT NULL,
    advanced_config jsonb NOT NULL,
    credit_multiplier numeric(12, 6) NOT NULL DEFAULT 1,
    enabled boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    CONSTRAINT models_ownership_type_check CHECK (ownership_type IN ('system', 'user')),
    CONSTRAINT models_protocol_check CHECK (
        protocol IN ('openai_chat_completions', 'openai_responses', 'anthropic')
    ),
    CONSTRAINT models_advanced_config_check CHECK (jsonb_typeof(advanced_config) = 'object'),
    CONSTRAINT models_credit_multiplier_check CHECK (credit_multiplier > 0)
);

CREATE INDEX models_owner_idx
    ON models (owner_user_id)
    WHERE deleted_at IS NULL;

CREATE INDEX models_enabled_idx
    ON models (enabled)
    WHERE deleted_at IS NULL;

CREATE TABLE tags (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    created_by_user_id uuid NOT NULL REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);

CREATE UNIQUE INDEX tags_name_active_key
    ON tags (lower(name))
    WHERE deleted_at IS NULL;

CREATE TABLE skills (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ownership_type text NOT NULL,
    owner_user_id uuid NOT NULL REFERENCES users (id),
    name text NOT NULL,
    description text NOT NULL,
    instructions text NOT NULL,
    package_file_name text NOT NULL,
    package_s3_key text NOT NULL,
    package_size_bytes bigint NOT NULL,
    package_sha256 text NOT NULL,
    file_count integer NOT NULL DEFAULT 0,
    enabled boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    CONSTRAINT skills_ownership_type_check CHECK (ownership_type IN ('system', 'user')),
    CONSTRAINT skills_package_size_check CHECK (package_size_bytes >= 0),
    CONSTRAINT skills_file_count_check CHECK (file_count >= 0)
);

CREATE INDEX skills_owner_idx
    ON skills (owner_user_id)
    WHERE deleted_at IS NULL;

CREATE INDEX skills_enabled_idx
    ON skills (enabled)
    WHERE deleted_at IS NULL;

CREATE TABLE rules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ownership_type text NOT NULL,
    owner_user_id uuid NOT NULL REFERENCES users (id),
    name text NOT NULL,
    content text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    CONSTRAINT rules_ownership_type_check CHECK (ownership_type IN ('system', 'user'))
);

CREATE INDEX rules_owner_idx
    ON rules (owner_user_id)
    WHERE deleted_at IS NULL;

CREATE TABLE mcp_servers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ownership_type text NOT NULL,
    owner_user_id uuid NOT NULL REFERENCES users (id),
    name text NOT NULL,
    description text NOT NULL,
    url text NOT NULL,
    authorization_mode text NOT NULL,
    authorization_method text,
    connection_status text NOT NULL DEFAULT 'unknown',
    last_checked_at timestamptz,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    CONSTRAINT mcp_servers_ownership_type_check CHECK (ownership_type IN ('system', 'user')),
    CONSTRAINT mcp_servers_authorization_check CHECK (
        (authorization_mode = 'none' AND authorization_method IS NULL)
        OR (
            authorization_mode IN ('independent', 'centralized')
            AND authorization_method IN ('oauth', 'http_header')
        )
    ),
    CONSTRAINT mcp_servers_connection_status_check CHECK (
        connection_status IN ('connected', 'error', 'unknown')
    )
);

CREATE INDEX mcp_servers_owner_idx
    ON mcp_servers (owner_user_id)
    WHERE deleted_at IS NULL;

CREATE TABLE mcp_server_credentials (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id uuid NOT NULL REFERENCES mcp_servers (id),
    user_id uuid REFERENCES users (id),
    method text NOT NULL,
    http_headers jsonb,
    oauth_access_token text,
    oauth_refresh_token text,
    oauth_token_type text,
    oauth_scopes text,
    oauth_expires_at timestamptz,
    status text NOT NULL DEFAULT 'pending',
    authorized_at timestamptz,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz,
    CONSTRAINT mcp_server_credentials_method_check CHECK (method IN ('oauth', 'http_header')),
    CONSTRAINT mcp_server_credentials_headers_check CHECK (
        http_headers IS NULL OR jsonb_typeof(http_headers) = 'object'
    ),
    CONSTRAINT mcp_server_credentials_status_check CHECK (
        status IN ('pending', 'authorized', 'expired', 'revoked', 'error')
    )
);

CREATE UNIQUE INDEX mcp_server_credentials_centralized_active_key
    ON mcp_server_credentials (server_id)
    WHERE user_id IS NULL AND revoked_at IS NULL;

CREATE UNIQUE INDEX mcp_server_credentials_independent_active_key
    ON mcp_server_credentials (server_id, user_id)
    WHERE user_id IS NOT NULL AND revoked_at IS NULL;

CREATE INDEX mcp_server_credentials_user_idx
    ON mcp_server_credentials (user_id)
    WHERE user_id IS NOT NULL AND revoked_at IS NULL;

CREATE TABLE mcp_tools (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id uuid NOT NULL REFERENCES mcp_servers (id),
    name text NOT NULL,
    description text NOT NULL,
    input_schema jsonb,
    enabled boolean NOT NULL DEFAULT true,
    credits_per_call numeric(24, 6) NOT NULL DEFAULT 0,
    discovered_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    CONSTRAINT mcp_tools_input_schema_check CHECK (
        input_schema IS NULL OR jsonb_typeof(input_schema) = 'object'
    ),
    CONSTRAINT mcp_tools_credits_per_call_check CHECK (credits_per_call >= 0)
);

CREATE UNIQUE INDEX mcp_tools_name_active_key
    ON mcp_tools (server_id, name)
    WHERE deleted_at IS NULL;

CREATE INDEX mcp_tools_enabled_idx
    ON mcp_tools (server_id, enabled)
    WHERE deleted_at IS NULL;

CREATE TABLE experts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    description text NOT NULL,
    prompt text NOT NULL,
    enabled boolean NOT NULL DEFAULT true,
    created_by_user_id uuid NOT NULL REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);

CREATE INDEX experts_enabled_idx
    ON experts (enabled)
    WHERE deleted_at IS NULL;

CREATE TABLE resource_access_grants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    resource_type text NOT NULL,
    resource_id uuid NOT NULL,
    user_id uuid REFERENCES users (id),
    group_id uuid REFERENCES groups (id),
    access_level text NOT NULL,
    usage_requirement text NOT NULL DEFAULT 'optional',
    granted_by_user_id uuid NOT NULL REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT resource_access_grants_resource_type_check CHECK (
        resource_type IN ('model', 'skill', 'rule', 'mcp_server', 'expert')
    ),
    CONSTRAINT resource_access_grants_subject_check CHECK (
        (user_id IS NOT NULL)::integer + (group_id IS NOT NULL)::integer = 1
    ),
    CONSTRAINT resource_access_grants_access_level_check CHECK (
        access_level IN ('read_only', 'read_write')
    ),
    CONSTRAINT resource_access_grants_usage_requirement_check CHECK (
        usage_requirement IN ('optional', 'required')
        AND (usage_requirement = 'optional' OR resource_type = 'rule')
    )
);

CREATE UNIQUE INDEX resource_access_grants_user_key
    ON resource_access_grants (resource_type, resource_id, user_id)
    WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX resource_access_grants_group_key
    ON resource_access_grants (resource_type, resource_id, group_id)
    WHERE group_id IS NOT NULL;

CREATE INDEX resource_access_grants_user_idx
    ON resource_access_grants (user_id, resource_type)
    WHERE user_id IS NOT NULL;

CREATE INDEX resource_access_grants_group_idx
    ON resource_access_grants (group_id, resource_type)
    WHERE group_id IS NOT NULL;

CREATE TABLE resource_tags (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    resource_type text NOT NULL,
    resource_id uuid NOT NULL,
    tag_id uuid NOT NULL REFERENCES tags (id),
    assigned_by_user_id uuid NOT NULL REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT resource_tags_resource_type_check CHECK (
        resource_type IN ('model', 'skill', 'rule', 'mcp_server', 'expert')
    ),
    CONSTRAINT resource_tags_resource_key UNIQUE (resource_type, resource_id, tag_id)
);

CREATE INDEX resource_tags_tag_idx ON resource_tags (tag_id);

CREATE TABLE expert_mcp_tools (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    expert_id uuid NOT NULL REFERENCES experts (id),
    tool_id uuid NOT NULL REFERENCES mcp_tools (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT expert_mcp_tools_key UNIQUE (expert_id, tool_id)
);

CREATE INDEX expert_mcp_tools_tool_idx ON expert_mcp_tools (tool_id);

CREATE TABLE expert_rules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    expert_id uuid NOT NULL REFERENCES experts (id),
    rule_id uuid NOT NULL REFERENCES rules (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT expert_rules_key UNIQUE (expert_id, rule_id)
);

CREATE INDEX expert_rules_rule_idx ON expert_rules (rule_id);

CREATE TABLE expert_skills (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    expert_id uuid NOT NULL REFERENCES experts (id),
    skill_id uuid NOT NULL REFERENCES skills (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT expert_skills_key UNIQUE (expert_id, skill_id)
);

CREATE INDEX expert_skills_skill_idx ON expert_skills (skill_id);

CREATE TABLE sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id uuid NOT NULL REFERENCES users (id),
    expert_id uuid REFERENCES experts (id),
    title text NOT NULL,
    session_type text NOT NULL,
    client_type text NOT NULL,
    client_name text NOT NULL,
    device_id text,
    turn_count integer NOT NULL DEFAULT 0,
    failure_code text,
    failure_message text,
    started_at timestamptz NOT NULL,
    last_active_at timestamptz NOT NULL,
    ended_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    CONSTRAINT sessions_session_type_check CHECK (
        session_type IN ('conversation', 'workflow', 'tool', 'scheduled')
    ),
    CONSTRAINT sessions_client_type_check CHECK (
        client_type IN ('desktop', 'web', 'extension', 'mobile')
    ),
    CONSTRAINT sessions_turn_count_check CHECK (turn_count >= 0),
    CONSTRAINT sessions_time_check CHECK (
        last_active_at >= started_at
        AND (ended_at IS NULL OR ended_at >= started_at)
    )
);

CREATE INDEX sessions_owner_started_idx
    ON sessions (owner_user_id, started_at DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX sessions_active_idx
    ON sessions (last_active_at DESC)
    WHERE ended_at IS NULL AND deleted_at IS NULL;

CREATE INDEX sessions_expert_idx
    ON sessions (expert_id, started_at DESC)
    WHERE expert_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE model_calls (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES sessions (id),
    user_id uuid NOT NULL REFERENCES users (id),
    model_id uuid NOT NULL REFERENCES models (id),
    request_id text,
    status text NOT NULL,
    input_tokens bigint NOT NULL DEFAULT 0,
    cached_input_tokens bigint NOT NULL DEFAULT 0,
    output_tokens bigint NOT NULL DEFAULT 0,
    cache_hit boolean NOT NULL DEFAULT false,
    response_duration_ms integer,
    error_code text,
    error_message text,
    started_at timestamptz NOT NULL,
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT model_calls_status_check CHECK (
        status IN ('running', 'succeeded', 'failed', 'cancelled')
    ),
    CONSTRAINT model_calls_token_count_check CHECK (
        input_tokens >= 0
        AND cached_input_tokens >= 0
        AND cached_input_tokens <= input_tokens
        AND output_tokens >= 0
    ),
    CONSTRAINT model_calls_duration_check CHECK (
        response_duration_ms IS NULL OR response_duration_ms >= 0
    ),
    CONSTRAINT model_calls_time_check CHECK (
        completed_at IS NULL OR completed_at >= started_at
    )
);

CREATE INDEX model_calls_session_started_idx
    ON model_calls (session_id, started_at);

CREATE INDEX model_calls_model_started_idx
    ON model_calls (model_id, started_at DESC);

CREATE INDEX model_calls_user_started_idx
    ON model_calls (user_id, started_at DESC);

CREATE TABLE mcp_tool_calls (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES sessions (id),
    user_id uuid NOT NULL REFERENCES users (id),
    server_id uuid NOT NULL REFERENCES mcp_servers (id),
    tool_id uuid NOT NULL REFERENCES mcp_tools (id),
    request_id text,
    status text NOT NULL,
    duration_ms integer,
    error_code text,
    error_message text,
    started_at timestamptz NOT NULL,
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT mcp_tool_calls_status_check CHECK (
        status IN ('running', 'succeeded', 'failed', 'cancelled')
    ),
    CONSTRAINT mcp_tool_calls_duration_check CHECK (
        duration_ms IS NULL OR duration_ms >= 0
    ),
    CONSTRAINT mcp_tool_calls_time_check CHECK (
        completed_at IS NULL OR completed_at >= started_at
    )
);

CREATE INDEX mcp_tool_calls_session_started_idx
    ON mcp_tool_calls (session_id, started_at);

CREATE INDEX mcp_tool_calls_tool_started_idx
    ON mcp_tool_calls (tool_id, started_at DESC);

CREATE INDEX mcp_tool_calls_user_started_idx
    ON mcp_tool_calls (user_id, started_at DESC);

CREATE INDEX mcp_tool_calls_server_started_idx
    ON mcp_tool_calls (server_id, started_at DESC);

CREATE TABLE billing_quotas (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_type text NOT NULL,
    group_id uuid REFERENCES groups (id),
    user_id uuid REFERENCES users (id),
    credits_per_cycle numeric(24, 6) NOT NULL,
    updated_by_user_id uuid NOT NULL REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    CONSTRAINT billing_quotas_subject_check CHECK (
        (subject_type = 'group' AND group_id IS NOT NULL AND user_id IS NULL)
        OR (subject_type = 'user' AND user_id IS NOT NULL AND group_id IS NULL)
    ),
    CONSTRAINT billing_quotas_credits_check CHECK (credits_per_cycle >= 0)
);

CREATE UNIQUE INDEX billing_quotas_group_active_key
    ON billing_quotas (group_id)
    WHERE subject_type = 'group' AND deleted_at IS NULL;

CREATE UNIQUE INDEX billing_quotas_user_active_key
    ON billing_quotas (user_id)
    WHERE subject_type = 'user' AND deleted_at IS NULL;

CREATE TABLE credit_accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users (id) UNIQUE,
    balance numeric(24, 6) NOT NULL DEFAULT 0,
    period_start_at timestamptz NOT NULL,
    period_end_at timestamptz NOT NULL,
    last_refreshed_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT credit_accounts_period_check CHECK (period_end_at > period_start_at)
);

CREATE TABLE credit_ledger_entries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id uuid NOT NULL REFERENCES credit_accounts (id),
    user_id uuid NOT NULL REFERENCES users (id),
    session_id uuid REFERENCES sessions (id),
    entry_type text NOT NULL,
    category text NOT NULL,
    source_type text,
    source_id uuid,
    resource_type text,
    resource_id uuid,
    item_name text NOT NULL,
    quantity bigint,
    usage_unit text,
    unit_credits numeric(24, 6),
    credit_delta numeric(24, 6) NOT NULL,
    balance_after numeric(24, 6) NOT NULL,
    external_reference text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    occurred_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT credit_ledger_entries_entry_type_check CHECK (
        entry_type IN ('charge', 'grant', 'refund', 'reset', 'adjustment')
    ),
    CONSTRAINT credit_ledger_entries_category_check CHECK (
        category IN ('model', 'tool', 'other')
    ),
    CONSTRAINT credit_ledger_entries_source_type_check CHECK (
        source_type IS NULL
        OR source_type IN ('model_call', 'mcp_tool_call', 'quota_refresh', 'manual')
    ),
    CONSTRAINT credit_ledger_entries_resource_type_check CHECK (
        resource_type IS NULL OR resource_type IN ('model', 'mcp_tool')
    ),
    CONSTRAINT credit_ledger_entries_usage_unit_check CHECK (
        usage_unit IS NULL OR usage_unit IN ('tokens', 'calls')
    ),
    CONSTRAINT credit_ledger_entries_quantity_check CHECK (
        quantity IS NULL OR quantity >= 0
    ),
    CONSTRAINT credit_ledger_entries_unit_credits_check CHECK (
        unit_credits IS NULL OR unit_credits >= 0
    ),
    CONSTRAINT credit_ledger_entries_metadata_check CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX credit_ledger_entries_account_occurred_idx
    ON credit_ledger_entries (account_id, occurred_at DESC);

CREATE INDEX credit_ledger_entries_user_occurred_idx
    ON credit_ledger_entries (user_id, occurred_at DESC);

CREATE INDEX credit_ledger_entries_session_idx
    ON credit_ledger_entries (session_id)
    WHERE session_id IS NOT NULL;

CREATE INDEX credit_ledger_entries_source_idx
    ON credit_ledger_entries (source_type, source_id)
    WHERE source_type IS NOT NULL AND source_id IS NOT NULL;

CREATE TABLE audits (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_type text NOT NULL,
    actor_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
    actor_name text NOT NULL,
    actor_email text,
    action text NOT NULL,
    category text NOT NULL,
    target_type text,
    target_id uuid,
    request_params jsonb NOT NULL DEFAULT '{}'::jsonb,
    source_ip inet,
    user_agent text,
    result text NOT NULL,
    error_message text,
    occurred_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT audits_actor_type_check CHECK (actor_type IN ('user', 'system')),
    CONSTRAINT audits_result_check CHECK (result IN ('success', 'failed')),
    CONSTRAINT audits_request_params_check CHECK (jsonb_typeof(request_params) = 'object')
);

CREATE INDEX audits_occurred_idx ON audits (occurred_at DESC);
CREATE INDEX audits_actor_occurred_idx ON audits (actor_user_id, occurred_at DESC);
CREATE INDEX audits_category_occurred_idx ON audits (category, occurred_at DESC);
CREATE INDEX audits_target_idx
    ON audits (target_type, target_id)
    WHERE target_type IS NOT NULL AND target_id IS NOT NULL;

COMMIT;
