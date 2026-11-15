-- name: CreateEnrollment :one
INSERT INTO hosts(user_id,name,architecture,version) VALUES($1,$2,$3,$4) RETURNING id;

-- name: RevokePendingHost :execrows
UPDATE hosts SET status='revoked',deleted_at=now(),enabled=false WHERE id=$1 AND status='pending' AND public_key IS NULL AND deleted_at IS NULL;

-- name: ListHosts :many
SELECT id,user_id,name,architecture,version,status,activated_at,last_seen_at,report,created_at,enabled,max_environments,
(SELECT count(*) FROM environments e WHERE e.host_id=hosts.id
 AND NOT(e.desired='deleted' AND e.phase='deleted' AND e.observed_generation=e.generation)) AS environment_count
FROM hosts WHERE deleted_at IS NULL ORDER BY created_at DESC,id DESC LIMIT $1 OFFSET $2;

-- name: CountHosts :one
SELECT count(*) FROM hosts WHERE deleted_at IS NULL;

-- name: RevokeHost :execrows
UPDATE hosts SET status='revoked' WHERE id=$1 AND deleted_at IS NULL;

-- name: LockControl :exec
SELECT pg_advisory_xact_lock(129678,hashtext(current_schema() || ':environments'));

-- name: HostExists :one
SELECT EXISTS(SELECT 1 FROM hosts WHERE id=$1 AND deleted_at IS NULL);

-- name: DeleteHost :execrows
UPDATE hosts h SET status='revoked',deleted_at=now()
WHERE h.id=$1 AND h.deleted_at IS NULL AND NOT EXISTS (
 SELECT 1 FROM environments e WHERE e.host_id=h.id
 AND NOT(e.desired='deleted' AND e.phase='deleted' AND e.observed_generation=e.generation)
) AND NOT EXISTS(SELECT 1 FROM host_upgrades u WHERE u.host_id=h.id AND u.status IN ('pending','running'));

-- name: DisableHost :exec
UPDATE hosts SET enabled=false WHERE id=$1;

-- name: EnrollHost :one
UPDATE hosts SET public_key=sqlc.arg(public_key),status='active',activated_at=COALESCE(activated_at,now()),
architecture=sqlc.arg(architecture),name=CASE WHEN public_key IS NULL AND sqlc.arg(name)::text<>'' THEN sqlc.arg(name) ELSE name END
WHERE id=sqlc.arg(host_id) AND deleted_at IS NULL AND status IN ('pending','active')
AND (public_key IS NULL OR public_key=sqlc.arg(public_key)) AND (public_key IS NULL OR architecture=sqlc.arg(architecture)) AND version=sqlc.arg(version)
RETURNING id;

-- name: HostKey :one
SELECT public_key FROM hosts WHERE id=$1 AND status='active' AND deleted_at IS NULL;

-- name: RecordHeartbeat :execrows
UPDATE hosts SET last_seen_at=sqlc.arg(at)::timestamptz,report=sqlc.arg(report),
version=COALESCE(NULLIF(sqlc.arg(report)::jsonb->>'engine_version',''),version)
WHERE id=sqlc.arg(id) AND status='active' AND deleted_at IS NULL AND (last_seen_at IS NULL OR last_seen_at<sqlc.arg(at)::timestamptz);

-- name: InstallationHost :one
SELECT id,version,status,public_key FROM hosts WHERE id=$1 AND deleted_at IS NULL AND status IN ('pending','active');

-- name: UpgradeHost :one
SELECT id,architecture,version,status,last_seen_at,report FROM hosts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE;

-- name: GetUpgrade :one
SELECT host_id,id,from_version,target_version AS version,installer_sha256,manifest_sha256,status,reason,created_at,updated_at
FROM host_upgrades WHERE host_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1;

-- name: SetUpgrade :one
INSERT INTO host_upgrades(id,host_id,from_version,target_version,installer_sha256,manifest_sha256)
SELECT sqlc.arg(id),h.id,h.version,sqlc.arg(version),sqlc.arg(installer_sha256),sqlc.arg(manifest_sha256) FROM hosts h WHERE h.id=sqlc.arg(host_id)
RETURNING host_id,id,from_version,target_version AS version,installer_sha256,manifest_sha256,status,reason,created_at,updated_at;

-- name: ReportUpgrade :exec
UPDATE host_upgrades SET status=sqlc.arg(status),reason=sqlc.arg(reason),updated_at=now() WHERE host_id=sqlc.arg(host_id) AND id=sqlc.arg(id) AND status IN ('pending','running');

-- name: ExpireUpgrade :exec
UPDATE host_upgrades SET status='failed',reason='upgrade_timeout',updated_at=now() WHERE host_id=$1 AND status IN ('pending','running') AND created_at<now()-interval '30 minutes';
