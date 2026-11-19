-- name: SpecificationRevision :one
SELECT revision FROM environment_specification_catalog WHERE singleton;

-- name: AdvanceSpecificationRevision :exec
UPDATE environment_specification_catalog SET revision=revision+1 WHERE singleton;

-- name: ListSpecifications :many
SELECT id,version,cpu_millis,memory_bytes FROM environment_specifications WHERE deleted_at IS NULL ORDER BY position,id;

-- name: GetSpecification :one
SELECT id,version,cpu_millis,memory_bytes FROM environment_specifications WHERE id=$1 AND deleted_at IS NULL;

-- name: SpecificationExists :one
SELECT EXISTS(SELECT 1 FROM environment_specifications WHERE id=$1);

-- name: RetireSpecifications :exec
UPDATE environment_specifications SET deleted_at=now() WHERE deleted_at IS NULL;

-- name: InsertSpecification :exec
INSERT INTO environment_specifications(id,cpu_millis,memory_bytes,position) VALUES($1,$2,$3,$4);

-- name: UpdateSpecification :one
UPDATE environment_specifications SET
 version=version+CASE WHEN cpu_millis<>$2 OR memory_bytes<>$3 THEN 1 ELSE 0 END,
 cpu_millis=$2,memory_bytes=$3,position=$4,deleted_at=NULL WHERE id=$1 RETURNING version;

-- name: LockControl :exec
SELECT pg_advisory_xact_lock(129678,hashtext(current_schema() || ':environments'));

-- name: HostStatus :one
SELECT id,architecture,status,last_seen_at,report FROM hosts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE;

-- name: ListHosts :many
SELECT id AS host_id,enabled,exchange_protocol AS protocol,environment_synced_at AS sync_at,architecture,status,last_seen_at,report FROM hosts WHERE deleted_at IS NULL ORDER BY id LIMIT $1 OFFSET $2;

-- name: AvailableHosts :many
SELECT h.id AS host_id,h.architecture,h.report,
 (SELECT count(*) FROM environments e WHERE e.host_id=h.id AND NOT(e.desired='deleted' AND e.phase='deleted' AND e.observed_generation=e.generation))::bigint AS environment_count
FROM hosts h JOIN host_environment_configs c ON c.host_id=h.id
WHERE h.enabled AND h.exchange_protocol=1 AND h.environment_synced_at>now()-interval '90 seconds' AND h.status='active' AND h.deleted_at IS NULL
AND (NOT sqlc.arg(runtime_required)::boolean OR h.report->>'runtime_protocol'='1')
AND h.last_seen_at>now()-interval '90 seconds' AND h.report->>'prerequisites_met'='true' AND h.architecture IN ('amd64','arm64')
AND (sqlc.arg(network_policy)::text='isolated' OR (jsonb_typeof(h.report->'network_policies')='array' AND (h.report->'network_policies') ? sqlc.arg(network_policy)::text))
ORDER BY h.id;

-- name: GetHost :one
SELECT id AS host_id,enabled,exchange_protocol AS protocol,environment_synced_at AS sync_at FROM hosts WHERE id=$1;

-- name: TouchHost :execrows
UPDATE hosts SET exchange_protocol=1,environment_synced_at=$2 WHERE id=$1 AND (environment_synced_at IS NULL OR environment_synced_at<$2);

-- name: ActiveUser :one
SELECT id FROM users WHERE id=$1 AND status='active' AND deleted_at IS NULL;

-- name: UserUsage :one
SELECT count(*)::bigint AS environments FROM environments WHERE user_id=$1 AND NOT(desired='deleted' AND phase='deleted' AND observed_generation=generation);

-- name: HostUsage :one
SELECT count(*)::bigint AS environments FROM environments WHERE host_id=$1 AND NOT(desired='deleted' AND phase='deleted' AND observed_generation=generation);

-- name: FindCreation :one
SELECT * FROM environment_operations WHERE user_id=$1 AND request_key=$2 AND kind='create';

-- name: CreateEnvironment :one
INSERT INTO environments(id,user_id,host_id,name,generation,instance_id,desired,spec,cpu_millis,memory_bytes)
VALUES($1,$2,$3,$4,1,$5,'running',$6,$7,$8) RETURNING *;

-- name: CreateRuntime :exec
INSERT INTO environment_runtimes(environment_id) VALUES($1);

-- name: GetRuntime :one
SELECT * FROM environment_runtimes WHERE environment_id=$1;

