ALTER TABLE billing_transactions
    DROP CONSTRAINT billing_transactions_category_check,
    ADD CONSTRAINT billing_transactions_category_check CHECK (category IN ('model', 'tool', 'image', 'video'));

ALTER TABLE credit_ledger_entries
    DROP CONSTRAINT credit_ledger_entries_category_check,
    ADD CONSTRAINT credit_ledger_entries_category_check CHECK (category IN ('model', 'tool', 'image', 'video', 'other'));

CREATE TABLE video_inputs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id),
    object_key text NOT NULL,
    mime_type text NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg')),
    width integer NOT NULL CHECK (width > 0),
    height integer NOT NULL CHECK (height > 0),
    byte_size bigint NOT NULL CHECK (byte_size > 0),
    sha256 text NOT NULL,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE video_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id),
    model_id uuid NOT NULL REFERENCES models(id),
    session_id uuid REFERENCES sessions(id),
    provider text NOT NULL,
    mode text NOT NULL,
    status text NOT NULL CHECK (status IN ('created', 'reserved', 'submitted', 'running', 'succeeded', 'failed', 'unknown')),
    request_hash text NOT NULL,
    idempotency_key text,
    request_config jsonb NOT NULL,
    pricing_snapshot jsonb NOT NULL,
    provider_job_id text,
    billing_transaction_id uuid REFERENCES billing_transactions(id),
    error_code text,
    output_duration_ms bigint CHECK (output_duration_ms IS NULL OR output_duration_ms >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    poll_after timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz
);

CREATE UNIQUE INDEX video_jobs_idempotency_key_idx ON video_jobs(user_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;
CREATE INDEX video_jobs_pending_idx ON video_jobs(status, updated_at)
    WHERE status IN ('created', 'reserved', 'submitted', 'running', 'unknown');

CREATE TABLE video_job_inputs (
    job_id uuid NOT NULL REFERENCES video_jobs(id),
    input_id uuid NOT NULL REFERENCES video_inputs(id),
    ordinal integer NOT NULL CHECK (ordinal >= 0),
    role text NOT NULL,
    PRIMARY KEY (job_id, ordinal)
);

CREATE TABLE video_outputs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id uuid NOT NULL UNIQUE REFERENCES video_jobs(id),
    object_key text NOT NULL,
    mime_type text NOT NULL CHECK (mime_type IN ('video/mp4', 'video/webm')),
    width integer NOT NULL CHECK (width > 0),
    height integer NOT NULL CHECK (height > 0),
    duration_ms bigint NOT NULL CHECK (duration_ms > 0),
    byte_size bigint NOT NULL CHECK (byte_size > 0),
    sha256 text NOT NULL,
    expires_at timestamptz NOT NULL,
    purged_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE video_calls (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id uuid NOT NULL UNIQUE REFERENCES video_jobs(id),
    billing_transaction_id uuid UNIQUE REFERENCES billing_transactions(id),
    user_id uuid NOT NULL REFERENCES users(id),
    model_id uuid NOT NULL REFERENCES models(id),
    session_id uuid REFERENCES sessions(id),
    status text NOT NULL,
    output_duration_ms bigint NOT NULL DEFAULT 0 CHECK (output_duration_ms >= 0),
    created_at timestamptz NOT NULL DEFAULT now()
);
