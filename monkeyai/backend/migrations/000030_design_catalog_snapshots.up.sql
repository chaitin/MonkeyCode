CREATE TABLE design_snapshots (
    id uuid PRIMARY KEY,
    publisher_id text NOT NULL,
    source_release_id text NOT NULL,
    schema_version integer NOT NULL CHECK (schema_version = 1),
    digest_schema text NOT NULL CHECK (digest_schema = 'design-content-v1'),
    snapshot_digest text NOT NULL,
    taxonomy jsonb NOT NULL,
    actor_user_id uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (publisher_id, source_release_id)
);
CREATE TABLE design_entries (
    id uuid PRIMARY KEY,
    snapshot_id uuid NOT NULL REFERENCES design_snapshots(id) ON DELETE CASCADE,
    resource_type text NOT NULL CHECK (resource_type IN ('template','design-system','style','direction')),
    catalog_id text NOT NULL,
    content_digest text NOT NULL,
    data jsonb NOT NULL,
    UNIQUE (snapshot_id, resource_type, catalog_id)
);
CREATE TABLE design_files (
    entry_id uuid NOT NULL REFERENCES design_entries(id) ON DELETE CASCADE,
    path text NOT NULL,
    sha256 text NOT NULL,
    size bigint NOT NULL CHECK (size >= 0),
    mime text NOT NULL,
    role text,
    object_key text NOT NULL,
    PRIMARY KEY (entry_id,path)
);
CREATE TABLE design_current (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    publisher_id text,
    snapshot_id uuid REFERENCES design_snapshots(id),
    revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
    CHECK ((snapshot_id IS NULL AND publisher_id IS NULL) OR (snapshot_id IS NOT NULL AND publisher_id IS NOT NULL))
);
INSERT INTO design_current (singleton) VALUES (true);
ALTER TABLE resource_imports ADD COLUMN upload_id uuid REFERENCES resource_import_uploads(id);
ALTER TABLE resource_import_uploads ADD COLUMN cleaned_at timestamptz;

CREATE TABLE resource_import_sections (
    upload_id uuid NOT NULL REFERENCES resource_import_uploads(id),
    section text NOT NULL CHECK (section IN ('agent','design')),
    status text NOT NULL CHECK (status IN ('succeeded','failed')),
    plan_digest text NOT NULL,
    result jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (upload_id, section)
);

CREATE VIEW resource_import_history AS
SELECT i.id,i.created_at,to_jsonb(i) AS data FROM resource_imports i WHERE i.upload_id IS NULL
UNION ALL
SELECT u.id,max(s.updated_at) AS created_at,
       jsonb_build_object(
         'id',u.id,'actor_user_id',u.actor_user_id,
         'publisher',coalesce(max(s.result->'result'->>'publisher'),max(s.result->'result'->>'publisher_id'),''),
         'release_id',coalesce(max(s.result->'result'->>'release_id') FILTER (WHERE s.section='design'),max(s.result->'result'->>'release_id'),''),
         'version',coalesce(max((s.result->'result'->>'version')::bigint),0),
         'status',CASE WHEN bool_and(s.status='succeeded') THEN 'succeeded' WHEN bool_or(s.status='succeeded') THEN 'partial' ELSE 'failed' END,
         'result_counts',coalesce((SELECT i.result_counts FROM resource_imports i WHERE i.upload_id=u.id ORDER BY i.created_at DESC LIMIT 1),'{}'::jsonb),
         'section_results',jsonb_object_agg(s.section,s.result),
         'created_at',max(s.updated_at)) AS data
FROM resource_import_uploads u JOIN resource_import_sections s ON s.upload_id=u.id
GROUP BY u.id,u.actor_user_id;
