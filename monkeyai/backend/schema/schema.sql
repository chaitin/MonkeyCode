-- 从 migrations 自动提取；请勿手工修改。

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
    billing_group_id uuid,
    CONSTRAINT users_role_check CHECK (role IN ('admin', 'user')),
    CONSTRAINT users_status_check CHECK (status IN ('active', 'disabled')),
    CONSTRAINT users_disabled_at_check CHECK (
        (status = 'active' AND disabled_at IS NULL)
        OR status = 'disabled'
    )
);

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
        provider IN ('github', 'google', 'microsoft', 'gitlab', 'oidc', 'baizhiyun')
    )
);

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

ALTER TABLE users ADD CONSTRAINT users_billing_group_id_fkey
    FOREIGN KEY (billing_group_id) REFERENCES groups (id);

CREATE TABLE group_users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id uuid NOT NULL REFERENCES groups (id),
    user_id uuid NOT NULL REFERENCES users (id),
    assigned_by_user_id uuid NOT NULL REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    removed_at timestamptz
);

CREATE TABLE settings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    key text NOT NULL UNIQUE,
    value jsonb NOT NULL DEFAULT '{}'::jsonb,
    schema_version integer NOT NULL DEFAULT 1,
    updated_by_user_id uuid NOT NULL REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    revision bigint NOT NULL DEFAULT 1,
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

CREATE TABLE tags (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    created_by_user_id uuid NOT NULL REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);

CREATE TABLE skills (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ownership_type text NOT NULL,
    owner_user_id uuid NOT NULL REFERENCES users (id),
    name text NOT NULL,
    description text NOT NULL,
    package_file_name text NOT NULL,
    package_s3_key text NOT NULL,
    package_size_bytes bigint NOT NULL,
    package_sha256 text NOT NULL,
    file_count integer NOT NULL DEFAULT 0,
    enabled boolean NOT NULL DEFAULT true,
    revision bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    CONSTRAINT skills_ownership_type_check CHECK (ownership_type IN ('system', 'user')),
    CONSTRAINT skills_package_size_check CHECK (package_size_bytes >= 0),
    CONSTRAINT skills_file_count_check CHECK (file_count >= 0)
);

CREATE TABLE rules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ownership_type text NOT NULL,
    owner_user_id uuid NOT NULL REFERENCES users (id),
    name text NOT NULL,
    content text NOT NULL,
    revision bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    CONSTRAINT rules_ownership_type_check CHECK (ownership_type IN ('system', 'user'))
);

CREATE TABLE connectors (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ownership_type text NOT NULL DEFAULT 'system' CHECK (ownership_type IN ('system','user')),
    owner_user_id uuid NOT NULL REFERENCES users(id),
    name text NOT NULL,
    description text NOT NULL DEFAULT '',
    url text NOT NULL,
    authorization_mode text NOT NULL CHECK (authorization_mode IN ('none','centralized','independent')),
    authorization_method text CHECK (authorization_method IN ('http_header','oauth')),
    oauth_config jsonb NOT NULL DEFAULT '{}'::jsonb,
    oauth_client_secret text NOT NULL DEFAULT '',
    enabled boolean NOT NULL DEFAULT true,
    connection_status text NOT NULL DEFAULT 'unknown' CHECK (connection_status IN ('unknown','connected','error')),
    last_checked_at timestamptz,
    last_error text,
    revision bigint NOT NULL DEFAULT 1,
    config_revision bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    icon_s3_key text NOT NULL DEFAULT '',
    CHECK ((authorization_mode = 'none' AND authorization_method IS NULL) OR
           (authorization_mode <> 'none' AND authorization_method IS NOT NULL))
);