-- name: ListRuntimes :many
SELECT * FROM environment_runtimes WHERE environment_id=ANY(sqlc.arg(ids)::uuid[]);

-- name: GetEnvironment :one
SELECT * FROM environments WHERE id=$1 AND (user_id=sqlc.narg(user_id)::uuid OR sqlc.narg(user_id)::uuid IS NULL);

-- name: ListEnvironments :many
SELECT e.* FROM environments e
CROSS JOIN LATERAL (
 SELECT CASE WHEN e.archived_at IS NOT NULL THEN 'deleted' WHEN e.generation<>e.observed_generation THEN 'pending_' || e.desired ELSE e.phase END AS state,
 CASE WHEN e.desired='running' AND e.phase='running' AND e.generation=e.observed_generation
   AND (e.usage->>'at')::timestamptz >= now()-interval '90 seconds'
 THEN (e.usage->>'cpu_cores')::double precision END AS cpu_usage,
 CASE WHEN e.desired='running' AND e.phase='running' AND e.generation=e.observed_generation
   AND (e.usage->>'at')::timestamptz >= now()-interval '90 seconds'
 THEN (e.usage->>'memory_bytes')::bigint END AS memory_usage
) metrics
WHERE (e.user_id=sqlc.narg(user_id)::uuid OR sqlc.narg(user_id)::uuid IS NULL)
AND (e.host_id=sqlc.narg(host_id)::uuid OR sqlc.narg(host_id)::uuid IS NULL)
AND (sqlc.arg(include_deleted)::boolean OR (e.deleted_at IS NULL AND e.archived_at IS NULL))
AND (sqlc.arg(status)::text='all'
 OR (sqlc.arg(status)::text='active' AND metrics.state<>'deleted')
 OR metrics.state=sqlc.arg(status)::text)
ORDER BY
 CASE WHEN sqlc.arg(sort)::text='cpu_desc' THEN metrics.cpu_usage END DESC NULLS LAST,
 CASE WHEN sqlc.arg(sort)::text='cpu_asc' THEN metrics.cpu_usage END ASC NULLS LAST,
 CASE WHEN sqlc.arg(sort)::text='memory_desc' THEN metrics.memory_usage END DESC NULLS LAST,
 CASE WHEN sqlc.arg(sort)::text='memory_asc' THEN metrics.memory_usage END ASC NULLS LAST,
 e.created_at DESC,e.id DESC LIMIT $1 OFFSET $2;

-- name: ArchiveOfflineDeletions :exec
UPDATE environments e SET archived_at=now() FROM hosts h
WHERE e.host_id=h.id AND e.desired='deleted' AND e.archived_at IS NULL AND e.generation<>e.observed_generation
AND (h.status<>'active' OR h.last_seen_at IS NULL OR h.last_seen_at<=now()-interval '90 seconds');

-- name: ChangeTarget :one
UPDATE environments SET generation=generation+1,instance_id=$2,desired=$3,spec=$4,usage=NULL,deleted_at=NULL,archived_at=NULL,
billing_stop_reason=CASE WHEN $3='running' THEN '' ELSE billing_stop_reason END,updated_at=now() WHERE id=$1 RETURNING *;

-- name: CreateOperation :one
INSERT INTO environment_operations(environment_id,user_id,generation,desired,kind,request_key,request_hash)
SELECT e.id,e.user_id,sqlc.arg(generation)::bigint,sqlc.arg(desired)::text,CASE WHEN sqlc.arg(generation)::bigint=1 THEN 'create' ELSE 'lifecycle' END,sqlc.arg(request_key)::text,sqlc.arg(request_hash)::text FROM environments e WHERE e.id=sqlc.arg(environment_id) RETURNING *;

-- name: CreateRuntimeUpgradeOperation :one
INSERT INTO environment_operations(environment_id,user_id,generation,desired,kind,target_version,request_key,request_hash)
SELECT e.id,e.user_id,sqlc.arg(generation)::bigint,'stopped','runtime_upgrade',sqlc.arg(target_version)::text,sqlc.arg(request_key)::text,sqlc.arg(request_hash)::text FROM environments e WHERE e.id=sqlc.arg(environment_id) RETURNING *;

-- name: FindOperation :one
SELECT * FROM environment_operations WHERE environment_id=$1 AND request_key=$2;

-- name: ListOperations :many
SELECT * FROM environment_operations WHERE environment_id=$1 ORDER BY generation DESC LIMIT $2 OFFSET $3;

