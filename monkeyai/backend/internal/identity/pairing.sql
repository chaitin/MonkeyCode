-- name: CreatePairing :one
INSERT INTO oauth_pairing_requests(creator_user_id, secret_hash, created_at, expires_at, next_poll_at)
VALUES ($1, $2, $3, $4, $3) RETURNING *;

-- name: PairingByID :one
SELECT * FROM oauth_pairing_requests WHERE id=$1;

-- name: LockPairing :one
SELECT * FROM oauth_pairing_requests WHERE id=$1 FOR UPDATE;

-- name: LockPairingNowait :one
-- 改密先锁配对再锁用户，兑换持有用户锁时不能等待配对锁。
SELECT * FROM oauth_pairing_requests WHERE id=$1 FOR UPDATE NOWAIT;

-- name: PairingByDeviceCode :one
SELECT * FROM oauth_pairing_requests WHERE device_code_hash=$1;

-- name: JoinPairing :exec
UPDATE oauth_pairing_requests SET status='joined', device_code_hash=$2, user_code_hash=$3,
    code_challenge=$4, code_challenge_method='S256', machine_id=$5, display_name=$6,
    platform=$7, os_version=$8, arch=$9, expires_at=$10
WHERE id=$1 AND status='pending';

-- name: ResolvePairing :exec
UPDATE oauth_pairing_requests SET status=$2 WHERE id=$1;

-- name: FailPairingCode :exec
UPDATE oauth_pairing_requests SET failed_attempts=failed_attempts+1,
    status=CASE WHEN failed_attempts+1 >= 5 THEN 'denied' ELSE status END
WHERE id=$1 AND status='joined';

-- name: SetPairingPoll :exec
UPDATE oauth_pairing_requests SET interval_ms=$2, next_poll_at=$3 WHERE id=$1;

-- name: ConsumePairing :execrows
UPDATE oauth_pairing_requests SET status='consumed'
WHERE id=$1 AND status='approved' AND expires_at > sqlc.arg(now)::timestamptz;
