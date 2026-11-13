-- name: GetKbResource :one
SELECT to_jsonb(t)
FROM knowledge_bases t
WHERE id = $1;

-- name: LockKbResource :one
SELECT to_jsonb(t)
FROM knowledge_bases t
WHERE id = $1
FOR UPDATE;

-- name: ListKbResources :many
SELECT to_jsonb(t)
FROM knowledge_bases t
ORDER BY lower(name), id;

-- name: PageKbResources :many
SELECT to_jsonb(t)
FROM knowledge_bases t
WHERE ($1::jsonb ->> 'ownership' = '' OR t.ownership_type = $1::jsonb ->> 'ownership')
    AND (strpos(lower(name), lower($1::jsonb ->> 'search')) > 0
        OR strpos(lower(description), lower($1::jsonb ->> 'search')) > 0)
    AND ($1::jsonb ->> 'cursor' = '' OR (lower(t.name), t.id) > (
        SELECT lower(cursor_kb.name), cursor_kb.id FROM knowledge_bases cursor_kb
        WHERE cursor_kb.id::text = $1::jsonb ->> 'cursor'
    ))
ORDER BY lower(name), id
LIMIT ($1::jsonb ->> 'limit')::integer;

-- name: CreateKbResource :exec
INSERT INTO knowledge_bases (
    name, description, id, owner_user_id, created_by_user_id, ownership_type,
    enabled, embedding_model_id, embedding_dimension, fusion_config
)
VALUES (
    ($1::jsonb ->> 'name')::text,
    ($1::jsonb ->> 'description')::text,
    ($1::jsonb ->> 'id')::uuid,
    ($1::jsonb ->> 'actor_id')::uuid,
    ($1::jsonb ->> 'actor_id')::uuid,
    COALESCE($1::jsonb ->> 'ownership_type', 'system'),
    CASE WHEN $1::jsonb ? 'enabled' THEN ($1::jsonb ->> 'enabled')::boolean ELSE TRUE END,
    CASE WHEN $1::jsonb ? 'embedding_model_id' AND NULLIF($1::jsonb ->> 'embedding_model_id', '') IS NOT NULL
        THEN ($1::jsonb ->> 'embedding_model_id')::uuid ELSE NULL END,
    CASE WHEN $1::jsonb ? 'embedding_dimension' AND NULLIF($1::jsonb ->> 'embedding_dimension', '') IS NOT NULL
        THEN ($1::jsonb ->> 'embedding_dimension')::integer ELSE NULL END,
    COALESCE($1::jsonb -> 'fusion_config', '{"type": "weighted_rrf", "k": 60, "weights": {"lexical": 0.3, "vector": 0.7}}'::jsonb)
);

-- name: UpdateKbResource :exec
UPDATE knowledge_bases
SET name = CASE WHEN $1::jsonb ? 'name' THEN ($1::jsonb ->> 'name')::text ELSE name END,
    description = CASE WHEN $1::jsonb ? 'description' THEN ($1::jsonb ->> 'description')::text ELSE description END,
    enabled = CASE WHEN $1::jsonb ? 'enabled' THEN ($1::jsonb ->> 'enabled')::boolean ELSE enabled END,
    embedding_model_id = CASE WHEN $1::jsonb ? 'embedding_model_id'
        THEN NULLIF($1::jsonb ->> 'embedding_model_id', '')::uuid ELSE embedding_model_id END,
    embedding_dimension = CASE WHEN $1::jsonb ? 'embedding_dimension'
        THEN NULLIF($1::jsonb ->> 'embedding_dimension', '')::integer ELSE embedding_dimension END,
    fusion_config = CASE WHEN $1::jsonb ? 'fusion_config'
        THEN ($1::jsonb -> 'fusion_config') ELSE fusion_config END,
    revision = revision + 1,
    updated_at = now()
WHERE id = ($1::jsonb ->> 'id')::uuid;

-- name: DeleteKbResource :exec
DELETE FROM knowledge_bases
WHERE id = $1;

-- name: TouchKbResource :exec
UPDATE knowledge_bases
SET revision = revision + 1,
    updated_at = now()
WHERE id = $1;

-- name: SetKbResourceEnabled :exec
UPDATE knowledge_bases
SET enabled = ($1::jsonb ->> 'enabled')::boolean,
    revision = revision + 1,
    updated_at = now()
WHERE id = ($1::jsonb ->> 'id')::uuid;

