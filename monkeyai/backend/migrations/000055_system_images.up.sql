BEGIN;
CREATE TABLE images (
 id uuid PRIMARY KEY,
 display_name text NOT NULL CHECK (display_name=btrim(display_name) AND length(display_name) BETWEEN 1 AND 128),
 source_type text NOT NULL CHECK(source_type IN ('builtin','pull','upload')),
 upstream text, archive_name text, staging_key text, content_source text,
 status text NOT NULL CHECK(status IN ('pending','importing','ready','failed')),
 progress_stage text NOT NULL, completed_bytes bigint NOT NULL DEFAULT 0 CHECK(completed_bytes>=0),
 total_bytes bigint CHECK(total_bytes>=completed_bytes), error_code text, error_message text,
 created_by uuid, request_key text, request_hash text,
 added_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
 CHECK ((source_type='pull')=(upstream IS NOT NULL)), CHECK ((source_type='upload')=(archive_name IS NOT NULL)),
 CHECK (status<>'ready' OR content_source IS NOT NULL)
);
CREATE UNIQUE INDEX images_active_upstream ON images(upstream) WHERE deleted_at IS NULL AND status<>'failed' AND upstream IS NOT NULL;
CREATE UNIQUE INDEX images_active_source ON images(content_source) WHERE deleted_at IS NULL AND status<>'failed' AND content_source IS NOT NULL;
CREATE UNIQUE INDEX images_requests ON images(created_by,request_key) WHERE request_key IS NOT NULL;
CREATE INDEX images_recent ON images(added_at DESC,id DESC) WHERE deleted_at IS NULL;
CREATE INDEX images_pending ON images(added_at,id) WHERE deleted_at IS NULL AND status IN ('pending','importing');
ALTER TABLE environments ADD COLUMN image_id uuid REFERENCES images(id);
COMMIT;
