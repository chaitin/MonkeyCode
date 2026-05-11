CREATE TABLE IF NOT EXISTS tasks (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v1() NOT NULL,
    user_id uuid NOT NULL,
    kind character varying(50) NOT NULL,
    content text NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp with time zone,
    completed_at timestamp with time zone,
    sub_type character varying(255),
    summary text,
    title text,
    last_active_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    log_store character varying(255)
);

CREATE INDEX IF NOT EXISTS idx_tasks_completed_at ON tasks USING btree (completed_at);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at_id ON tasks USING btree (created_at, id);
CREATE INDEX IF NOT EXISTS idx_tasks_kind ON tasks USING btree (kind);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks USING btree (status);
CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks USING btree (user_id);

CREATE TABLE IF NOT EXISTS project_tasks (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v1() NOT NULL,
    task_id uuid NOT NULL,
    model_id uuid NOT NULL,
    image_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    git_identity_id uuid,
    branch text,
    cli_name character varying(16) DEFAULT 'codex'::character varying NOT NULL,
    repo_url text,
    repo_filename text,
    project_id uuid,
    issue_id uuid
);

CREATE INDEX IF NOT EXISTS idx_project_tasks_created_at_id ON project_tasks USING btree (created_at, id);
CREATE INDEX IF NOT EXISTS idx_project_tasks_git_identity_id ON project_tasks USING btree (git_identity_id);
CREATE INDEX IF NOT EXISTS idx_project_tasks_image_id ON project_tasks USING btree (image_id);
CREATE INDEX IF NOT EXISTS idx_project_tasks_model_id ON project_tasks USING btree (model_id);
CREATE INDEX IF NOT EXISTS idx_project_tasks_task_id ON project_tasks USING btree (task_id);

CREATE TABLE IF NOT EXISTS task_virtualmachines (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v1() NOT NULL,
    task_id uuid NOT NULL,
    virtualmachine_id character varying(64),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS unique_idx_task_virtualmachines ON task_virtualmachines USING btree (task_id, virtualmachine_id);

CREATE TABLE IF NOT EXISTS task_usage_stats (
    id uuid PRIMARY KEY NOT NULL,
    task_id uuid NOT NULL,
    user_id uuid NOT NULL,
    model character varying(255) DEFAULT ''::character varying NOT NULL,
    input_tokens bigint DEFAULT 0 NOT NULL,
    output_tokens bigint DEFAULT 0 NOT NULL,
    total_tokens bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task_usage_stats_task_id ON task_usage_stats USING btree (task_id);
CREATE INDEX IF NOT EXISTS idx_task_usage_stats_user_id ON task_usage_stats USING btree (user_id);

CREATE TABLE IF NOT EXISTS task_model_switches (
    id uuid PRIMARY KEY NOT NULL,
    task_id uuid NOT NULL REFERENCES tasks(id),
    user_id uuid NOT NULL REFERENCES users(id),
    from_model_id uuid REFERENCES models(id) ON DELETE SET NULL,
    to_model_id uuid NOT NULL REFERENCES models(id),
    request_id text DEFAULT ''::text NOT NULL,
    load_session boolean DEFAULT true NOT NULL,
    success boolean,
    message text DEFAULT ''::text NOT NULL,
    session_id text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task_model_switches_task_id_created_at ON task_model_switches USING btree (task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_model_switches_user_id_created_at ON task_model_switches USING btree (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notify_channels (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v1() NOT NULL,
    owner_id uuid NOT NULL,
    owner_type character varying(16) DEFAULT 'user'::character varying NOT NULL,
    name character varying(64) NOT NULL,
    kind character varying(32) NOT NULL,
    webhook_url text NOT NULL,
    secret text DEFAULT ''::text NOT NULL,
    headers jsonb,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);

CREATE INDEX IF NOT EXISTS idx_notify_channels_created_at ON notify_channels USING btree (created_at);
CREATE INDEX IF NOT EXISTS idx_notify_channels_owner ON notify_channels USING btree (owner_id, owner_type);

CREATE TABLE IF NOT EXISTS notify_subscriptions (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v1() NOT NULL,
    channel_id uuid NOT NULL REFERENCES notify_channels(id),
    scope character varying(128) DEFAULT 'self'::character varying NOT NULL,
    event_types jsonb DEFAULT '[]'::jsonb NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);

CREATE INDEX IF NOT EXISTS idx_notify_subscriptions_channel_id ON notify_subscriptions USING btree (channel_id);

CREATE TABLE IF NOT EXISTS notify_send_logs (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v1() NOT NULL,
    subscription_id uuid NOT NULL,
    channel_id uuid NOT NULL,
    event_type character varying(64) NOT NULL,
    event_ref_id character varying(128) NOT NULL,
    status character varying(16) NOT NULL,
    error text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notify_send_logs_dedup ON notify_send_logs USING btree (subscription_id, event_type, event_ref_id);
CREATE INDEX IF NOT EXISTS idx_notify_send_logs_status ON notify_send_logs USING btree (status, created_at);