-- name: SetKbEmbeddingModel :exec
UPDATE knowledge_bases
SET embedding_model_id = NULLIF(sqlc.arg(embedding_model_id)::text, '')::uuid,
    embedding_dimension = sqlc.narg(embedding_dimension)::integer,
    revision = revision + 1,
    updated_at = now()
WHERE knowledge_bases.id = sqlc.arg(id);

-- name: CountKbDocuments :one
SELECT count(*) FILTER (WHERE node_type = 'document')::bigint AS total,
       count(*) FILTER (WHERE node_type = 'document' AND chunk_count > 0)::bigint AS learned
FROM knowledge_base_documents
WHERE kb_id = $1;

-- name: CountKbLearningJobs :many
SELECT operation, status, count(*)::bigint AS total
FROM knowledge_base_learning_jobs
WHERE kb_id = $1
GROUP BY operation, status;

-- name: ClaimKbLearningJob :one
WITH next_job AS (
    SELECT id
    FROM knowledge_base_learning_jobs
    WHERE (status = 'pending' AND available_at <= now())
        OR (status = 'running' AND locked_at < now() - interval '5 minutes')
    ORDER BY created_at, id
    FOR UPDATE SKIP LOCKED
    LIMIT 1
)
UPDATE knowledge_base_learning_jobs j
SET status = 'running',
    attempts = attempts + 1,
    locked_at = now(),
    locked_by = sqlc.arg(worker_id),
    updated_at = now()
FROM next_job
WHERE j.id = next_job.id
RETURNING j.id, j.kb_id, j.document_id, j.operation, j.attempts, j.max_attempts,
    j.document_revision, j.embedding_model_id, j.embedding_dimension;

-- name: GetKbLearningJobStatus :one
SELECT status
FROM knowledge_base_learning_jobs
WHERE id = sqlc.arg(id)
    AND attempts = sqlc.arg(attempts)
    AND locked_by = sqlc.arg(worker_id)
FOR UPDATE;

-- name: FinishKbLearningJob :exec
UPDATE knowledge_base_learning_jobs
SET status = 'succeeded',
    error_message = NULL,
    locked_at = NULL,
    locked_by = NULL,
    finished_at = now(),
    updated_at = now()
WHERE id = sqlc.arg(id)
    AND status = 'running'
    AND attempts = sqlc.arg(attempts)
    AND locked_by = sqlc.arg(worker_id);

-- name: FailKbLearningJob :exec
UPDATE knowledge_base_learning_jobs
SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
    available_at = CASE WHEN attempts >= max_attempts THEN available_at ELSE now() + interval '15 seconds' END,
    error_message = sqlc.narg(error_message),
    locked_at = NULL,
    locked_by = NULL,
    finished_at = CASE WHEN attempts >= max_attempts THEN now() ELSE NULL END,
    updated_at = now()
WHERE id = sqlc.arg(id)
    AND status = 'running'
    AND attempts = sqlc.arg(attempts)
    AND locked_by = sqlc.arg(worker_id);

-- name: GetDefaultEmbeddingModel :one
SELECT id::text AS id,
       COALESCE((embedding_config ->> 'dimension')::integer, 0)::bigint AS dimension
FROM models
WHERE kind = 'embedding'
    AND ownership_type = 'system'
    AND enabled
    AND deleted_at IS NULL
ORDER BY created_at DESC, id
LIMIT 1;

-- name: GetEmbeddingModel :one
SELECT COALESCE((embedding_config ->> 'dimension')::integer, 0)::bigint AS dimension
FROM models
WHERE id = $1
    AND kind = 'embedding'
    AND ownership_type = 'system'
    AND enabled
    AND deleted_at IS NULL;

-- name: SelectKbEmbeddingModel :one
SELECT id::text AS id,
       (embedding_config ->> 'dimension')::integer AS dimension
FROM models
WHERE kind = 'embedding'
    AND ownership_type = 'system'
    AND enabled
    AND deleted_at IS NULL
    AND (embedding_config ->> 'dimension')::integer > 0
ORDER BY (id::text = sqlc.arg(preferred_id)::text) DESC, created_at, id
LIMIT 1;

-- name: GetKbEmbedding :one
SELECT embedding_model_id, embedding_dimension
FROM knowledge_bases
WHERE id = $1
    AND enabled
FOR SHARE;

-- name: SetKbEmbedding :exec
UPDATE knowledge_bases
SET embedding_model_id = $2,
    embedding_dimension = $3,
    revision = revision + 1,
    updated_at = now()