-- name: SupersedeOperations :exec
UPDATE environment_operations SET status='superseded',finished_at=now() WHERE environment_id=$1 AND status='pending';

-- name: CompleteOperation :exec
UPDATE environment_operations SET status=$3,reason=$4,finished_at=now() WHERE environment_id=$1 AND generation=$2 AND status='pending';

-- name: ReportState :execrows
UPDATE environments SET phase=$5,reason=$6,observed_generation=$4,observed_at=sqlc.arg(observed_at)::timestamptz,updated_at=now(),usage=$7,archived_at=NULL,
deleted_at=CASE WHEN desired='deleted' AND $5='deleted' THEN COALESCE(deleted_at,now()) ELSE NULL END
WHERE id=$1 AND host_id=$2 AND instance_id=$3 AND generation=$4;

-- name: ReportRuntimeVersion :exec
UPDATE environment_runtimes SET runtime_version=$2 WHERE environment_id=$1 AND $2<>'';

-- name: HostEnvironment :one
SELECT * FROM environments WHERE id=$1 AND host_id=$2;

-- name: Targets :many
SELECT * FROM environments WHERE host_id=$1 AND id>sqlc.arg(cursor)::uuid
AND NOT(desired='deleted' AND phase='deleted' AND observed_generation=generation)
ORDER BY id LIMIT 16;

-- name: InactiveTargets :many
SELECT e.* FROM environments e JOIN users u ON e.user_id=u.id
WHERE e.host_id=$1 AND e.desired='running' AND (u.status<>'active' OR u.deleted_at IS NOT NULL) ORDER BY e.id LIMIT 16;

-- name: BindRuntime :execrows
UPDATE environment_runtimes r SET machine_id=COALESCE(r.machine_id,sqlc.arg(machine_id)::uuid),public_key=COALESCE(r.public_key,sqlc.arg(public_key)::bytea),
instance_id=sqlc.arg(instance_id)::uuid,generation=sqlc.arg(generation)::bigint
FROM environments e WHERE r.environment_id=e.id AND e.id=sqlc.arg(environment_id)::uuid AND e.generation=sqlc.arg(generation)::bigint AND e.instance_id=sqlc.arg(instance_id)::uuid
AND (r.machine_id IS NULL OR r.machine_id=sqlc.arg(machine_id)::uuid) AND (r.public_key IS NULL OR r.public_key=sqlc.arg(public_key)::bytea);

-- name: RuntimeAccess :one
SELECT NOT EXISTS(SELECT 1 FROM environment_runtimes WHERE machine_id=sqlc.arg(machine_id)::uuid) OR EXISTS(
 SELECT 1 FROM environments e JOIN environment_runtimes r ON r.environment_id=e.id JOIN users u ON u.id=e.user_id JOIN hosts h ON h.id=e.host_id
 WHERE r.machine_id=sqlc.arg(machine_id)::uuid AND e.user_id=sqlc.arg(user_id)::uuid AND e.desired='running' AND e.phase<>'failed'
 AND e.generation=r.generation AND e.instance_id=r.instance_id AND u.status='active' AND u.deleted_at IS NULL AND h.status='active'
 AND (
  (COALESCE(((SELECT value->'environment' FROM settings WHERE key='billing')->>'cpu_credits_per_core_hour')::numeric,100)=0 AND COALESCE(((SELECT value->'environment' FROM settings WHERE key='billing')->>'memory_credits_per_gib_hour')::numeric,50)=0)
  OR EXISTS(SELECT 1 FROM environment_billing_periods p WHERE p.environment_id=e.id AND p.prepaid_until>now() AND p.started_at<=now())
 )
) AS allowed;

-- name: RuntimeOperation :one
SELECT * FROM environment_operations WHERE environment_id=$1 AND generation=$2;

-- name: LockRuntimeEnvironment :many
SELECT e.id FROM environments e JOIN environment_runtimes r ON r.environment_id=e.id WHERE r.machine_id=$1 FOR SHARE OF e,r;

-- name: EnvironmentIdentities :many
SELECT e.id, u.name AS user_name, u.email AS user_email,
COALESCE(NULLIF(u.custom_avatar_url, ''), u.avatar_url, '')::text AS user_avatar,
h.name AS host_name, COALESCE(h.report->'system'->>'hostname', '')::text AS hostname,
COALESCE(h.report->'system'->>'os_name', '')::text AS os_name
FROM environments e JOIN users u ON u.id=e.user_id JOIN hosts h ON h.id=e.host_id
WHERE e.id=ANY(sqlc.arg(ids)::uuid[]);

