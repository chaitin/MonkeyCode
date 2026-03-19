-- git_bots: Git Bot
CREATE TABLE IF NOT EXISTS git_bots (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    name VARCHAR(255),
    host_id VARCHAR(255) NOT NULL,
    token TEXT,
    secret_token VARCHAR(255),
    platform VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_git_bots_user_id ON git_bots(user_id);
CREATE INDEX IF NOT EXISTS idx_git_bots_host_id ON git_bots(host_id);
CREATE INDEX IF NOT EXISTS idx_git_bots_platform ON git_bots(platform);

-- git_bot_users: Git Bot 共享用户关联表
CREATE TABLE IF NOT EXISTS git_bot_users (
    id UUID PRIMARY KEY,
    git_bot_id UUID NOT NULL REFERENCES git_bots(id),
    user_id UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_git_bot_users_git_bot_id ON git_bot_users(git_bot_id);
CREATE INDEX IF NOT EXISTS idx_git_bot_users_user_id ON git_bot_users(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_git_bot_users_unique ON git_bot_users(git_bot_id, user_id) WHERE deleted_at IS NULL;

-- git_bot_tasks: Git Bot 任务关联表
CREATE TABLE IF NOT EXISTS git_bot_tasks (
    id UUID PRIMARY KEY,
    git_bot_id UUID NOT NULL REFERENCES git_bots(id),
    task_id UUID NOT NULL REFERENCES tasks(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_git_bot_tasks_git_bot_id ON git_bot_tasks(git_bot_id);
CREATE INDEX IF NOT EXISTS idx_git_bot_tasks_task_id ON git_bot_tasks(task_id);

-- project_git_bots: 项目 Git Bot 关联表
CREATE TABLE IF NOT EXISTS project_git_bots (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id),
    git_bot_id UUID NOT NULL REFERENCES git_bots(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_project_git_bots_project_id ON project_git_bots(project_id);
CREATE INDEX IF NOT EXISTS idx_project_git_bots_git_bot_id ON project_git_bots(git_bot_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_git_bots_unique ON project_git_bots(project_id, git_bot_id) WHERE deleted_at IS NULL;
