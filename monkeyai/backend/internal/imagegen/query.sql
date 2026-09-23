-- name: InsertJob :one
INSERT INTO image_jobs (
    id, user_id, model_id, provider, operation, status, request_hash, idempotency_key,
    requested_images, quality, aspect_ratio, request_config, pricing_snapshot
) VALUES (
    $1, $2, $3, $4, $5, 'created', $6, $7, $8, $9, $10, $11, $12
)
ON CONFLICT DO NOTHING
RETURNING id;

-- name: JobByIdempotency :one
SELECT id, request_hash
FROM image_jobs
WHERE user_id = $1 AND idempotency_key = $2;

-- name: JobByOwner :one
SELECT id, user_id, model_id, provider, operation, provider_job_id, status,
    requested_images, generated_images, quality, aspect_ratio, billing_transaction_id,
    error_code, created_at, completed_at, pricing_snapshot
FROM image_jobs
WHERE id = $1 AND user_id = $2;

-- name: SetJobReservation :execrows
UPDATE image_jobs
SET billing_transaction_id = $3, status = 'reserved'
WHERE id = $1 AND user_id = $2 AND status = 'created';

-- name: SetJobSubmitted :execrows
UPDATE image_jobs
SET status = 'submitted', submitted_at = now()
WHERE id = $1 AND status = 'reserved';

-- name: SetJobProviderID :execrows
UPDATE image_jobs
SET status = 'running', provider_job_id = $2
WHERE id = $1 AND status = 'submitted';

-- name: SetJobUnknown :execrows
UPDATE image_jobs
SET status = 'unknown', error_code = $2
WHERE id = $1 AND status IN ('submitted', 'running');

-- name: SetJobFinished :execrows
UPDATE image_jobs
SET status = $2, generated_images = $3, error_code = $4, completed_at = now(), usage = $5
WHERE id = $1 AND status IN ('created', 'reserved', 'submitted', 'running', 'unknown');

-- name: JobsToRecover :many
SELECT id, user_id, model_id, provider, operation, provider_job_id, status,
    requested_images, generated_images, quality, aspect_ratio, billing_transaction_id,
    error_code, created_at, completed_at, pricing_snapshot
FROM image_jobs
WHERE (status = 'reserved' AND created_at < now() - interval '5 minutes')
   OR (status = 'submitted' AND submitted_at < now() - interval '5 minutes')
   OR (status IN ('running', 'unknown') AND provider_job_id IS NOT NULL)
ORDER BY created_at
LIMIT $1;

-- name: JobsWithPendingBilling :many
SELECT job.id, job.user_id, job.model_id, job.provider, job.operation, job.provider_job_id, job.status,
    job.requested_images, job.generated_images, job.quality, job.aspect_ratio, job.billing_transaction_id,
    job.error_code, job.created_at, job.completed_at, job.pricing_snapshot
FROM image_jobs job JOIN billing_transactions bill ON bill.id = job.billing_transaction_id
WHERE job.status IN ('succeeded', 'failed') AND bill.status IN ('reserved', 'running', 'unknown')
ORDER BY job.completed_at
LIMIT $1;

-- name: LinkJobInput :one
INSERT INTO image_job_inputs (job_id, input_id)
SELECT job.id, input.id FROM image_jobs job JOIN image_inputs input ON input.user_id = job.user_id
WHERE job.id = sqlc.arg(job_id) AND input.id = sqlc.arg(input_id) AND input.expires_at > now()
ON CONFLICT DO NOTHING
RETURNING job_id;

-- name: InsertImageInput :exec
INSERT INTO image_inputs (id, user_id, object_key, mime_type, width, height, byte_size, sha256, expires_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);

-- name: ImageInputOwned :one
SELECT object_key, mime_type, width, height, sha256
FROM image_inputs
WHERE id = $1 AND user_id = $2 AND expires_at > now();

-- name: InsertImageOutput :execrows
INSERT INTO image_outputs (id, job_id, ordinal, object_key, mime_type, width, height, byte_size, sha256, expires_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
ON CONFLICT (job_id, ordinal) DO NOTHING;

-- name: OutputByOrdinal :one
SELECT id, sha256 FROM image_outputs WHERE job_id = $1 AND ordinal = $2;

-- name: OutputsByJob :many
SELECT id, object_key, mime_type, width, height, expires_at, purged_at
FROM image_outputs
WHERE job_id = $1
ORDER BY ordinal;

-- name: OutputOwned :one
SELECT output.object_key, output.mime_type, output.byte_size, output.sha256
FROM image_outputs output JOIN image_jobs job ON job.id = output.job_id
WHERE output.id = $1 AND job.user_id = $2 AND output.expires_at > now() AND output.purged_at IS NULL;

-- name: ExpiredInputs :many
SELECT input.id, input.object_key
FROM image_inputs input
WHERE input.expires_at <= now()
  AND NOT EXISTS (
    SELECT 1 FROM image_job_inputs link JOIN image_jobs job ON job.id = link.job_id
    WHERE link.input_id = input.id AND job.status IN ('created', 'reserved', 'submitted', 'running', 'unknown')
  )
ORDER BY input.expires_at
LIMIT $1;

-- name: UnlinkExpiredInput :exec
DELETE FROM image_job_inputs WHERE input_id = $1;

-- name: RemoveExpiredInput :execrows
DELETE FROM image_inputs WHERE id = $1 AND expires_at <= now();

-- name: ExpiredOutputs :many
SELECT id, object_key
FROM image_outputs
WHERE expires_at <= now() AND purged_at IS NULL
ORDER BY expires_at
LIMIT $1;

-- name: MarkOutputPurged :execrows
UPDATE image_outputs SET purged_at = now()
WHERE id = $1 AND purged_at IS NULL;