-- name: SetScheduling :one
UPDATE hosts SET enabled=sqlc.arg(enabled) WHERE id=sqlc.arg(host_id) RETURNING id AS host_id,enabled;

-- name: LockEnvironment :one
SELECT * FROM environments WHERE id=$1 AND (user_id=sqlc.narg(user_id)::uuid OR sqlc.narg(user_id)::uuid IS NULL) FOR UPDATE;

-- name: LockHostEnvironment :one
SELECT * FROM environments WHERE id=$1 AND host_id=$2 FOR UPDATE;

-- name: OpenBillingPeriod :one
INSERT INTO environment_billing_periods(environment_id,user_id,generation,pricing,cpu_millis,memory_bytes,started_at,confirmed_until)
VALUES($1,$2,$3,$4,$5,$6,$7,$7) RETURNING *;

-- name: LockOpenBillingPeriod :one
SELECT * FROM environment_billing_periods WHERE environment_id=$1 AND closed_at IS NULL FOR UPDATE;

-- name: ConfirmBillingPeriod :one
UPDATE environment_billing_periods SET confirmed_until=GREATEST(confirmed_until,$2) WHERE id=$1 RETURNING *;

-- name: CloseBillingPeriod :one
UPDATE environment_billing_periods SET closed_at=confirmed_until WHERE id=$1 RETURNING *;

-- name: CloseUserBillingPeriods :exec
UPDATE environment_billing_periods SET closed_at=confirmed_until WHERE user_id=$1 AND closed_at IS NULL AND prepaid_until IS NULL;

-- name: BillingUsers :many
SELECT user_id FROM environment_billing_periods WHERE prepaid_until IS NULL AND (settled_seconds<EXTRACT(EPOCH FROM confirmed_until-started_at)
 OR (closed_at IS NULL AND confirmed_until<$1))
UNION SELECT e.user_id FROM environments e JOIN host_environment_configs c ON c.host_id=e.host_id WHERE e.desired='running'
  AND (COALESCE(((SELECT value->'environment' FROM settings WHERE key='billing')->>'cpu_credits_per_core_hour')::numeric,100)>0 OR COALESCE(((SELECT value->'environment' FROM settings WHERE key='billing')->>'memory_credits_per_gib_hour')::numeric,50)>0)
ORDER BY user_id;

-- name: PendingBillingPeriods :many
SELECT * FROM environment_billing_periods
WHERE prepaid_until IS NULL AND user_id=sqlc.arg(user_id) AND (NOT sqlc.arg(closed_only)::boolean OR closed_at IS NOT NULL)
AND (settled_seconds<EXTRACT(EPOCH FROM confirmed_until-started_at)
 OR (closed_at IS NULL AND confirmed_until<sqlc.arg(stale_at)))
ORDER BY started_at,id LIMIT 128 FOR UPDATE;

-- name: SetBillingSettlement :exec
UPDATE environment_billing_periods SET settled_seconds=$2,settled_amount=$3 WHERE id=$1;

-- name: BillingEnvironment :one
SELECT * FROM environments WHERE id=$1;

-- name: UserBillingPeriods :many
SELECT * FROM environment_billing_periods WHERE user_id=$1 AND closed_at IS NULL AND confirmed_until>=$2 ORDER BY id;

-- name: BillingSummaries :many
SELECT environment_id,COALESCE(sum(settled_amount),0)::text AS amount,
 COALESCE(sum(settled_seconds),0)::bigint AS seconds,bool_or(closed_at IS NULL) AS running,COALESCE(max(prepaid_until),'epoch'::timestamptz)::timestamptz AS prepaid_until
FROM environment_billing_periods WHERE environment_id=ANY(sqlc.arg(ids)::uuid[]) GROUP BY environment_id;

-- name: GlobalEnvironmentPricing :one
SELECT ('{"cpu_credits_per_core_hour":"100","memory_credits_per_gib_hour":"50"}'::jsonb || COALESCE((SELECT value->'environment' FROM settings WHERE key='billing'),'{}'::jsonb))::jsonb AS billing;

