ALTER TABLE models
    ADD COLUMN IF NOT EXISTS thinking_enabled boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS context_limit integer NOT NULL DEFAULT 200000,
    ADD COLUMN IF NOT EXISTS output_limit integer NOT NULL DEFAULT 32000;

CREATE TABLE IF NOT EXISTS task_model_switches (
    id uuid PRIMARY KEY,
    task_id uuid NOT NULL REFERENCES tasks(id),
    user_id uuid NOT NULL REFERENCES users(id),
    from_model_id uuid REFERENCES models(id) ON DELETE SET NULL,
    to_model_id uuid NOT NULL REFERENCES models(id),
    request_id text NOT NULL DEFAULT '',
    load_session boolean NOT NULL DEFAULT true,
    success boolean,
    message text NOT NULL DEFAULT '',
    session_id text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_model_switches_task_id_created_at
    ON task_model_switches(task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_model_switches_user_id_created_at
    ON task_model_switches(user_id, created_at DESC);
