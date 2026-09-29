-- name: CreateFeedback :one
INSERT INTO feedbacks (
    id, user_id, category, content, rating, platform, client_version,
    state, request_id, idempotency_key, request_hash
) VALUES ($1, $2, $3, $4, $5, $6, $7, 'uploading', $8, $9, $10)
ON CONFLICT DO NOTHING
RETURNING id, user_id, category, content, rating, platform, client_version,
          state, request_id, idempotency_key, request_hash, created_at, updated_at;

-- name: FeedbackByID :one
SELECT id, user_id, category, content, rating, platform, client_version,
       state, request_id, idempotency_key, request_hash, created_at, updated_at
FROM feedbacks
WHERE id = $1;

-- name: FeedbackByIdempotency :one
SELECT id, user_id, category, content, rating, platform, client_version,
       state, request_id, idempotency_key, request_hash, created_at, updated_at
FROM feedbacks
WHERE user_id = $1 AND idempotency_key = $2 AND idempotency_key <> '';

-- name: ListFeedbacks :many
SELECT id, user_id, category, content, rating, platform, client_version,
       state, request_id, idempotency_key, request_hash, created_at, updated_at
FROM feedbacks
WHERE (sqlc.arg(category)::text = '' OR feedbacks.category = sqlc.arg(category)::text)
  AND (sqlc.arg(state)::text = '' OR feedbacks.state = sqlc.arg(state)::text)
ORDER BY created_at DESC, id DESC
LIMIT sqlc.arg(page_limit)::int OFFSET sqlc.arg(page_offset)::int;

-- name: CountFeedbacks :one
SELECT count(*)
FROM feedbacks
WHERE (sqlc.arg(category)::text = '' OR feedbacks.category = sqlc.arg(category)::text)
  AND (sqlc.arg(state)::text = '' OR feedbacks.state = sqlc.arg(state)::text);

-- name: ListAttachments :many
SELECT id, feedback_id, object_key, mime_type, byte_size, width, height,
       sha256, state, created_at
FROM feedback_attachments
WHERE feedback_id = $1
ORDER BY created_at ASC, id ASC;

-- name: AttachmentForDownload :one
SELECT a.id, a.feedback_id, a.object_key, a.mime_type, a.byte_size,
       a.width, a.height, a.sha256, a.state, a.created_at
FROM feedback_attachments AS a
JOIN feedbacks AS f ON f.id = a.feedback_id
WHERE f.id = sqlc.arg(feedback_id)
  AND a.id = sqlc.arg(attachment_id)
  AND f.state NOT IN ('uploading', 'failed')
  AND a.state = 'ready';

-- name: CreateAttachment :exec
INSERT INTO feedback_attachments (
    id, feedback_id, object_key, mime_type, byte_size, width, height, sha256, state
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending');

-- name: SetAttachmentReady :execrows
UPDATE feedback_attachments
SET state = 'ready'
WHERE id = $1 AND feedback_id = $2 AND state = 'pending';

-- name: SetAttachmentFailed :execrows
UPDATE feedback_attachments
SET state = 'failed'
WHERE id = $1 AND feedback_id = $2 AND state <> 'failed';

-- name: SetFeedbackState :execrows
UPDATE feedbacks
SET state = $2, updated_at = now()
WHERE id = $1;

-- name: UpdateFeedbackState :one
UPDATE feedbacks
SET state = $2, updated_at = now()
WHERE id = $1
RETURNING id, user_id, category, content, rating, platform, client_version,
          state, request_id, idempotency_key, request_hash, created_at, updated_at;

-- name: DeleteAttachment :execrows
DELETE FROM feedback_attachments
WHERE id = $1;

-- name: ListStaleAttachments :many
SELECT id, feedback_id, object_key, mime_type, byte_size, width, height,
       sha256, state, created_at
FROM feedback_attachments
WHERE state IN ('pending', 'failed') AND created_at < $1
ORDER BY created_at ASC
LIMIT $2;

-- name: MarkStaleUploading :execrows
WITH stale AS (
    UPDATE feedbacks AS f
    SET state = 'failed', updated_at = now()
    WHERE f.state = 'uploading' AND f.created_at < $1
    RETURNING id
)
UPDATE feedback_attachments AS a
SET state = 'failed'
FROM stale
WHERE a.feedback_id = stale.id AND a.state <> 'failed';