-- name: HostSetup :one
SELECT h.id,h.name,h.architecture,h.status,c.resource,
('{"cpu_credits_per_core_hour":"100","memory_credits_per_gib_hour":"50"}'::jsonb || COALESCE((SELECT value->'environment' FROM settings WHERE key='billing'),'{}'::jsonb))::jsonb AS billing
FROM hosts h LEFT JOIN host_environment_configs c ON c.host_id=h.id WHERE h.id=$1 AND h.deleted_at IS NULL;

-- name: SetHostName :exec
UPDATE hosts SET name=$2 WHERE id=$1;

-- name: SetHostSetup :exec
INSERT INTO host_environment_configs(host_id) VALUES($1)
ON CONFLICT(host_id) DO NOTHING;

-- name: CloseHostBillingPeriods :exec
UPDATE environment_billing_periods p SET closed_at=confirmed_until FROM environments e WHERE p.environment_id=e.id AND e.host_id=$1 AND p.closed_at IS NULL AND p.prepaid_until IS NULL;

-- name: UserEnvironmentHosts :many
SELECT DISTINCT c.host_id,('{"cpu_credits_per_core_hour":"100","memory_credits_per_gib_hour":"50"}'::jsonb || COALESCE((SELECT value->'environment' FROM settings WHERE key='billing'),'{}'::jsonb))::jsonb AS billing FROM host_environment_configs c JOIN environments e ON e.host_id=c.host_id WHERE e.user_id=$1;

-- name: BilledUserEnvironments :many
SELECT e.* FROM environments e JOIN host_environment_configs c ON c.host_id=e.host_id WHERE e.user_id=$1 AND e.desired='running'
  AND (COALESCE(((SELECT value->'environment' FROM settings WHERE key='billing')->>'cpu_credits_per_core_hour')::numeric,100)>0 OR COALESCE(((SELECT value->'environment' FROM settings WHERE key='billing')->>'memory_credits_per_gib_hour')::numeric,50)>0)
ORDER BY e.id FOR UPDATE OF e;

-- name: AccessibleHostCandidates :many
SELECT h.id,h.name,h.architecture,h.status,h.enabled,h.last_seen_at,h.environment_synced_at,h.report,('{"cpu_credits_per_core_hour":"100","memory_credits_per_gib_hour":"50"}'::jsonb || COALESCE((SELECT value->'environment' FROM settings WHERE key='billing'),'{}'::jsonb))::jsonb AS billing
FROM hosts h JOIN host_environment_configs c ON c.host_id=h.id WHERE h.deleted_at IS NULL ORDER BY h.id;

-- name: PaidBillingHour :one
SELECT * FROM environment_billing_periods
WHERE environment_id=$1 AND prepaid_until>$2 AND started_at<=$2
ORDER BY prepaid_until DESC LIMIT 1;

-- name: OpenPrepaidBillingHour :one
INSERT INTO environment_billing_periods(environment_id,user_id,generation,pricing,cpu_millis,memory_bytes,started_at,confirmed_until,prepaid_until)
VALUES($1,$2,$3,$4,$5,$6,sqlc.arg(started_at)::timestamptz,sqlc.arg(started_at)::timestamptz,sqlc.arg(started_at)::timestamptz+interval '1 hour') RETURNING *;

-- name: UserPaidBillingHours :many
SELECT DISTINCT ON(p.environment_id) p.* FROM environment_billing_periods p
JOIN environments e ON e.id=p.environment_id
JOIN host_environment_configs c ON c.host_id=e.host_id
WHERE p.user_id=$1 AND p.prepaid_until>$2 AND p.started_at<=$2 AND e.desired='running' AND e.phase<>'failed'
AND (COALESCE(((SELECT value->'environment' FROM settings WHERE key='billing')->>'cpu_credits_per_core_hour')::numeric,100)>0 OR COALESCE(((SELECT value->'environment' FROM settings WHERE key='billing')->>'memory_credits_per_gib_hour')::numeric,50)>0)
ORDER BY p.environment_id,p.prepaid_until DESC;

-- name: NextBillingExpiry :one
SELECT COALESCE(min(p.prepaid_until),sqlc.arg(at)::timestamptz+interval '1 minute')::timestamptz AS expires_at
FROM environment_billing_periods p JOIN environments e ON e.id=p.environment_id
JOIN host_environment_configs c ON c.host_id=e.host_id
WHERE e.desired='running' AND p.prepaid_until>sqlc.arg(at)::timestamptz;

-- name: SetBillingStopReason :exec
UPDATE environments SET billing_stop_reason=$2 WHERE id=$1;
