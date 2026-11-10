BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE resource_access_grants
    DROP CONSTRAINT IF EXISTS resource_access_grants_resource_type_check;
ALTER TABLE resource_access_grants
    ADD CONSTRAINT resource_access_grants_resource_type_check CHECK (
        resource_type IN ('model', 'skill', 'rule', 'connector', 'expert', 'kb')
    );

ALTER TABLE resource_tags
    DROP CONSTRAINT IF EXISTS resource_tags_resource_type_check;
ALTER TABLE resource_tags
    ADD CONSTRAINT resource_tags_resource_type_check CHECK (
        resource_type IN ('model', 'skill', 'rule', 'connector', 'expert', 'kb')
    );

CREATE TABLE kb (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    description text NOT NULL DEFAULT '',
    ownership_type text NOT NULL DEFAULT 'system',
    owner_user_id uuid NOT NULL,
    created_by_user_id uuid NOT NULL,
    enabled boolean NOT NULL DEFAULT TRUE,
    revision integer NOT NULL DEFAULT 1,
    embedding_model_id uuid,
    embedding_dimension integer,
    fusion_config jsonb NOT NULL DEFAULT
        '{"type": "weighted_rrf", "k": 60, "weights": {"lexical": 0.3, "vector": 0.7}}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT kb_ownership_type_check CHECK (ownership_type IN ('system', 'user')),
    CONSTRAINT kb_revision_check CHECK (revision > 0),
    CONSTRAINT kb_embedding_dimension_check CHECK (embedding_dimension IS NULL OR embedding_dimension > 0),
    CONSTRAINT kb_fusion_config_check CHECK (
        jsonb_typeof(fusion_config) = 'object'
        AND fusion_config ->> 'type' = 'weighted_rrf'
    )
);

CREATE INDEX kb_ownership_name_idx
    ON kb (ownership_type, lower(name), id);

CREATE INDEX kb_owner_user_idx
    ON kb (owner_user_id, id);

CREATE INDEX kb_embedding_model_idx
    ON kb (embedding_model_id)
    WHERE embedding_model_id IS NOT NULL;

CREATE TABLE kb_documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kb_id uuid NOT NULL,
    title text NOT NULL,
    source_type text NOT NULL DEFAULT 'text',
    content text NOT NULL DEFAULT '',
    file_name text,
    mime_type text,
    size_bytes bigint NOT NULL DEFAULT 0,
    storage_key text,
    content_sha256 text,
    status text NOT NULL DEFAULT 'pending',
    error_message text,
    chunk_count integer NOT NULL DEFAULT 0,
    revision integer NOT NULL DEFAULT 1,
    created_by_user_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    learned_at timestamptz,
    CONSTRAINT kb_documents_source_type_check CHECK (source_type IN ('text', 'file')),
    CONSTRAINT kb_documents_status_check CHECK (status IN ('pending', 'learning', 'learned', 'failed')),
    CONSTRAINT kb_documents_size_bytes_check CHECK (size_bytes >= 0),
    CONSTRAINT kb_documents_chunk_count_check CHECK (chunk_count >= 0),
    CONSTRAINT kb_documents_revision_check CHECK (revision > 0)
);

CREATE INDEX kb_documents_kb_idx
    ON kb_documents (kb_id, created_at DESC, id);

CREATE INDEX kb_documents_status_idx
    ON kb_documents (status, updated_at);

CREATE TABLE kb_chunks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kb_id uuid NOT NULL,
    document_id uuid NOT NULL,
    chunk_index integer NOT NULL,
    content text NOT NULL,
    token_count integer,
    embedding vector,
    metadata jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    embedding_model_id uuid,
    search_tokens text NOT NULL DEFAULT '',
    search_tsv tsvector,
    heading_path text,
    page_no integer,
    source_url text,
    CONSTRAINT kb_chunks_chunk_index_check CHECK (chunk_index >= 0),
    CONSTRAINT kb_chunks_token_count_check CHECK (token_count IS NULL OR token_count >= 0),
    CONSTRAINT kb_chunks_metadata_check CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE UNIQUE INDEX kb_chunks_document_index_key
    ON kb_chunks (kb_id, document_id, chunk_index);

CREATE INDEX kb_chunks_kb_idx
    ON kb_chunks (kb_id, document_id, chunk_index);

CREATE INDEX kb_chunks_embedding_model_idx
    ON kb_chunks (embedding_model_id)
    WHERE embedding_model_id IS NOT NULL;

CREATE INDEX kb_chunks_search_tsv_idx
    ON kb_chunks USING gin (search_tsv);

CREATE TABLE kb_learning_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kb_id uuid NOT NULL,
    document_id uuid,
    operation text NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    attempts integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 3,
    available_at timestamptz NOT NULL DEFAULT now(),
    locked_at timestamptz,
    locked_by text,
    error_message text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    document_revision integer,
    embedding_model_id uuid,
    embedding_dimension integer,
    CONSTRAINT kb_learning_jobs_operation_check CHECK (operation IN (
        'learn', 'relearn', 'rebuild_parse', 'rebuild_lexical', 'rebuild_vector',
        'rebuild_model'
    )),
    CONSTRAINT kb_learning_jobs_status_check CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'canceled')),
    CONSTRAINT kb_learning_jobs_attempts_check CHECK (attempts >= 0 AND max_attempts > 0),
    CONSTRAINT kb_learning_jobs_document_revision_check CHECK (
        document_revision IS NULL OR document_revision > 0
    ),
    CONSTRAINT kb_learning_jobs_embedding_dimension_check CHECK (
        embedding_dimension IS NULL OR embedding_dimension > 0
    )
);

CREATE INDEX kb_learning_jobs_claim_idx
    ON kb_learning_jobs (status, available_at, created_at)
    WHERE status = 'pending';

CREATE INDEX kb_learning_jobs_kb_idx
    ON kb_learning_jobs (kb_id, created_at DESC);

CREATE INDEX kb_learning_jobs_document_active_idx
    ON kb_learning_jobs (document_id, created_at)
    WHERE document_id IS NOT NULL AND status IN ('pending', 'running');

CREATE INDEX kb_learning_jobs_embedding_model_idx
    ON kb_learning_jobs (embedding_model_id)
    WHERE embedding_model_id IS NOT NULL;

INSERT INTO migrations (name) VALUES ('000039_create_kb_tables')
ON CONFLICT (name) DO NOTHING;

COMMIT;
