-- name: CreateEnrollment :one
INSERT INTO engine_hosts(name,architecture,version,enrollment_hash,enrollment_expires_at)
VALUES($1,$2,$3,$4,now()+interval '30 minutes') RETURNING id,enrollment_expires_at;

-- name: ListHosts :many
SELECT id,name,architecture,version,status,enrollment_expires_at,enrolled_at,last_seen_at,report,created_at
FROM engine_hosts ORDER BY created_at DESC,id DESC LIMIT $1 OFFSET $2;

-- name: CountHosts :one
SELECT count(*) FROM engine_hosts;

-- name: RevokeHost :execrows
UPDATE engine_hosts SET status='revoked',challenge=NULL,challenge_expires_at=NULL WHERE id=$1;

-- name: EnrollHost :one
UPDATE engine_hosts SET public_key=sqlc.arg(public_key),status='active',enrolled_at=COALESCE(enrolled_at,now())
WHERE enrollment_hash=sqlc.arg(enrollment_hash) AND enrollment_expires_at>now() AND status IN ('pending','active')
AND (public_key IS NULL OR public_key=sqlc.arg(public_key)) AND architecture=sqlc.arg(architecture) AND version=sqlc.arg(version)
RETURNING id;

-- name: HostChallenge :one
UPDATE engine_hosts SET challenge=CASE WHEN challenge_expires_at>now() THEN challenge ELSE sqlc.arg(challenge)::text END,
challenge_expires_at=CASE WHEN challenge_expires_at>now() THEN challenge_expires_at ELSE now()+interval '60 seconds' END
WHERE id=sqlc.arg(id) AND status='active' RETURNING COALESCE(challenge,'')::text AS challenge;

-- name: HostKey :one
SELECT public_key FROM engine_hosts WHERE id=$1 AND status='active';

-- name: RecordHeartbeat :execrows
UPDATE engine_hosts SET challenge=NULL,challenge_expires_at=NULL,last_seen_at=now(),report=sqlc.arg(report)
WHERE id=sqlc.arg(id) AND status='active' AND challenge=sqlc.arg(challenge)::text AND challenge_expires_at>now();

-- name: ConsumeChallenge :execrows
UPDATE engine_hosts SET challenge=NULL,challenge_expires_at=NULL
WHERE id=$1 AND status='active' AND challenge=$2 AND challenge_expires_at>now();
