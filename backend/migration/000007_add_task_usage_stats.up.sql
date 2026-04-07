CREATE TABLE IF NOT EXISTS task_usage_stats (
    id UUID PRIMARY KEY,
    task_id UUID NOT NULL,
    user_id UUID NOT NULL,
    model VARCHAR(255) NOT NULL DEFAULT '',
    input_tokens BIGINT NOT NULL DEFAULT 0,
    output_tokens BIGINT NOT NULL DEFAULT 0,
    total_tokens BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_task_usage_stats_task_id ON task_usage_stats (task_id);
CREATE INDEX idx_task_usage_stats_user_id ON task_usage_stats (user_id);
