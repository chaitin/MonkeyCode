-- name: InsertVideoInput :exec
INSERT INTO video_inputs (id,user_id,object_key,mime_type,width,height,byte_size,sha256,expires_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9);

-- name: VideoInputOwned :one
SELECT object_key,mime_type,width,height,byte_size,sha256 FROM video_inputs
WHERE id=$1 AND user_id=$2 AND expires_at>now();

-- name: InsertVideoOutput :exec
INSERT INTO video_outputs(id,job_id,object_key,mime_type,width,height,duration_ms,byte_size,sha256,expires_at)
VALUES($1,$2,$3,'video/mp4',$4,$5,$6,$7,$8,$9);

-- name: VideoOutputOwned :one
SELECT o.object_key,o.mime_type,o.byte_size FROM video_outputs o
JOIN video_jobs j ON j.id=o.job_id WHERE o.id=$1 AND j.user_id=$2
AND o.expires_at>now() AND o.purged_at IS NULL AND j.status='succeeded';

-- name: VideoJobOutputDuration :one
SELECT duration_ms FROM video_outputs WHERE job_id=$1;

-- name: InsertVideoJob :exec
INSERT INTO video_jobs(id,user_id,model_id,session_id,provider,mode,status,request_hash,idempotency_key,request_config,pricing_snapshot,billing_transaction_id)
VALUES(sqlc.arg(id)::uuid,sqlc.arg(user_id)::uuid,sqlc.arg(model_id)::uuid,
NULLIF(sqlc.arg(session_id)::text,'')::uuid,sqlc.arg(provider)::text,sqlc.arg(mode)::text,
'reserved',sqlc.arg(request_hash)::text,NULLIF(sqlc.arg(idempotency_key)::text,''),
sqlc.arg(request_config)::jsonb,sqlc.arg(pricing_snapshot)::jsonb,sqlc.arg(billing_transaction_id)::uuid);

-- name: InsertVideoJobInput :exec
INSERT INTO video_job_inputs(job_id,input_id,ordinal,role) VALUES($1,$2,$3,$4);

-- name: IdempotentVideoJob :one
SELECT id,request_hash FROM video_jobs WHERE user_id=$1 AND idempotency_key=$2;

-- name: VideoTaskOwned :one
SELECT j.status,j.mode,j.created_at,j.completed_at,j.error_code,j.billing_transaction_id,
j.request_config,j.pricing_snapshot,o.id AS output_id,o.mime_type,o.width,o.height,o.duration_ms,o.byte_size,o.expires_at
FROM video_jobs j LEFT JOIN video_outputs o ON o.job_id=j.id
WHERE j.id=$1 AND j.user_id=$2;

-- name: MarkVideoJobUnknown :exec
UPDATE video_jobs SET status='unknown',error_code=$2,updated_at=now() WHERE id=$1;

-- name: MarkVideoJobFailed :exec
UPDATE video_jobs SET status='failed',error_code=$2,updated_at=now(),completed_at=now() WHERE id=$1;

-- name: MarkVideoJobSubmitted :execrows
UPDATE video_jobs SET status='submitted',provider_job_id=$2,updated_at=now(),poll_after=now()
WHERE id=$1 AND status='reserved';

-- name: MarkAbandonedVideoJobs :exec
UPDATE video_jobs SET status='unknown',error_code='provider_submit_unknown',updated_at=now()
WHERE status='reserved' AND provider_job_id IS NULL AND updated_at<now()-interval '2 minutes';

-- name: PollableVideoJobs :many
SELECT id FROM video_jobs WHERE status IN ('submitted','running')
AND provider_job_id IS NOT NULL AND poll_after<=now() ORDER BY poll_after LIMIT 20;

-- name: ClaimVideoJobPoll :one
UPDATE video_jobs SET poll_after=now()+interval '5 minutes'
WHERE id=$1 AND poll_after<=now() AND status IN ('submitted','running')
RETURNING model_id,provider_job_id,billing_transaction_id,user_id;

-- name: RetryVideoJobPoll :exec
UPDATE video_jobs SET poll_after=now()+interval '30 seconds' WHERE id=$1 AND status IN ('submitted','running');

-- name: MarkVideoJobRunning :exec
UPDATE video_jobs SET status='running',updated_at=now(),poll_after=now()+interval '10 seconds' WHERE id=$1;

-- name: MarkVideoJobSucceeded :exec
UPDATE video_jobs SET status='succeeded',output_duration_ms=$2,updated_at=now(),completed_at=now()
WHERE id=$1 AND status IN ('submitted','running');

-- name: ExpiredVideoInputs :many
SELECT i.id,i.object_key FROM video_inputs i
WHERE i.expires_at<now() AND NOT EXISTS (
    SELECT 1 FROM video_job_inputs j JOIN video_jobs v ON v.id=j.job_id
    WHERE j.input_id=i.id AND v.status IN ('created','reserved','submitted','running','unknown')) LIMIT 50;

-- name: UnlinkExpiredVideoInput :exec
DELETE FROM video_job_inputs WHERE input_id=$1;

-- name: RemoveExpiredVideoInput :exec
DELETE FROM video_inputs WHERE id=$1;

-- name: ExpiredVideoOutputs :many
SELECT id,object_key FROM video_outputs WHERE expires_at<now() AND purged_at IS NULL LIMIT 50;

-- name: MarkVideoOutputPurged :exec
UPDATE video_outputs SET purged_at=now() WHERE id=$1 AND purged_at IS NULL;