CREATE TABLE connector_credentials (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    connector_id uuid NOT NULL REFERENCES connectors(id),
    user_id uuid REFERENCES users(id),
    http_headers jsonb NOT NULL DEFAULT '{}'::jsonb,
    oauth_access_token text NOT NULL DEFAULT '',
    oauth_refresh_token text NOT NULL DEFAULT '',
    oauth_expires_at timestamptz,
    config_revision bigint NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz,
    name text NOT NULL DEFAULT '原有凭证' CHECK (char_length(btrim(name)) BETWEEN 1 AND 128),
    revision bigint NOT NULL DEFAULT 1,
    connection_status text NOT NULL DEFAULT 'unknown' CHECK (connection_status IN ('unknown','connected','error')),
    last_checked_at timestamptz,
    last_error text,
    CONSTRAINT connector_credentials_id_connector_key UNIQUE (id, connector_id)
);

CREATE TABLE mcp_tools (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    connector_id uuid NOT NULL REFERENCES connectors(id),
    credential_id uuid REFERENCES connector_credentials(id),
    name text NOT NULL,
    description text NOT NULL DEFAULT '',
    input_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
    enabled boolean NOT NULL DEFAULT false,
    credits_per_call numeric(24,6) NOT NULL DEFAULT 0 CHECK (credits_per_call >= 0),
    config_revision bigint NOT NULL,
    discovered_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    UNIQUE NULLS NOT DISTINCT (connector_id,credential_id,name),
    CONSTRAINT mcp_tools_credential_connector_fkey
        FOREIGN KEY (credential_id, connector_id) REFERENCES connector_credentials(id, connector_id)
);

CREATE TABLE connector_oauth_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    connector_id uuid NOT NULL REFERENCES connectors(id),
    user_id uuid NOT NULL REFERENCES users(id),
    config_revision bigint NOT NULL,
    state_hash text NOT NULL UNIQUE,
    verifier text NOT NULL,
    redirect_uri text NOT NULL,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    status text NOT NULL DEFAULT 'pending',
    created_at timestamptz NOT NULL DEFAULT now(),
    credential_id uuid REFERENCES connector_credentials(id),
    credential_revision bigint,
    name text NOT NULL DEFAULT '原有凭证',
    CONSTRAINT connector_oauth_requests_status_check CHECK (status IN ('pending','processing','succeeded','failed','expired'))
);

CREATE TABLE experts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    description text NOT NULL,
    prompt text NOT NULL,
    enabled boolean NOT NULL DEFAULT true,
    created_by_user_id uuid NOT NULL REFERENCES users (id),
    revision bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    ownership_type text NOT NULL DEFAULT 'system' CHECK (ownership_type IN ('system', 'user')),
    owner_user_id uuid NOT NULL REFERENCES users(id)
);

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
    all_users boolean NOT NULL DEFAULT false,
    CONSTRAINT resource_access_grants_resource_type_check CHECK (
        resource_type IN ('model', 'skill', 'rule', 'connector', 'expert')
    ),
    CONSTRAINT resource_access_grants_subject_check CHECK (
        (user_id IS NOT NULL)::integer + (group_id IS NOT NULL)::integer + all_users::integer = 1
    ),
    CONSTRAINT resource_access_grants_access_level_check CHECK (
        access_level IN ('read_only', 'read_write')
    ),
    CONSTRAINT resource_access_grants_usage_requirement_check CHECK (
        usage_requirement IN ('optional', 'required')
        AND (usage_requirement = 'optional' OR resource_type = 'rule')
    )
);

CREATE TABLE resource_tags (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    resource_type text NOT NULL,
    resource_id uuid NOT NULL,
    tag_id uuid NOT NULL REFERENCES tags (id),
    assigned_by_user_id uuid NOT NULL REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT resource_tags_resource_type_check CHECK (
        resource_type IN ('model', 'skill', 'rule', 'connector', 'expert')
    ),
    CONSTRAINT resource_tags_resource_key UNIQUE (resource_type, resource_id, tag_id)
);

CREATE TABLE expert_connectors (
    expert_id uuid NOT NULL REFERENCES experts(id),
    connector_id uuid NOT NULL REFERENCES connectors(id),
    required boolean NOT NULL DEFAULT true,
    tool_allowlist text[] NOT NULL DEFAULT '{}',
    tool_denylist text[] NOT NULL DEFAULT '{}',
    PRIMARY KEY (expert_id, connector_id)
);

