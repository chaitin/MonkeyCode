-- name: CreateEnrollment :one
INSERT INTO hosts(user_id,name,architecture,version) VALUES($1,$2,$3,$4) RETURNING id;

-- name: RevokePendingHost :execrows
UPDATE hosts SET status='revoked',deleted_at=now(),enabled=false WHERE id=$1 AND status='pending' AND public_key IS NULL AND deleted_at IS NULL;

-- name: ListHosts :many
SELECT id,user_id,name,architecture,version,status,activated_at,last_seen_at,report,created_at,enabled
FROM hosts WHERE deleted_at IS NULL AND status <> 'pending' ORDER BY created_at DESC,id DESC LIMIT $1 OFFSET $2;

-- name: CountHosts :one
SELECT count(*) FROM hosts WHERE deleted_at IS NULL AND status <> 'pending';

-- name: RevokeHost :execrows
UPDATE hosts SET status='revoked' WHERE id=$1 AND deleted_at IS NULL;

-- name: LockControl :exec
SELECT pg_advisory_xact_lock(129678,hashtext(current_schema() || ':environments'));

-- name: HostExists :one
SELECT EXISTS(SELECT 1 FROM hosts WHERE id=$1 AND deleted_at IS NULL);

-- name: LegacyHostOccupied :one
SELECT EXISTS(SELECT 1 FROM environments WHERE host_id=$1 AND archived_at IS NULL
 AND NOT(desired='deleted' AND phase='deleted' AND observed_generation=generation));

-- name: DeleteHost :execrows
UPDATE hosts h SET status='revoked',deleted_at=now()
WHERE h.id=$1 AND h.deleted_at IS NULL AND NOT EXISTS (
 SELECT 1 FROM environments e WHERE e.host_id=h.id
 AND (e.archived_at IS NULL OR (h.status='active' AND h.last_seen_at>now()-interval '90 seconds'))
 AND NOT(e.desired='deleted' AND e.phase='deleted' AND e.observed_generation=e.generation)
) AND NOT EXISTS(SELECT 1 FROM host_upgrades u WHERE u.host_id=h.id AND u.status IN ('pending','running'));

-- name: DisableHost :exec
UPDATE hosts SET enabled=false WHERE id=$1;

-- name: EnrollHost :one
UPDATE hosts SET public_key=sqlc.arg(public_key),status='active',activated_at=COALESCE(activated_at,now()),
architecture=sqlc.arg(architecture),name=COALESCE(NULLIF(name,''),sqlc.arg(name)::text)
WHERE id=sqlc.arg(host_id) AND deleted_at IS NULL AND status IN ('pending','active')
AND (public_key IS NULL OR public_key=sqlc.arg(public_key)) AND (public_key IS NULL OR architecture=sqlc.arg(architecture)) AND version=sqlc.arg(version)
RETURNING id;

-- name: HostKey :one
SELECT public_key FROM hosts WHERE id=$1 AND status='active' AND deleted_at IS NULL;

-- name: RecordHeartbeat :execrows
UPDATE hosts SET last_seen_at=sqlc.arg(at)::timestamptz,report=sqlc.arg(report),
name=COALESCE(NULLIF(name,''),sqlc.arg(candidate)::text),
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

