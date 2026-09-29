CREATE TABLE feedbacks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users (id),
    category text NOT NULL CHECK (category IN ('bug', 'feature', 'experience', 'other')),
    content text NOT NULL DEFAULT '' CHECK (char_length(content) <= 5000),
    rating integer CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
    platform text NOT NULL CHECK (platform IN ('desktop', 'mobile', 'web', 'other')),
    client_version text NOT NULL DEFAULT '' CHECK (char_length(client_version) <= 64),
    state text NOT NULL DEFAULT 'uploading' CHECK (state IN ('uploading', 'new', 'resolved', 'ignored', 'failed')),
    request_id text NOT NULL DEFAULT '',
    idempotency_key text NOT NULL DEFAULT '',
    request_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE feedback_attachments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    feedback_id uuid NOT NULL REFERENCES feedbacks (id) ON DELETE CASCADE,
    object_key text NOT NULL,
    mime_type text NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
    byte_size bigint NOT NULL CHECK (byte_size > 0 AND byte_size <= 5242880),
    width integer NOT NULL CHECK (width > 0),
    height integer NOT NULL CHECK (height > 0),
    sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'ready', 'failed')),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX feedbacks_user_idempotency_key_uidx
    ON feedbacks (user_id, idempotency_key)
    WHERE idempotency_key <> '';
CREATE INDEX feedbacks_user_created_at_idx
    ON feedbacks (user_id, created_at DESC);
CREATE INDEX feedbacks_created_at_idx
    ON feedbacks (created_at DESC);
CREATE INDEX feedback_attachments_state_created_at_idx
    ON feedback_attachments (state, created_at);