CREATE TABLE expert_rules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    expert_id uuid NOT NULL REFERENCES experts (id),
    rule_id uuid NOT NULL REFERENCES rules (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT expert_rules_key UNIQUE (expert_id, rule_id)
);

CREATE TABLE expert_skills (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    expert_id uuid NOT NULL REFERENCES experts (id),
    skill_id uuid NOT NULL REFERENCES skills (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT expert_skills_key UNIQUE (expert_id, skill_id)
);

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

CREATE TABLE model_calls (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid REFERENCES sessions (id),
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

CREATE TABLE mcp_tool_calls (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid REFERENCES sessions (id),
    user_id uuid NOT NULL REFERENCES users (id),
    connector_id uuid NOT NULL REFERENCES connectors (id),
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

CREATE TABLE credit_accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users (id),
    balance numeric(24, 6) NOT NULL DEFAULT 0,
    period_start_at timestamptz NOT NULL,
    period_end_at timestamptz NOT NULL,
    last_refreshed_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    frozen numeric(24,6) NOT NULL DEFAULT 0,
    quota numeric(24,6) NOT NULL DEFAULT 0,
    group_id uuid REFERENCES groups(id),
    sequence bigint NOT NULL DEFAULT 0,
    CONSTRAINT credit_accounts_period_check CHECK (period_end_at > period_start_at),
    CONSTRAINT credit_accounts_amount_check CHECK (balance >= 0 AND frozen >= 0 AND frozen <= balance)
);

CREATE TABLE billing_transactions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id),
    account_id uuid NOT NULL REFERENCES credit_accounts(id),
    session_id uuid REFERENCES sessions(id),
    category text NOT NULL CHECK(category IN ('model','tool')),
    resource_id uuid NOT NULL,
    connector_id uuid REFERENCES connectors(id),
    item_name text NOT NULL,
    user_name text NOT NULL,
    user_email text NOT NULL,
    group_id uuid REFERENCES groups(id),
    mode text NOT NULL CHECK(mode IN ('local','remote')),
    status text NOT NULL CHECK(status IN ('created','reserved','running','settling','settled','released','rejected','unknown')),
    reserve numeric(24,6) NOT NULL CHECK(reserve >= 0),
    amount numeric(24,6),
    raw_amount numeric(24,6),
    pricing jsonb NOT NULL CHECK(jsonb_typeof(pricing)='object'),
    usage jsonb NOT NULL DEFAULT '{}',
    result text,
    error_code text NOT NULL DEFAULT '',
    idempotency_key text,
    request_hash text NOT NULL DEFAULT '',
    request_id text NOT NULL DEFAULT '',
    attempts integer NOT NULL DEFAULT 0,
    next_retry_at timestamptz,
    started_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK(amount IS NULL OR amount >= 0)
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
    transaction_id uuid REFERENCES billing_transactions(id),
    event_key text,
    sequence bigint,
    user_name text,
    user_email text,
    group_id uuid REFERENCES groups(id),
    mode text NOT NULL DEFAULT 'local',
    reverses_id uuid REFERENCES credit_ledger_entries(id),
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

CREATE TABLE wallet_user_bindings (
    user_id uuid PRIMARY KEY REFERENCES users(id),
    external_user_id text NOT NULL UNIQUE,
    verified_at timestamptz NOT NULL,
    updated_by_user_id uuid NOT NULL REFERENCES users(id)
);

CREATE TABLE wallet_billing_records (
    biz_id text PRIMARY KEY,
    transaction_id uuid NOT NULL UNIQUE REFERENCES billing_transactions(id),
    external_user_id text NOT NULL,
    team_slug text NOT NULL DEFAULT '',
    base_url text NOT NULL,
    app_id integer NOT NULL,
    status text NOT NULL CHECK(status IN ('pending','reserved','confirming','confirmed','rejected','unknown')),
    frozen_amount_quota bigint NOT NULL CHECK(frozen_amount_quota >= 0),
    actual_amount_quota bigint,
    confirmation_status text,
    error_code text NOT NULL DEFAULT '',
    trace_id text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    confirmed_at timestamptz
);

CREATE TABLE billing_migration_issues (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subject text NOT NULL,
    value jsonb NOT NULL,
    reason text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

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
    request_id text,
    CONSTRAINT audits_actor_type_check CHECK (actor_type IN ('user', 'system')),
    CONSTRAINT audits_result_check CHECK (result IN ('success', 'failed')),
    CONSTRAINT audits_request_params_check CHECK (jsonb_typeof(request_params) = 'object')
);

CREATE TABLE email_codes (
    email text NOT NULL,
    purpose text NOT NULL CHECK (purpose IN ('login', 'register', 'reset')),
    code_hash text NOT NULL,
    expires_at timestamptz NOT NULL,
    attempts integer NOT NULL DEFAULT 0,
    ready boolean NOT NULL DEFAULT false,
    PRIMARY KEY (email, purpose)
);

CREATE TABLE email_code_deliveries (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email text NOT NULL,
    ip_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE browser_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash text NOT NULL UNIQUE,
    user_id uuid NOT NULL REFERENCES users (id),
    authentication_method text NOT NULL,
    expires_at timestamptz NOT NULL,
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz,
    CONSTRAINT browser_sessions_authentication_method_check CHECK (
        authentication_method IN ('password', 'oauth', 'email_code')
    ),
    CONSTRAINT browser_sessions_expiry_check CHECK (expires_at > created_at)
);

CREATE TABLE oauth_authorization_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id text NOT NULL,
    redirect_uri text NOT NULL,
    state text NOT NULL,
    code_challenge text NOT NULL,
    code_challenge_method text NOT NULL,
    expires_at timestamptz NOT NULL,
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT oauth_authorization_requests_method_check CHECK (
        code_challenge_method = 'S256'
    ),
    CONSTRAINT oauth_authorization_requests_expiry_check CHECK (expires_at > created_at)
);