WHERE id = $1;

-- name: DeleteKbChunksByKb :exec
DELETE FROM knowledge_base_chunks
WHERE kb_id = $1;

-- name: DeleteKbChunksByDocument :exec
DELETE FROM knowledge_base_chunks
WHERE document_id = $1;

-- name: ClearKbVectors :exec
UPDATE knowledge_base_chunks
SET embedding = NULL,
    embedding_model_id = NULL,
    metadata = metadata - 'vector_error',
    updated_at = now()
WHERE kb_id = $1;

-- name: ClearDocumentVectors :exec
UPDATE knowledge_base_chunks
SET embedding = NULL,
    embedding_model_id = NULL,
    metadata = metadata - 'vector_error',
    updated_at = now()
WHERE document_id = $1;

-- name: ListKbChunksForRebuild :many
SELECT c.id::text AS id, c.document_id::text AS document_id, c.content
FROM knowledge_base_chunks c
JOIN knowledge_base_documents d ON d.id = c.document_id
WHERE c.kb_id = $1
ORDER BY c.document_id, c.chunk_index;

-- name: UpdateKbChunkVector :exec
UPDATE knowledge_base_chunks
SET embedding = sqlc.narg(embedding)::text::vector,
    embedding_model_id = sqlc.narg(embedding_model_id)::uuid,
    metadata = sqlc.arg(metadata)::text::jsonb,
    updated_at = now()
WHERE id = sqlc.arg(id);

-- name: UpdateKbChunkLexical :exec
UPDATE knowledge_base_chunks
SET search_tokens = sqlc.arg(search_tokens),
    search_tsv = to_tsvector('simple', sqlc.arg(search_tokens)::text),
    updated_at = now()
WHERE id = sqlc.arg(id);

-- name: CreateKbLearningJob :exec
INSERT INTO knowledge_base_learning_jobs (
    kb_id, document_id, operation, document_revision,
    embedding_model_id, embedding_dimension
)
VALUES ($1, $2, $3, $4, $5, $6);

-- name: CancelKbLearningJobs :exec
UPDATE knowledge_base_learning_jobs
SET status = 'canceled', updated_at = now(), finished_at = now()
WHERE kb_id = $1
    AND status IN ('pending', 'running');

-- name: CancelKbLearningJobsByDocument :exec
UPDATE knowledge_base_learning_jobs
SET status = 'canceled', updated_at = now(), finished_at = now()
WHERE document_id = $1
    AND status IN ('pending', 'running');

-- name: SoftDeleteKbDocumentsByKb :exec
DELETE FROM knowledge_base_documents
WHERE kb_id = $1;

-- name: DeleteKbLearningJobsByKb :exec
DELETE FROM knowledge_base_learning_jobs
WHERE kb_id = $1;

-- name: GetKbDocument :one
SELECT to_jsonb(d)
FROM knowledge_base_documents d
WHERE d.id = $1;

-- name: LockKbDocument :one
SELECT to_jsonb(d)
FROM knowledge_base_documents d
WHERE d.id = $1
FOR UPDATE;

-- name: ListKbDocuments :many
SELECT to_jsonb(d)
FROM knowledge_base_documents d
WHERE d.kb_id = $1
ORDER BY d.position, d.created_at, d.id;

-- name: CountKbDocumentChildren :one
SELECT count(*)
FROM knowledge_base_documents
WHERE parent_id = $1;

-- name: NextKbDocumentPosition :one
SELECT (COALESCE(MAX(position), 0) + 1000)::float8
FROM knowledge_base_documents
WHERE kb_id = $1
  AND parent_id IS NOT DISTINCT FROM $2;

-- name: MoveKbDocument :exec
UPDATE knowledge_base_documents
SET parent_id = $2,
    position = $3,
    updated_at = now()
WHERE id = $1;

-- name: GetKbDocumentRevision :one
SELECT revision
FROM knowledge_base_documents
WHERE id = $1;

-- name: ListKbChunks :many
SELECT jsonb_build_object(
    'chunk_id', c.id,
    'document_id', c.document_id,
    'kb_id', c.kb_id,
    'chunk_index', c.chunk_index,
    'content', c.content,
    'token_count', c.token_count,
    'has_vector', c.embedding IS NOT NULL,
    'embedding_model_id', c.embedding_model_id,
    'heading_path', c.heading_path,
    'page_no', c.page_no,
    'source_url', c.source_url,
    'created_at', c.created_at,
    'updated_at', c.updated_at
)
FROM knowledge_base_chunks c
WHERE c.document_id = $1
ORDER BY c.chunk_index;

