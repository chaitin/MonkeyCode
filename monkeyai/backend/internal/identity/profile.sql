-- name: GetProfile :one
SELECT coalesce(custom_avatar_url,'')::text AS custom_avatar_url,
    coalesce(avatar_url,'')::text AS synced_avatar_url,
    (password_hash IS NOT NULL AND password_hash <> '')::boolean AS has_password
FROM users WHERE id=$1 AND deleted_at IS NULL AND status='active';

-- name: GetProfileCredentials :one
SELECT password_hash,email FROM users
WHERE id=$1 AND deleted_at IS NULL AND status='active';

-- name: RevokeProfileDeviceApprovals :exec
WITH approvals AS (
    SELECT r.id FROM oauth_device_requests AS r
    WHERE r.owner_user_id=$1 AND r.status='approved' ORDER BY r.id FOR UPDATE
)
UPDATE oauth_device_requests AS d SET status='denied'
FROM approvals WHERE d.id=approvals.id;

-- name: HasProfileDeviceApprovals :one
SELECT EXISTS(SELECT 1 FROM oauth_device_requests WHERE owner_user_id=$1 AND status='approved')::boolean;

-- name: RevokeProfilePairings :exec
WITH requests AS (
    SELECT r.id FROM oauth_pairing_requests AS r
    WHERE r.creator_user_id=$1 AND r.status IN ('pending','joined','approved') ORDER BY r.id FOR UPDATE
)
UPDATE oauth_pairing_requests AS p SET status='denied'
FROM requests WHERE p.id=requests.id;

-- name: HasProfilePairings :one
SELECT EXISTS(
    SELECT 1 FROM oauth_pairing_requests
    WHERE creator_user_id=$1 AND status IN ('pending','joined','approved')
)::boolean;

-- name: LockProfileCredentials :one
SELECT password_hash,email FROM users
WHERE id=$1 AND deleted_at IS NULL AND status='active' FOR NO KEY UPDATE;

-- name: SetProfileAvatar :one
UPDATE users SET custom_avatar_url=NULLIF(sqlc.arg(custom_avatar_url)::text,''),updated_at=now()
WHERE id=sqlc.arg(id) AND deleted_at IS NULL AND status='active'
RETURNING coalesce(custom_avatar_url,'')::text AS custom_avatar_url,
    coalesce(nullif(btrim(custom_avatar_url),''),nullif(btrim(avatar_url),''),'')::text AS avatar_url;

-- name: LockProfileAvatar :one
SELECT coalesce(custom_avatar_url,'')::text AS custom_avatar_url FROM users
WHERE id=$1 AND deleted_at IS NULL AND status='active' FOR NO KEY UPDATE;

-- name: ReadProfileAvatar :one
SELECT coalesce(custom_avatar_url,'')::text AS custom_avatar_url FROM users WHERE id=$1;

-- name: LockStoredProfileAvatar :one
SELECT coalesce(custom_avatar_url,'')::text AS custom_avatar_url FROM users
WHERE id=$1 FOR NO KEY UPDATE;

-- name: ProfilePasswordAttempt :one
INSERT INTO profile_password_attempts(user_id) VALUES($1)
ON CONFLICT(user_id) DO UPDATE SET
    attempts=CASE WHEN profile_password_attempts.window_started_at <= now()-interval '15 minutes'
        THEN 1 ELSE least(profile_password_attempts.attempts+1,11) END,
    window_started_at=CASE WHEN profile_password_attempts.window_started_at <= now()-interval '15 minutes'
        THEN now() ELSE profile_password_attempts.window_started_at END
RETURNING (attempts <= 10)::boolean AS allowed;

-- name: ClearProfilePasswordAttempts :exec
DELETE FROM profile_password_attempts WHERE user_id=$1;

-- name: LockProfileBrowserSession :one
SELECT id FROM browser_sessions
WHERE token_hash=sqlc.arg(token_hash) AND user_id=sqlc.arg(user_id)
    AND revoked_at IS NULL AND expires_at>now() FOR UPDATE;

-- name: SetProfilePassword :execrows
UPDATE users SET password_hash=sqlc.arg(password_hash),updated_at=now()
WHERE id=sqlc.arg(id) AND deleted_at IS NULL AND status='active';

-- name: RevokeProfileTokens :many
WITH grants AS (
    UPDATE oauth_grants AS g SET revoked_at=now(),revoke_reason='user_revocation',
        revocation_version=g.revocation_version+1
    WHERE g.user_id=$1 AND g.revoked_at IS NULL RETURNING g.id
), tokens AS (
    UPDATE oauth_tokens AS t SET revoked_at=now() WHERE t.user_id=$1 AND t.revoked_at IS NULL
)
SELECT grants.id FROM grants ORDER BY grants.id;
