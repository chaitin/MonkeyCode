-- name: LockControl :one
SELECT id FROM environment_control WHERE id=1 FOR UPDATE;

-- name: CreatePreset :one
INSERT INTO environment_presets(name,architecture,configuration,cpu_millis,memory_bytes,storage_bytes)
VALUES($1,$2,$3,$4,$5,$6) RETURNING *;

-- name: ListPresets :many
SELECT * FROM environment_presets WHERE enabled OR sqlc.arg(include_disabled)::boolean ORDER BY created_at DESC,id DESC LIMIT $1 OFFSET $2;

-- name: GetPreset :one
SELECT * FROM environment_presets WHERE id=$1;

-- name: EnablePreset :execrows
UPDATE environment_presets SET enabled=$2 WHERE id=$1;

-- name: SetHost :one
INSERT INTO environment_hosts(host_id,enabled,cpu_millis,memory_bytes,storage_bytes,max_environments)
VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(host_id) DO UPDATE SET enabled=EXCLUDED.enabled,cpu_millis=EXCLUDED.cpu_millis,memory_bytes=EXCLUDED.memory_bytes,storage_bytes=EXCLUDED.storage_bytes,max_environments=EXCLUDED.max_environments RETURNING *;

-- name: HostStatus :one
SELECT id,architecture,status,last_seen_at,report FROM engine_hosts WHERE id=$1 FOR UPDATE;

-- name: ListHosts :many
SELECT h.*,e.architecture,e.status,e.last_seen_at FROM environment_hosts h JOIN engine_hosts e ON e.id=h.host_id ORDER BY h.host_id LIMIT $1 OFFSET $2;

-- name: AvailableHosts :many
SELECT h.*,e.architecture FROM environment_hosts h JOIN engine_hosts e ON e.id=h.host_id
WHERE h.enabled AND h.protocol=1 AND h.sync_at>now()-interval '90 seconds' AND e.status='active'
AND (NOT sqlc.arg(runtime_required)::boolean OR e.report->>'runtime_protocol'='1')
AND e.last_seen_at>now()-interval '90 seconds' AND e.report->>'prerequisites_met'='true' AND e.architecture=$1
AND (sqlc.arg(network_policy)::text='isolated' OR (jsonb_typeof(e.report->'network_policies')='array' AND (e.report->'network_policies') ? sqlc.arg(network_policy)::text))
ORDER BY h.host_id;

-- name: GetHost :one
SELECT * FROM environment_hosts WHERE host_id=$1;

-- name: TouchHost :exec
INSERT INTO environment_hosts(host_id,enabled,cpu_millis,memory_bytes,storage_bytes,max_environments,protocol,sync_at)
VALUES($1,false,0,0,0,0,1,now()) ON CONFLICT(host_id) DO UPDATE SET protocol=1,sync_at=now();

-- name: GetQuota :one
SELECT * FROM environment_quotas WHERE user_id=$1;

-- name: SetQuota :one
INSERT INTO environment_quotas(user_id,max_environments,max_running,cpu_millis,memory_bytes,storage_bytes)
VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id) DO UPDATE SET max_environments=EXCLUDED.max_environments,max_running=EXCLUDED.max_running,cpu_millis=EXCLUDED.cpu_millis,memory_bytes=EXCLUDED.memory_bytes,storage_bytes=EXCLUDED.storage_bytes RETURNING *;

-- name: ActiveUser :one
SELECT id FROM users WHERE id=$1 AND status='active';

-- name: UserUsage :one
SELECT count(*) FILTER(WHERE desired<>'deleted')::bigint AS environments,
count(*) FILTER(WHERE compute_reserved)::bigint AS running,
COALESCE(sum(cpu_millis) FILTER(WHERE compute_reserved),0)::bigint AS cpu_millis,
COALESCE(sum(memory_bytes) FILTER(WHERE compute_reserved),0)::bigint AS memory_bytes,
COALESCE(sum(storage_bytes),0)::bigint AS storage_bytes FROM environments WHERE user_id=$1;

-- name: HostUsage :one
SELECT count(*) FILTER(WHERE desired<>'deleted')::bigint AS environments,
COALESCE(sum(cpu_millis) FILTER(WHERE compute_reserved),0)::bigint AS cpu_millis,
COALESCE(sum(memory_bytes) FILTER(WHERE compute_reserved),0)::bigint AS memory_bytes,
COALESCE(sum(storage_bytes),0)::bigint AS storage_bytes FROM environments WHERE host_id=$1;

