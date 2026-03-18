-- Task/Notify 相关表

-- tasks 任务表
CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY,
    deleted_at TIMESTAMPTZ,
    user_id UUID NOT NULL REFERENCES users(id),
    kind VARCHAR NOT NULL,
    sub_type VARCHAR,
    content TEXT NOT NULL,
    summary TEXT,
    status VARCHAR NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);

-- project_tasks 项目任务关联表
CREATE TABLE IF NOT EXISTS project_tasks (
    id UUID PRIMARY KEY,
    task_id UUID NOT NULL REFERENCES tasks(id),
    model_id UUID NOT NULL REFERENCES models(id),
    image_id UUID NOT NULL REFERENCES images(id),
    git_identity_id UUID,
    project_id UUID,
    issue_id UUID,
    repo_url VARCHAR,
    repo_filename VARCHAR,
    branch VARCHAR,
    cli_name VARCHAR,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- task_virtualmachines 任务-虚拟机关联表
CREATE TABLE IF NOT EXISTS task_virtualmachines (
    id UUID PRIMARY KEY,
    task_id UUID NOT NULL REFERENCES tasks(id),
    virtualmachine_id VARCHAR NOT NULL REFERENCES virtualmachines(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- notify_channels 通知渠道表
CREATE TABLE IF NOT EXISTS notify_channels (
    id UUID PRIMARY KEY,
    deleted_at TIMESTAMPTZ,
    owner_id UUID NOT NULL,
    owner_type VARCHAR NOT NULL DEFAULT 'user',
    name VARCHAR(64) NOT NULL,
    kind VARCHAR NOT NULL,
    webhook_url TEXT NOT NULL,
    secret TEXT DEFAULT '',
    headers JSONB,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notify_channels_owner ON notify_channels(owner_id, owner_type);

-- notify_subscriptions 通知订阅表
CREATE TABLE IF NOT EXISTS notify_subscriptions (
    id UUID PRIMARY KEY,
    deleted_at TIMESTAMPTZ,
    channel_id UUID NOT NULL REFERENCES notify_channels(id),
    scope VARCHAR NOT NULL DEFAULT 'self',
    event_types JSONB NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notify_subscriptions_channel ON notify_subscriptions(channel_id);

-- notify_send_logs 通知发送日志表
CREATE TABLE IF NOT EXISTS notify_send_logs (
    id UUID PRIMARY KEY,
    subscription_id UUID NOT NULL,
    channel_id UUID NOT NULL,
    event_type VARCHAR NOT NULL,
    event_ref_id VARCHAR NOT NULL,
    status VARCHAR NOT NULL,
    error TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notify_send_logs_dedup ON notify_send_logs(subscription_id, event_type, event_ref_id);
CREATE INDEX IF NOT EXISTS idx_notify_send_logs_status ON notify_send_logs(status, created_at);
