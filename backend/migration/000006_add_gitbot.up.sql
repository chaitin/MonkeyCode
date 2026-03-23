-- git_bots: Git Bot
CREATE TABLE IF NOT EXISTS public.git_bots (
    id uuid PRIMARY KEY DEFAULT public.uuid_generate_v1() NOT NULL,
    user_id uuid NOT NULL,
    name character varying(64),
    host_id character varying(64) NOT NULL,
    token text NOT NULL,
    platform character varying(32) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at timestamp with time zone,
    secret_token text
);

CREATE INDEX IF NOT EXISTS idx_git_bots_host_id ON public.git_bots USING btree (host_id);
CREATE INDEX IF NOT EXISTS idx_git_bots_token ON public.git_bots USING btree (token);
CREATE INDEX IF NOT EXISTS idx_git_bots_user_id ON public.git_bots USING btree (user_id);


-- git_bot_users: Git Bot 共享用户关联表
CREATE TABLE IF NOT EXISTS public.git_bot_users (
    id uuid PRIMARY KEY DEFAULT public.uuid_generate_v1() NOT NULL,
    git_bot_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS unique_idx_git_bot_user ON public.git_bot_users USING btree (git_bot_id, user_id);

-- git_bot_tasks: Git Bot 任务关联表
CREATE TABLE IF NOT EXISTS public.git_bot_tasks (
    id uuid PRIMARY KEY DEFAULT public.uuid_generate_v1() NOT NULL,
    git_bot_id uuid NOT NULL,
    task_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS unique_idx_git_bot_tasks_id ON public.git_bot_tasks USING btree (git_bot_id, task_id);


-- project_git_bots: 项目 Git Bot 关联表
CREATE TABLE IF NOT EXISTS public.project_git_bots (
    id uuid PRIMARY KEY DEFAULT public.uuid_generate_v1() NOT NULL,
    project_id uuid NOT NULL,
    git_bot_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