-- name: FindCreation :one
SELECT * FROM environments WHERE user_id=$1 AND request_key=$2;

-- name: CreateEnvironment :one
INSERT INTO environments(id,user_id,host_id,preset_id,name,generation,instance_id,desired,spec,cpu_millis,memory_bytes,storage_bytes,request_key,request_hash)
VALUES($1,$2,$3,$4,$5,1,$6,'running',$7,$8,$9,$10,$11,$12) RETURNING *;

-- name: GetEnvironment :one
SELECT * FROM environments WHERE id=$1 AND (user_id=sqlc.narg(user_id)::uuid OR sqlc.narg(user_id)::uuid IS NULL);

-- name: ListEnvironments :many
SELECT * FROM environments WHERE user_id=sqlc.narg(user_id)::uuid OR sqlc.narg(user_id)::uuid IS NULL ORDER BY created_at DESC,id DESC LIMIT $1 OFFSET $2;

-- name: ChangeTarget :one
UPDATE environments SET generation=generation+1,instance_id=$2,desired=$3,spec=$4,
compute_reserved=compute_reserved OR $3='running',updated_at=now() WHERE id=$1 RETURNING *;

-- name: CreateOperation :one
INSERT INTO environment_operations(environment_id,generation,desired,request_key,request_hash) VALUES($1,$2,$3,$4,$5) RETURNING *;

-- name: FindOperation :one
SELECT * FROM environment_operations WHERE environment_id=$1 AND request_key=$2;

-- name: ListOperations :many
SELECT * FROM environment_operations WHERE environment_id=$1 ORDER BY generation DESC LIMIT $2 OFFSET $3;

-- name: SupersedeOperations :exec
UPDATE environment_operations SET status='superseded',finished_at=now() WHERE environment_id=$1 AND status='pending';

-- name: CompleteOperation :exec
UPDATE environment_operations SET status=$3,reason=$4,finished_at=now() WHERE environment_id=$1 AND generation=$2 AND status='pending';

-- name: ReportState :execrows
UPDATE environments SET phase=$5,reason=$6,observed_generation=$4,observed_at=now(),updated_at=now(),
compute_reserved=CASE WHEN $5 IN ('stopped','deleted') THEN false ELSE compute_reserved END
WHERE id=$1 AND host_id=$2 AND instance_id=$3 AND generation=$4;

-- name: HostEnvironment :one
SELECT * FROM environments WHERE id=$1 AND host_id=$2;

-- name: Targets :many
SELECT * FROM environments WHERE host_id=$1 AND id>sqlc.arg(cursor)::uuid
AND NOT(desired='deleted' AND phase='deleted' AND observed_generation=generation)
ORDER BY id LIMIT 16;

-- name: InactiveTargets :many
SELECT e.* FROM environments e JOIN users u ON e.user_id=u.id
WHERE e.host_id=$1 AND e.desired='running' AND u.status<>'active' ORDER BY e.id LIMIT 16;

-- name: RuntimeBinding :one
SELECT * FROM environment_runtime WHERE environment_id=$1;

-- name: BindRuntime :exec
INSERT INTO environment_runtime(environment_id,machine_id,public_key,instance_id,generation,request_id)
VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(environment_id) DO UPDATE
SET instance_id=EXCLUDED.instance_id,generation=EXCLUDED.generation,request_id=EXCLUDED.request_id;

-- name: RuntimeAccess :one
SELECT NOT EXISTS(SELECT 1 FROM environment_runtime r0 WHERE r0.machine_id=sqlc.arg(machine_id)::uuid) OR EXISTS(
 SELECT 1 FROM environment_runtime r JOIN environments e ON e.id=r.environment_id
 JOIN users u ON u.id=e.user_id JOIN engine_hosts h ON h.id=e.host_id
 WHERE r.machine_id=sqlc.arg(machine_id)::uuid AND e.user_id=sqlc.arg(user_id)::uuid AND e.desired='running' AND e.phase<>'failed'
 AND e.generation=r.generation AND e.instance_id=r.instance_id AND u.status='active' AND h.status='active'
) AS allowed;

-- name: RuntimeOperation :one
SELECT * FROM environment_operations WHERE environment_id=$1 AND generation=$2;

-- name: LockRuntimeEnvironment :many
SELECT e.id FROM environment_runtime r JOIN environments e ON e.id=r.environment_id WHERE r.machine_id=$1 FOR SHARE OF e;