-- name: GetKbChunk :one
SELECT jsonb_build_object(
    'chunk_id', c.id,
    'document_id', c.document_id,
    'kb_id', c.kb_id,
    'chunk_index', c.chunk_index,
    'content', c.content,
    'title', d.title,
    'token_count', c.token_count,
    'has_vector', c.embedding IS NOT NULL,
    'heading_path', c.heading_path,
    'page_no', c.page_no,
    'source_url', c.source_url
)
FROM knowledge_base_chunks c
JOIN knowledge_base_documents d ON d.id = c.document_id
WHERE c.id = $1;

-- name: CreateKbDocument :exec
INSERT INTO knowledge_base_documents (
    id, kb_id, title, source_type, content, file_name, mime_type, size_bytes,
    status, created_by_user_id, parent_id, node_type, position
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13);

-- name: UpdateKbDocument :exec
UPDATE knowledge_base_documents
SET title = $2,
    source_type = $3,
    content = $4,
    file_name = COALESCE($5, file_name),
    mime_type = COALESCE($6, mime_type),
    size_bytes = $7,
    status = 'pending',
    error_message = NULL,
    chunk_count = 0,
    learned_at = NULL,
    revision = revision + 1,
    updated_at = now()
WHERE id = $1;

-- name: UpdateKbDocumentMetadata :exec
UPDATE knowledge_base_documents
SET title = $2,
    source_type = $3,
    file_name = COALESCE($4, file_name),
    mime_type = COALESCE($5, mime_type),
    size_bytes = $6,
    updated_at = now()
WHERE id = $1;

-- name: SoftDeleteKbDocument :execrows
DELETE FROM knowledge_base_documents
WHERE id = $1;

-- name: SetKbDocumentLearning :exec
UPDATE knowledge_base_documents
SET status = 'learning',
    error_message = NULL,
    updated_at = now()
WHERE id = $1;

-- name: SetKbDocumentPending :one
UPDATE knowledge_base_documents
SET status = 'pending',
    error_message = NULL,
    chunk_count = 0,
    learned_at = NULL,
    revision = revision + 1,
    updated_at = now()
WHERE id = $1
RETURNING revision;

-- name: SetKbDocumentVectorLearning :one
UPDATE knowledge_base_documents
SET status = 'learning',
    error_message = NULL,
    revision = revision + 1,
    updated_at = now()
WHERE id = $1
RETURNING revision;

-- name: SetKbDocumentLexicallyLearned :exec
UPDATE knowledge_base_documents
SET status = 'learned',
    error_message = NULL,
    learned_at = COALESCE(learned_at, now()),
    revision = revision + 1,
    updated_at = now()
WHERE id = $1;

-- name: FinishKbDocumentLearning :exec
UPDATE knowledge_base_documents
SET status = 'learned',
    error_message = NULL,
    chunk_count = $2,
    learned_at = now(),
    revision = revision + 1,
    updated_at = now()
WHERE id = $1;

-- name: FinishKbDocumentVectorLearning :exec
UPDATE knowledge_base_documents
SET status = 'learned',
    error_message = NULL,
    learned_at = COALESCE(learned_at, now()),
    revision = revision + 1,
    updated_at = now()
WHERE id = $1;

-- name: MarkKbDocumentFailed :exec
UPDATE knowledge_base_documents
SET status = 'failed',
    error_message = $2,
    chunk_count = 0,
    learned_at = NULL,
    updated_at = now()
WHERE id = $1;

-- name: MarkKbDocumentVectorFailed :exec
UPDATE knowledge_base_documents
SET status = 'failed',
    error_message = $2,
    chunk_count = $3,
    learned_at = COALESCE(learned_at, now()),
    revision = revision + 1,
    updated_at = now()
WHERE id = $1;

