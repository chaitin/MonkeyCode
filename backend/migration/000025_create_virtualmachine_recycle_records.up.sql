CREATE TABLE IF NOT EXISTS virtualmachine_recycle_records (
    id uuid PRIMARY KEY,
    virtualmachine_id varchar NOT NULL UNIQUE,
    environment_id varchar NOT NULL DEFAULT '',
    host_id varchar NOT NULL DEFAULT '',
    user_id uuid,
    task_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
    method varchar NOT NULL,
    remote_deleted boolean NOT NULL DEFAULT false,
    recycled_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_virtualmachine_recycle_records_method_recycled_at
    ON virtualmachine_recycle_records (method, recycled_at);

CREATE INDEX IF NOT EXISTS idx_virtualmachine_recycle_records_user_recycled_at
    ON virtualmachine_recycle_records (user_id, recycled_at);
