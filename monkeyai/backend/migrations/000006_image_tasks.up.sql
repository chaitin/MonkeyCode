ALTER TABLE billing_transactions DROP CONSTRAINT billing_transactions_category_check;
ALTER TABLE billing_transactions ADD CONSTRAINT billing_transactions_category_check CHECK (category IN ('model', 'tool', 'image'));
ALTER TABLE credit_ledger_entries DROP CONSTRAINT credit_ledger_entries_category_check;
ALTER TABLE credit_ledger_entries ADD CONSTRAINT credit_ledger_entries_category_check CHECK (category IN ('model', 'tool', 'image', 'other'));

CREATE TABLE image_calls (
    id uuid PRIMARY KEY REFERENCES billing_transactions(id),
    user_id uuid NOT NULL REFERENCES users(id),
    model_id uuid NOT NULL REFERENCES models(id),
    request_id text,
    status text NOT NULL CHECK (status IN ('succeeded', 'failed', 'cancelled')),
    generated_images bigint NOT NULL DEFAULT 0 CHECK (generated_images >= 0),
    error_code text,
    started_at timestamptz NOT NULL,
    completed_at timestamptz
);
CREATE INDEX image_calls_user_started_idx ON image_calls(user_id, started_at DESC);

CREATE TABLE image_inputs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id),
    object_key text NOT NULL UNIQUE,
    mime_type text NOT NULL,
    width integer NOT NULL CHECK (width > 0),
    height integer NOT NULL CHECK (height > 0),
    byte_size bigint NOT NULL CHECK (byte_size > 0),
    sha256 text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);
CREATE INDEX image_inputs_user_expires_idx ON image_inputs(user_id, expires_at);
CREATE INDEX image_inputs_expiration_idx ON image_inputs(expires_at);

CREATE TABLE image_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id),
    model_id uuid NOT NULL REFERENCES models(id),
    billing_transaction_id uuid UNIQUE REFERENCES billing_transactions(id),
    provider text NOT NULL,
    operation text NOT NULL CHECK (operation IN ('generate', 'edit')),
    provider_job_id text,
    provider_request_id text,
    status text NOT NULL CHECK (status IN ('created', 'reserved', 'submitted', 'running', 'succeeded', 'failed', 'unknown')),
    request_hash text NOT NULL,
    idempotency_key text,
    requested_images integer NOT NULL CHECK (requested_images > 0),
    generated_images integer NOT NULL DEFAULT 0 CHECK (generated_images >= 0),
    quality text NOT NULL,
    aspect_ratio text NOT NULL,
    request_config jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(request_config) = 'object'),
    pricing_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(pricing_snapshot) = 'object'),
    usage jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(usage) = 'object'),
    error_code text,
    created_at timestamptz NOT NULL DEFAULT now(),
    submitted_at timestamptz,
    completed_at timestamptz
);
CREATE UNIQUE INDEX image_jobs_idempotency_idx ON image_jobs(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX image_jobs_pending_idx ON image_jobs(status, created_at) WHERE status IN ('created', 'reserved', 'submitted', 'running', 'unknown');

CREATE TABLE image_job_inputs (
    job_id uuid NOT NULL REFERENCES image_jobs(id),
    input_id uuid NOT NULL REFERENCES image_inputs(id),
    PRIMARY KEY (job_id, input_id)
);

CREATE TABLE image_outputs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id uuid NOT NULL REFERENCES image_jobs(id),
    ordinal integer NOT NULL CHECK (ordinal >= 0),
    object_key text NOT NULL UNIQUE,
    UNIQUE (job_id, ordinal),
    mime_type text NOT NULL,
    width integer NOT NULL CHECK (width > 0),
    height integer NOT NULL CHECK (height > 0),
    byte_size bigint NOT NULL CHECK (byte_size > 0),
    sha256 text NOT NULL,
    seed bigint,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    purged_at timestamptz
);
CREATE INDEX image_outputs_expiration_idx ON image_outputs(expires_at) WHERE purged_at IS NULL;