-- name: InsertKbChunk :exec
INSERT INTO knowledge_base_chunks (
    kb_id, document_id, chunk_index, content, token_count, search_tokens,
    search_tsv, embedding, embedding_model_id, metadata, heading_path, page_no,
    source_url
)
VALUES (
    sqlc.arg(kb_id), sqlc.arg(document_id), sqlc.arg(chunk_index), sqlc.arg(content),
    sqlc.narg(token_count)::integer, sqlc.arg(search_tokens),
    to_tsvector('simple', sqlc.arg(search_tokens)::text),
    sqlc.narg(embedding)::text::vector, sqlc.narg(embedding_model_id)::uuid,
    sqlc.arg(metadata)::text::jsonb, sqlc.narg(heading_path)::text,
    sqlc.narg(page_no)::integer, sqlc.narg(source_url)::text
)
ON CONFLICT (kb_id, document_id, chunk_index)
DO UPDATE SET content = EXCLUDED.content,
              token_count = EXCLUDED.token_count,
              search_tokens = EXCLUDED.search_tokens,
              search_tsv = EXCLUDED.search_tsv,
              embedding = EXCLUDED.embedding,
              embedding_model_id = EXCLUDED.embedding_model_id,
              metadata = EXCLUDED.metadata,
              heading_path = EXCLUDED.heading_path,
              page_no = EXCLUDED.page_no,
              source_url = EXCLUDED.source_url,
              updated_at = now();

-- name: SearchKbChunksLexical :many
SELECT jsonb_build_object(
    'kb_id', c.kb_id,
    'document_id', c.document_id,
    'chunk_id', c.id,
    'chunk_index', c.chunk_index,
    'content', c.content,
    'title', d.title,
    'heading_path', c.heading_path,
    'page_no', c.page_no,
    'source_url', c.source_url,
    'score', ts_rank_cd(c.search_tsv, to_tsquery('simple', sqlc.arg(query_expression)))
)
FROM knowledge_base_chunks c
JOIN knowledge_base_documents d ON d.id = c.document_id
WHERE c.kb_id = sqlc.arg(kb_id)
    AND c.search_tsv @@ to_tsquery('simple', sqlc.arg(query_expression))
ORDER BY ts_rank_cd(c.search_tsv, to_tsquery('simple', sqlc.arg(query_expression))) DESC,
         c.chunk_index,
         c.id
LIMIT sqlc.arg(row_limit)::integer;

-- name: SearchKbChunksVector :many
SELECT jsonb_build_object(
    'kb_id', c.kb_id,
    'document_id', c.document_id,
    'chunk_id', c.id,
    'chunk_index', c.chunk_index,
    'content', c.content,
    'title', d.title,
    'heading_path', c.heading_path,
    'page_no', c.page_no,
    'source_url', c.source_url,
    'score', 1 - (c.embedding <=> sqlc.arg(embedding)::text::vector)
)
FROM knowledge_base_chunks c
JOIN knowledge_base_documents d ON d.id = c.document_id
WHERE c.kb_id = sqlc.arg(kb_id)
    AND c.embedding IS NOT NULL
    AND c.embedding_model_id = sqlc.arg(embedding_model_id)::uuid
ORDER BY c.embedding <=> sqlc.arg(embedding)::text::vector
LIMIT sqlc.arg(row_limit)::integer;

-- name: ListKbEmbeddingSyncCandidates :many
SELECT k.id::text
FROM knowledge_bases k
LEFT JOIN models m ON m.id = k.embedding_model_id
    AND m.kind = 'embedding'
    AND m.ownership_type = 'system'
    AND m.enabled
    AND m.deleted_at IS NULL
    AND (m.embedding_config ->> 'dimension')::integer > 0
WHERE k.enabled AND (
    (
        k.embedding_model_id IS NULL
        AND EXISTS (
            SELECT 1 FROM models available
            WHERE available.kind = 'embedding'
                AND available.ownership_type = 'system'
                AND available.enabled
                AND available.deleted_at IS NULL
                AND (available.embedding_config ->> 'dimension')::integer > 0
        )
    )
    OR (
        k.embedding_model_id IS NOT NULL
        AND (
            (m.id IS NULL AND k.embedding_dimension IS NOT NULL)
            OR (
                m.id IS NOT NULL
                AND k.embedding_dimension IS DISTINCT FROM (m.embedding_config ->> 'dimension')::integer
            )
        )
    )
)
ORDER BY k.created_at, k.id;

-- name: ListKbChunksNeedingVector :many
SELECT c.id::text AS id, c.document_id::text AS document_id, c.content
FROM knowledge_base_chunks c
JOIN knowledge_base_documents d ON d.id = c.document_id
WHERE c.kb_id = sqlc.arg(kb_id)
    AND c.document_id = sqlc.arg(document_id)
    AND (
        c.embedding IS NULL
        OR c.embedding_model_id IS DISTINCT FROM sqlc.arg(embedding_model_id)::uuid
    )
ORDER BY c.chunk_index, c.id;
