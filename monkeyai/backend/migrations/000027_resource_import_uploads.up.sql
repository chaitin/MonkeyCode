CREATE TABLE resource_import_uploads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id uuid NOT NULL REFERENCES users(id),
    files jsonb NOT NULL CHECK (jsonb_typeof(files) = 'array'),
    total_size bigint NOT NULL CHECK (total_size BETWEEN 1 AND 2147483648),
    status text NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'ready', 'imported', 'cancelled')),
    package_sha256 text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
    CHECK ((status IN ('ready', 'imported')) = (package_sha256 ~ '^sha256:[0-9a-f]{64}$'))
);

CREATE INDEX resource_import_uploads_actor_created_idx ON resource_import_uploads (actor_user_id, created_at DESC);
CREATE INDEX resource_import_uploads_expires_idx ON resource_import_uploads (expires_at);

CREATE TABLE resource_import_chunks (
    upload_id uuid NOT NULL REFERENCES resource_import_uploads(id) ON DELETE CASCADE,
    index integer NOT NULL CHECK (index BETWEEN 0 AND 31),
    size bigint NOT NULL CHECK (size BETWEEN 1 AND 67108864),
    sha256 text NOT NULL CHECK (sha256 ~ '^sha256:[0-9a-f]{64}$'),
    PRIMARY KEY (upload_id, index)
);
