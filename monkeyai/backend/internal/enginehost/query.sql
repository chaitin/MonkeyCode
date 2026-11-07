-- name: CreateEnrollment :one
INSERT INTO engine_hosts(name,architecture,version,enrollment_hash,enrollment_expires_at)
VALUES($1,$2,$3,$4,now()+interval '30 minutes') RETURNING id,enrollment_expires_at;

-- name: RenewEnrollment :one
UPDATE engine_hosts SET enrollment_hash=$2,enrollment_expires_at=now()+interval '30 minutes',version=$3
WHERE id=$1 AND status='pending' AND public_key IS NULL AND deleted_at IS NULL
RETURNING id,enrollment_expires_at;

-- name: ListHosts :many
SELECT id,name,architecture,version,status,enrollment_expires_at,enrolled_at,last_seen_at,report,created_at,
EXISTS(SELECT 1 FROM environment_hosts h WHERE h.host_id=engine_hosts.id AND h.enabled) AS scheduling_enabled
FROM engine_hosts WHERE deleted_at IS NULL ORDER BY created_at DESC,id DESC LIMIT $1 OFFSET $2;

-- name: CountHosts :one
SELECT count(*) FROM engine_hosts WHERE deleted_at IS NULL;

-- name: RevokeHost :execrows
UPDATE engine_hosts SET status='revoked',challenge=NULL,challenge_expires_at=NULL WHERE id=$1 AND deleted_at IS NULL;

-- name: LockControl :one
SELECT id FROM environment_control WHERE id=1 FOR UPDATE;

-- name: HostExists :one
SELECT EXISTS(SELECT 1 FROM engine_hosts WHERE id=$1 AND deleted_at IS NULL);

-- name: DeleteHost :execrows
UPDATE engine_hosts h SET status='revoked',deleted_at=now(),challenge=NULL,challenge_expires_at=NULL
WHERE h.id=$1 AND h.deleted_at IS NULL AND NOT EXISTS (
 SELECT 1 FROM environments e WHERE e.host_id=h.id
 AND NOT(e.desired='deleted' AND e.phase='deleted' AND e.observed_generation=e.generation)
);

-- name: DisableHost :exec
UPDATE environment_hosts SET enabled=false WHERE host_id=$1;

-- name: EnrollHost :one
UPDATE engine_hosts SET public_key=sqlc.arg(public_key),status='active',enrolled_at=COALESCE(enrolled_at,now()),
architecture=sqlc.arg(architecture),name=CASE WHEN public_key IS NULL AND sqlc.arg(name)::text<>'' THEN sqlc.arg(name) ELSE name END
WHERE enrollment_hash=sqlc.arg(enrollment_hash) AND enrollment_expires_at>now() AND status IN ('pending','active')
AND (public_key IS NULL OR public_key=sqlc.arg(public_key)) AND (public_key IS NULL OR architecture=sqlc.arg(architecture)) AND version=sqlc.arg(version)
RETURNING id;

-- name: HostChallenge :one
UPDATE engine_hosts SET challenge=CASE WHEN challenge_expires_at>now() THEN challenge ELSE sqlc.arg(challenge)::text END,
challenge_expires_at=CASE WHEN challenge_expires_at>now() THEN challenge_expires_at ELSE now()+interval '60 seconds' END
WHERE id=sqlc.arg(id) AND status='active' RETURNING COALESCE(challenge,'')::text AS challenge;

-- name: HostKey :one
SELECT public_key FROM engine_hosts WHERE id=$1 AND status='active';

-- name: RecordHeartbeat :execrows
UPDATE engine_hosts SET challenge=NULL,challenge_expires_at=NULL,last_seen_at=now(),report=sqlc.arg(report),
version=COALESCE(NULLIF(sqlc.arg(report)::jsonb->>'engine_version',''),version)
WHERE id=sqlc.arg(id) AND status='active' AND challenge=sqlc.arg(challenge)::text AND challenge_expires_at>now();

-- name: ConsumeChallenge :execrows
UPDATE engine_hosts SET challenge=NULL,challenge_expires_at=NULL
WHERE id=$1 AND status='active' AND challenge=$2 AND challenge_expires_at>now();

-- name: InstallationEnrollment :one
SELECT version FROM engine_hosts WHERE enrollment_hash=$1 AND enrollment_expires_at>now() AND status IN ('pending','active');

-- name: UpgradeHost :one
SELECT id,architecture,version,status,last_seen_at,report FROM engine_hosts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE;

-- name: GetUpgrade :one
SELECT * FROM engine_upgrades WHERE host_id=$1;

-- name: SetUpgrade :one
INSERT INTO engine_upgrades(host_id,id,version,installer_sha256,manifest_sha256,status)
VALUES($1,$2,$3,$4,$5,'pending') ON CONFLICT(host_id) DO UPDATE
SET id=EXCLUDED.id,version=EXCLUDED.version,installer_sha256=EXCLUDED.installer_sha256,
manifest_sha256=EXCLUDED.manifest_sha256,status='pending',reason='',created_at=now(),updated_at=now()
RETURNING *;

-- name: ReportUpgrade :exec
UPDATE engine_upgrades SET status=$3,reason=$4,updated_at=now()
WHERE host_id=$1 AND id=$2 AND status IN ('pending','running');

-- name: ExpireUpgrade :exec
UPDATE engine_upgrades SET status='failed',reason='upgrade_timeout',updated_at=now()
WHERE host_id=$1 AND status IN ('pending','running') AND created_at<now()-interval '30 minutes';