-- name: ListMemberEnvironments :many
WITH candidates AS (
 SELECT e.*, u.name AS user_name, u.email, coalesce(nullif(btrim(u.custom_avatar_url),''), u.avatar_url,'') AS avatar,
        h.name AS host_name, h.report AS host_report, coalesce(rt.runtime_version,'') AS runtime_version,
        CASE WHEN e.deleted_at IS NOT NULL OR e.archived_at IS NOT NULL THEN 'deleted'
             WHEN e.generation <> e.observed_generation THEN 'pending_' || e.desired ELSE e.phase END AS state
 FROM environments e JOIN users u ON u.id=e.user_id JOIN hosts h ON h.id=e.host_id
 LEFT JOIN environment_runtimes rt ON rt.environment_id=e.id
 WHERE (sqlc.arg(visible_users)::uuid[] IS NULL OR e.user_id=ANY(sqlc.arg(visible_users)::uuid[]))
   AND (sqlc.narg(user_id)::uuid IS NULL OR e.user_id=sqlc.narg(user_id))
   AND (sqlc.narg(host_id)::uuid IS NULL OR e.host_id=sqlc.narg(host_id))
   AND strpos(lower(u.name || ' ' || u.email),lower(sqlc.arg(user_query)::text))>0
   AND strpos(lower(e.name),lower(sqlc.arg(name_query)::text))>0
), ranked AS (
 SELECT c.*, CASE WHEN state='running' AND pg_input_is_valid(usage->>'at','timestamptz') THEN
        CASE WHEN (usage->>'at')::timestamptz BETWEEN now()-interval '90 seconds' AND now() THEN
           CASE WHEN sqlc.arg(ordering)::text IN ('cpu_asc','cpu_desc') THEN usage->'cpu_cores' ELSE usage->'memory_bytes' END END END AS metric
 FROM candidates c WHERE sqlc.arg(state_filter)::text='all'
    OR (sqlc.arg(state_filter)='active' AND state<>'deleted') OR state=sqlc.arg(state_filter)
)
SELECT (jsonb_build_object('id',id,'user_id',user_id,'host_id',host_id,'name',name,'created_at',created_at,'deleted_at',deleted_at,
 'user',jsonb_build_object('name',user_name,'email',email,'avatar_url',avatar),
 'host',jsonb_build_object('name',host_name,'hostname',coalesce(host_report#>>'{system,hostname}',''),'os_name',coalesce(host_report#>>'{system,os_name}','')),
 'instance_id',instance_id,'generation',generation,'observed_generation',observed_generation,'observed_at',observed_at,
 'desired',desired,'phase',phase,'reason',reason,'storage_retained',true,'workload_verified',false,'runtime_version',runtime_version,
 -- Provisioning/runtime material is not list data. Only project display fields from the stored specification.
 'spec',jsonb_build_object('environment_id',id,'instance_id',instance_id,'generation',generation,'desired_state',desired,
     'driver',spec->'driver','image',spec->'image','image_digest',spec->'image_digest','network_policy',spec->'network_policy',
     'resource',jsonb_build_object('cpu_millis',cpu_millis,'memory_bytes',memory_bytes,'host_tasks',spec#>'{resource,host_tasks}',
        'temporary_bytes',spec#>'{resource,temporary_bytes}'),
     'volumes',coalesce((SELECT jsonb_agg(jsonb_build_object('id',v->'id','purpose',v->'purpose','bytes',v->'bytes','inodes',v->'inodes') ORDER BY ord)
         FROM jsonb_array_elements(CASE WHEN jsonb_typeof(spec->'volumes')='array' THEN spec->'volumes' ELSE '[]'::jsonb END) WITH ORDINALITY AS entries(v,ord)), '[]'::jsonb)))
 || jsonb_strip_nulls(jsonb_build_object('archived_at',archived_at)))::jsonb AS item
FROM ranked
ORDER BY CASE WHEN sqlc.arg(ordering)::text IN ('cpu_desc','memory_desc') AND jsonb_typeof(metric)='number' THEN metric END DESC NULLS LAST,
         CASE WHEN sqlc.arg(ordering)::text IN ('cpu_asc','memory_asc') AND jsonb_typeof(metric)='number' THEN metric END ASC NULLS LAST,
         created_at DESC,id DESC LIMIT sqlc.arg(page_limit)::int OFFSET sqlc.arg(page_offset)::int;

-- name: ExpireUpgrade :exec
UPDATE host_upgrades SET status='failed',reason='upgrade_timeout',updated_at=now() WHERE host_id=$1 AND status IN ('pending','running') AND created_at<now()-interval '30 minutes';
