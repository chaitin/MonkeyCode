CREATE TABLE resource_imports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    publisher text NOT NULL CHECK (publisher = btrim(publisher) AND char_length(publisher) BETWEEN 1 AND 128),
    release_id uuid NOT NULL,
    version bigint NOT NULL CHECK (version > 0),
    manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^sha256:[0-9a-f]{64}$'),
    actor_user_id uuid NOT NULL REFERENCES users(id),
    status text NOT NULL CHECK (status IN ('succeeded', 'failed')),
    result_counts jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(result_counts) = 'object'),
    failure_code text,
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((status = 'succeeded') = (failure_code IS NULL))
);

CREATE UNIQUE INDEX resource_imports_publisher_version_succeeded_key
    ON resource_imports (publisher, version) WHERE status = 'succeeded';
CREATE UNIQUE INDEX resource_imports_publisher_release_succeeded_key
    ON resource_imports (publisher, release_id) WHERE status = 'succeeded';
CREATE INDEX resource_imports_publisher_created_at_idx
    ON resource_imports (publisher, created_at DESC);

CREATE TABLE resource_import_bindings (
    publisher text NOT NULL CHECK (publisher = btrim(publisher) AND char_length(publisher) BETWEEN 1 AND 128),
    slug text NOT NULL CHECK (slug = btrim(slug) AND char_length(slug) BETWEEN 1 AND 128),
    resource_type text NOT NULL CHECK (resource_type IN ('skill', 'rule', 'connector', 'expert')),
    resource_id uuid NOT NULL,
    source_sha256 text NOT NULL CHECK (source_sha256 ~ '^sha256:[0-9a-f]{64}$'),
    applied_sha256 text NOT NULL CHECK (applied_sha256 ~ '^sha256:[0-9a-f]{64}$'),
    last_import_id uuid NOT NULL REFERENCES resource_imports(id),
    retired_at timestamptz,
    retired_import_id uuid REFERENCES resource_imports(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((retired_at IS NULL) = (retired_import_id IS NULL)),
    PRIMARY KEY (publisher, slug),
    UNIQUE (resource_type, resource_id)
);

ALTER TABLE skills
    ADD COLUMN name_i18n jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(name_i18n) = 'object'),
    ADD COLUMN description_i18n jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(description_i18n) = 'object');
ALTER TABLE rules
    ADD COLUMN enabled boolean NOT NULL DEFAULT true,
    ADD COLUMN name_i18n jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(name_i18n) = 'object'),
    ADD COLUMN description_i18n jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(description_i18n) = 'object');
ALTER TABLE connectors
    ADD COLUMN timeout_ms integer NOT NULL DEFAULT 25000 CHECK (timeout_ms BETWEEN 1000 AND 120000),
    ADD COLUMN auth_header_name text NOT NULL DEFAULT '',
    ADD COLUMN name_i18n jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(name_i18n) = 'object'),
    ADD COLUMN description_i18n jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(description_i18n) = 'object');
ALTER TABLE experts
    ADD COLUMN avatar_s3_key text NOT NULL DEFAULT '',
    ADD COLUMN name_i18n jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(name_i18n) = 'object'),
    ADD COLUMN description_i18n jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(description_i18n) = 'object');
