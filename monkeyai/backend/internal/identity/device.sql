-- name: CreateDeviceRequest :one
INSERT INTO oauth_device_requests(client_id,device_code_hash,user_code_hash,machine_id,execution_public_key,key_id,display_name,platform,arch,requested_scopes,expires_at)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *;

-- name: DeviceRequestByCode :one
SELECT * FROM oauth_device_requests WHERE user_code_hash=$1;

-- name: DeviceRequestByID :one
SELECT * FROM oauth_device_requests WHERE id=$1;

-- name: LockDeviceRequest :one
SELECT * FROM oauth_device_requests WHERE id=$1 FOR UPDATE;

-- name: LockDeviceCode :one
SELECT * FROM oauth_device_requests WHERE device_code_hash=$1 AND client_id=$2 FOR UPDATE;

-- name: LockDeviceOwner :one
SELECT id FROM users WHERE id=$1 AND status='active' AND deleted_at IS NULL FOR UPDATE;

-- name: DecideDeviceRequest :execrows
UPDATE oauth_device_requests SET status=$2,owner_user_id=$3,approved_scopes=$4,restore_revoked=$5
WHERE id=$1 AND status='pending' AND expires_at>now();

-- name: SetDevicePoll :exec
UPDATE oauth_device_requests SET interval_ms=$2,next_poll_at=$3 WHERE id=$1;

-- name: ResolveDeviceRequest :exec
UPDATE oauth_device_requests SET status=$2 WHERE id=$1;

-- name: CreateRuntimeGrant :one
INSERT INTO oauth_grants(user_id,client_id,scopes,audience,purpose,requested_machine_id,requested_key_id,restore_approved,expires_at)
VALUES($1,'monkeyai-runtime',$2,'monkeyai-api','runtime',$3,$4,$5,$6) RETURNING *;

-- name: ConsumeRestoreApproval :execrows
UPDATE oauth_grants SET restore_approved=false WHERE id=$1 AND restore_approved AND revoked_at IS NULL;

-- name: RevokeBoundRuntimeGrant :execrows
UPDATE oauth_grants SET revoked_at=now(),revoke_reason='execution_replaced',revocation_version=revocation_version+1
WHERE id=$1 AND user_id=$2 AND machine_id=$3 AND purpose='runtime' AND revoked_at IS NULL;

-- name: CleanupDeviceRequests :exec
WITH expired_states AS (DELETE FROM oauth_login_states WHERE device_request_id IS NOT NULL AND expires_at<now())
DELETE FROM oauth_device_requests WHERE expires_at<now()-interval '1 day'
AND id NOT IN (SELECT device_request_id FROM oauth_login_states WHERE device_request_id IS NOT NULL);

-- name: LockDeviceUserCode :one
SELECT * FROM oauth_device_requests WHERE user_code_hash=$1 FOR UPDATE;

-- name: RevokeRuntimeMachine :many
UPDATE oauth_grants SET revoked_at=now(),revoke_reason='environment_deleted',revocation_version=revocation_version+1
WHERE user_id=$1 AND purpose='runtime' AND (machine_id=$2 OR requested_machine_id=$2) AND revoked_at IS NULL RETURNING id;