CREATE TABLE oauth_login_states (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    state_hash text NOT NULL UNIQUE,
    connection_id text NOT NULL,
    purpose text NOT NULL DEFAULT 'client' CHECK (purpose IN ('client','admin')),
    CHECK ((purpose='client' AND authorization_request_id IS NOT NULL) OR (purpose='admin' AND authorization_request_id IS NULL)),
    authorization_request_id uuid REFERENCES oauth_authorization_requests (id),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT oauth_login_states_expiry_check CHECK (expires_at > created_at)
);

CREATE TABLE oauth_authorization_codes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code_hash text NOT NULL UNIQUE,
    authorization_request_id uuid NOT NULL UNIQUE REFERENCES oauth_authorization_requests (id),
    user_id uuid NOT NULL REFERENCES users (id),
    client_id text NOT NULL,
    redirect_uri text NOT NULL,
    code_challenge text NOT NULL,
    expires_at timestamptz NOT NULL,
    redeemed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT oauth_authorization_codes_expiry_check CHECK (expires_at > created_at)
);

CREATE TABLE oauth_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users (id),
    client_id text NOT NULL,
    access_token_hash text NOT NULL UNIQUE,
    refresh_token_hash text NOT NULL UNIQUE,
    access_expires_at timestamptz NOT NULL,
    refresh_expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz,
    CONSTRAINT oauth_tokens_expiry_check CHECK (
        access_expires_at > created_at AND refresh_expires_at > access_expires_at
    )
);

CREATE TABLE api_keys (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users (id),
    name text NOT NULL,
    key_prefix text NOT NULL,
    key_hash text NOT NULL UNIQUE,
    scopes text[] NOT NULL,
    expires_at timestamptz NOT NULL,
    last_used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz,
    CONSTRAINT api_keys_name_check CHECK (btrim(name) <> ''),
    CONSTRAINT api_keys_scopes_check CHECK (
        cardinality(scopes) > 0
        AND scopes <@ ARRAY['model:invoke', 'mcp:invoke']::text[]
    ),
    CONSTRAINT api_keys_expiry_check CHECK (expires_at > created_at)
);
