-- name: LockUser :one
SELECT id FROM users WHERE id=$1 AND status='active' AND deleted_at IS NULL FOR UPDATE;

-- name: CountConnections :one
SELECT count(*) FROM device_client_connections c
JOIN oauth_grants g ON g.id=c.client_grant_id
WHERE c.user_id=$1 AND c.machine_id=$2 AND c.revoked_at IS NULL AND c.expires_at>now()
    AND g.revoked_at IS NULL AND g.expires_at>now() AND c.grant_version=$3;

-- name: CreateConnection :one
INSERT INTO device_client_connections(user_id,machine_id,client_grant_id,grant_version,access_version,scopes,protocol,ticket_hash,expires_at)
VALUES($1,$2,$3,$4,1,$5,$6,$7,$8) RETURNING *;

-- name: LockConnection :one
SELECT * FROM device_client_connections WHERE id=$1 AND user_id=$2 AND client_grant_id=$3 FOR UPDATE;

-- name: GetConnection :one
SELECT c.*,g.client_id,g.audience,g.purpose,g.revocation_version
FROM device_client_connections c JOIN oauth_grants g ON g.id=c.client_grant_id
JOIN users u ON u.id=c.user_id JOIN endpoints e ON e.user_id=c.user_id AND e.machine_id=c.machine_id
JOIN oauth_grants host ON host.id=e.active_grant_id
WHERE c.id=$1 AND c.revoked_at IS NULL AND c.expires_at>now()
    AND g.revoked_at IS NULL AND g.expires_at>now() AND c.scopes<@g.scopes
    AND u.status='active' AND u.deleted_at IS NULL
    AND e.remote_access_state='enabled' AND c.grant_version=e.grant_version
    AND host.revoked_at IS NULL AND host.expires_at>now();

-- name: GetConnections :many
SELECT c.id,c.scopes,c.expires_at,c.grant_version,c.access_version FROM device_client_connections c
JOIN oauth_grants g ON g.id=c.client_grant_id JOIN users u ON u.id=c.user_id
JOIN endpoints e ON e.user_id=c.user_id AND e.machine_id=c.machine_id
JOIN oauth_grants host ON host.id=e.active_grant_id
WHERE c.id=ANY($1::uuid[]) AND c.revoked_at IS NULL AND c.expires_at>now()
    AND g.revoked_at IS NULL AND g.expires_at>now() AND c.scopes<@g.scopes
    AND u.status='active' AND u.deleted_at IS NULL AND e.remote_access_state='enabled'
    AND c.grant_version=e.grant_version AND host.revoked_at IS NULL AND host.expires_at>now();

-- name: FindTicket :one
SELECT id,user_id FROM device_client_connections
WHERE machine_id=$1 AND revoked_at IS NULL AND expires_at>now()
    AND (ticket_hash=$2 OR (previous_ticket_hash=$2 AND previous_expires_at>now()));

-- name: RotateTicket :one
UPDATE device_client_connections SET
    previous_ticket_hash = CASE WHEN scopes=$3 THEN ticket_hash ELSE NULL END,
    previous_expires_at = CASE WHEN scopes=$3 THEN least(expires_at,now()+interval '30 seconds') ELSE NULL END,
    ticket_hash=$2,scopes=$3,access_version=access_version + CASE WHEN scopes=$3 THEN 0 ELSE 1 END,expires_at=$4,ticket_version=ticket_version+1
WHERE id=$1 RETURNING *;

-- name: RevokeTargetConnections :exec
UPDATE device_client_connections SET revoked_at=now(),previous_ticket_hash=NULL,previous_expires_at=NULL
WHERE user_id=$1 AND machine_id=$2 AND revoked_at IS NULL;

-- name: PurgeExpiredConnections :exec
DELETE FROM device_client_connections WHERE expires_at<now()-interval '1 day';
