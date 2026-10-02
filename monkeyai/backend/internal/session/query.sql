-- name: GetSession :one
SELECT jsonb_build_object(
 'id',id,'owner_user_id',owner_user_id,'group_id',group_id,'parent_session_id',parent_session_id,
 'model_id',model_id,'device_id',device_id,'title',title,'session_type',session_type,
 'client_type',client_type,'client_name',client_name,'started_at',started_at,
 'last_active_at',last_active_at,'ended_at',ended_at,'deleted_at',deleted_at,'purged_at',purged_at,
 'placeholder',placeholder,'started_provis',started_at_provisional,'clock_suspect',clock_suspect,
 'state_seq',state_seq,'state_hash',encode(state_hash,'base64'),'state_received_at',state_received_at,
 'resources_id',resources_snapshot_id,'acked_turn',acked_turn,'facts_version',facts_version,
 'last_stop_reason',last_stop_reason,'active_seconds',active_seconds,
 'client_deleted_at',client_deleted_at,'reporting_enabled_at',reporting_enabled_at
) AS data FROM sessions WHERE id = $1::uuid;

-- name: LockSession :one
SELECT jsonb_build_object(
 'id',id,'owner_user_id',owner_user_id,'group_id',group_id,'parent_session_id',parent_session_id,
 'model_id',model_id,'device_id',device_id,'title',title,'session_type',session_type,
 'client_type',client_type,'client_name',client_name,'started_at',started_at,
 'last_active_at',last_active_at,'ended_at',ended_at,'deleted_at',deleted_at,'purged_at',purged_at,
 'placeholder',placeholder,'started_provis',started_at_provisional,'clock_suspect',clock_suspect,
 'state_seq',state_seq,'state_hash',encode(state_hash,'base64'),'state_received_at',state_received_at,
 'resources_id',resources_snapshot_id,'acked_turn',acked_turn,'facts_version',facts_version,
 'last_stop_reason',last_stop_reason,'active_seconds',active_seconds,
 'client_deleted_at',client_deleted_at,'reporting_enabled_at',reporting_enabled_at
) AS data FROM sessions WHERE id = $1::uuid FOR UPDATE;

-- name: GetParent :one
SELECT jsonb_build_object('owner',owner_user_id,'parent',parent_session_id,'purged',purged_at,'deleted',deleted_at) AS data
FROM sessions WHERE id = $1::uuid;

-- name: LockReportingUser :one
SELECT id::text FROM users WHERE id = $1::uuid FOR UPDATE;

-- name: CountOpenPlaceholders :one
SELECT count(*) FROM sessions
WHERE owner_user_id = $1::uuid AND placeholder = true
  AND deleted_at IS NULL AND purged_at IS NULL;

-- name: CurrentSessionGroup :one
SELECT COALESCE(
    (SELECT s.group_id::text FROM sessions s
     WHERE s.id = NULLIF(sqlc.arg(parent_id)::text, '')::uuid
       AND s.owner_user_id = sqlc.arg(user_id)::uuid),
    (SELECT a.group_id::text FROM credit_accounts a
     WHERE a.user_id = sqlc.arg(user_id)::uuid
       AND a.period_start_at <= now() AND a.period_end_at > now()
       AND a.group_id IS NOT NULL
     ORDER BY a.period_start_at DESC LIMIT 1),
    (SELECT CASE WHEN count(*) = 1 THEN min(g.id::text) END
     FROM group_users gu JOIN groups g ON g.id = gu.group_id AND g.deleted_at IS NULL
     WHERE gu.user_id = sqlc.arg(user_id)::uuid AND gu.removed_at IS NULL),
    ''
)::text AS group_id;

-- name: InsertPlaceholder :exec
INSERT INTO sessions (
 id,owner_user_id,group_id,parent_session_id,title,session_type,client_type,client_name,
 device_id,started_at,last_active_at,placeholder,started_at_provisional,reporting_enabled_at
) VALUES (
 sqlc.arg(id)::uuid,sqlc.arg(owner_user_id)::uuid,NULLIF(sqlc.arg(group_id)::text,'')::uuid,
 NULLIF(sqlc.arg(parent_session_id)::text,'')::uuid,'','conversation','unknown','',
 NULLIF(sqlc.arg(machine_id)::text,''),sqlc.arg(started_at)::timestamptz,NULL,true,true,now()
) ON CONFLICT (id) DO NOTHING;

-- name: ClaimSession :exec
UPDATE sessions SET
 parent_session_id=COALESCE(parent_session_id,NULLIF(sqlc.arg(parent_id)::text,'')::uuid),
 group_id=COALESCE(group_id,NULLIF(sqlc.arg(group_id)::text,'')::uuid),
 device_id=COALESCE(device_id,NULLIF(sqlc.arg(machine_id)::text,'')),updated_at=now()
WHERE id=sqlc.arg(id)::uuid;

-- name: SetState :exec
UPDATE sessions SET state_seq=(sqlc.arg(payload)::jsonb->>'state_seq')::bigint,
 state_hash=decode(sqlc.arg(payload)::jsonb->>'state_hash','hex'),
 state_received_at=(sqlc.arg(payload)::jsonb->>'received_at')::timestamptz,
 updated_at=(sqlc.arg(payload)::jsonb->>'received_at')::timestamptz
WHERE id=(sqlc.arg(payload)::jsonb->>'id')::uuid;

-- name: SaveSession :exec
UPDATE sessions SET
 session_type=sqlc.arg(payload)::jsonb->>'session_type',
 client_type=sqlc.arg(payload)::jsonb->>'client_type',
 client_name=sqlc.arg(payload)::jsonb->>'client_type',
 client_version=sqlc.arg(payload)::jsonb->>'client_version',
 engine_version=sqlc.arg(payload)::jsonb->>'engine_version',
 runtime_version=sqlc.arg(payload)::jsonb->>'runtime_version',
 expert_id=NULLIF(sqlc.arg(payload)::jsonb->>'expert_id','')::uuid,
 model_id=NULLIF(sqlc.arg(payload)::jsonb->>'model_id','')::uuid,
 mode=sqlc.arg(payload)::jsonb->>'mode',
 workspace_kind=sqlc.arg(payload)::jsonb->>'workspace_kind',
 started_at=(sqlc.arg(payload)::jsonb->>'started_at')::timestamptz,
 client_deleted_at=(sqlc.arg(payload)::jsonb->>'client_deleted_at')::timestamptz,
 placeholder=false,started_at_provisional=false,
 reporting_enabled_at=COALESCE(reporting_enabled_at,(sqlc.arg(payload)::jsonb->>'received_at')::timestamptz),
 updated_at=(sqlc.arg(payload)::jsonb->>'received_at')::timestamptz
WHERE id=(sqlc.arg(payload)::jsonb->>'id')::uuid;

-- name: GetTurnHash :one
SELECT report_hash FROM session_turns WHERE session_id=$1::uuid AND turn_index=$2 FOR UPDATE;

-- name: ListTurnIndexes :many
SELECT turn_index FROM session_turns WHERE session_id=$1::uuid ORDER BY turn_index;

-- name: ListTurnFacts :many
SELECT jsonb_build_object(
 'turn_index',turn_index,'started_at',started_at,'ended_at',ended_at,
 'stop_reason',stop_reason,'facts_version',facts_version,
 'resources_snapshot_id',resources_snapshot_id,'error_code',error_code
) AS data FROM session_turns WHERE session_id=$1::uuid ORDER BY turn_index;

-- name: SaveSnapshot :exec
INSERT INTO session_resource_snapshots(session_id,snapshot_id,revision,state_version,items)
VALUES ((sqlc.arg(payload)::jsonb->>'session_id')::uuid,sqlc.arg(payload)::jsonb->>'snapshot_id',
 (sqlc.arg(payload)::jsonb->>'revision')::bigint,(sqlc.arg(payload)::jsonb->>'state_version')::bigint,
 sqlc.arg(payload)::jsonb->'items')
ON CONFLICT (session_id,snapshot_id) DO NOTHING;

-- name: GetSnapshotItems :one
SELECT items FROM session_resource_snapshots WHERE session_id=$1::uuid AND snapshot_id=$2;

-- name: SaveSnapshotItem :exec
INSERT INTO session_resource_snapshot_items
SELECT (jsonb_populate_record(NULL::session_resource_snapshot_items,sqlc.arg(payload)::jsonb)).*
ON CONFLICT (session_id,snapshot_id,resource_id) DO NOTHING;

-- name: HasSnapshot :one
SELECT EXISTS(SELECT 1 FROM session_resource_snapshots WHERE session_id=$1::uuid AND snapshot_id=$2);

-- name: SaveTurn :exec
INSERT INTO session_turns
SELECT (jsonb_populate_record(NULL::session_turns,sqlc.arg(payload)::jsonb)).*;

-- name: SaveTool :exec
INSERT INTO session_turn_tools
SELECT (jsonb_populate_record(NULL::session_turn_tools,sqlc.arg(payload)::jsonb)).*;

-- name: SaveSkillEvent :exec
INSERT INTO session_skill_events
SELECT (jsonb_populate_record(NULL::session_skill_events,sqlc.arg(payload)::jsonb)).*;

-- name: RecomputeSession :exec
UPDATE sessions SET
 turn_count=(sqlc.arg(payload)::jsonb->>'turn_count')::integer,
 acked_turn=(sqlc.arg(payload)::jsonb->>'acked_turn')::integer,
 active_seconds=(sqlc.arg(payload)::jsonb->>'active_seconds')::bigint,
 started_at=CASE WHEN started_at_provisional AND
 (sqlc.arg(payload)::jsonb->>'first_started')::timestamptz < started_at
 THEN (sqlc.arg(payload)::jsonb->>'first_started')::timestamptz ELSE started_at END,
 last_active_at=(sqlc.arg(payload)::jsonb->>'last_active_at')::timestamptz,
 ended_at=(sqlc.arg(payload)::jsonb->>'ended_at')::timestamptz,
 facts_version=NULLIF((sqlc.arg(payload)::jsonb->>'facts_version')::integer,0),
 failure_code=sqlc.arg(payload)::jsonb->>'failure_code',
 last_stop_reason=NULLIF(sqlc.arg(payload)::jsonb->>'last_stop_reason',''),
 resources_snapshot_id=NULLIF(sqlc.arg(payload)::jsonb->>'resources_snapshot_id',''),
 reporting_enabled_at=COALESCE(reporting_enabled_at,(sqlc.arg(payload)::jsonb->>'received_at')::timestamptz),
 updated_at=(sqlc.arg(payload)::jsonb->>'received_at')::timestamptz
WHERE id=(sqlc.arg(payload)::jsonb->>'id')::uuid;

-- name: SessionStats :one
SELECT jsonb_build_object(
 'turns',(SELECT count(*) FROM session_turns WHERE session_id=$1::uuid),
 'tools',(SELECT count(*) FROM session_turn_tools WHERE session_id=$1::uuid),
 'skill_events',(SELECT count(*) FROM session_skill_events WHERE session_id=$1::uuid),
 'resource_snapshots',(SELECT count(*) FROM session_resource_snapshots WHERE session_id=$1::uuid),
 'model_calls',(SELECT count(*) FROM model_calls WHERE session_id=$1::uuid),
 'mcp_tool_calls',(SELECT count(*) FROM mcp_tool_calls WHERE session_id=$1::uuid),
 'image_calls',(SELECT count(*) FROM image_calls WHERE session_id=$1::uuid)
) AS data;

-- name: ListSessions :many
SELECT jsonb_build_object(
 'id',id,'owner_user_id',owner_user_id,'group_id',group_id,'parent_session_id',parent_session_id,
 'session_type',session_type,'client_type',client_type,'client_name',client_name,
 'started_at',started_at,'last_active_at',last_active_at,'ended_at',ended_at,
 'turn_count',turn_count,'acked_turn',acked_turn,'active_seconds',active_seconds,
 'facts_version',facts_version,'last_stop_reason',last_stop_reason,
 'created_at',created_at,'updated_at',updated_at
) AS data FROM sessions
WHERE
 (sqlc.arg(status)::text <> '' OR
  ((sqlc.arg(include_deleted)::boolean OR deleted_at IS NULL)
   AND (sqlc.arg(include_purged)::boolean OR purged_at IS NULL)
   AND (sqlc.arg(include_placeholder)::boolean OR placeholder=false)
   AND (sqlc.arg(include_legacy)::boolean OR reporting_enabled_at IS NOT NULL)))
 AND (sqlc.arg(status)::text = '' OR sqlc.arg(status)::text = 'all'
      OR (sqlc.arg(status)::text = 'deleted' AND deleted_at IS NOT NULL)
      OR (sqlc.arg(status)::text = 'purged' AND purged_at IS NOT NULL)
      OR (sqlc.arg(status)::text = 'placeholder' AND placeholder AND purged_at IS NULL)
      OR (sqlc.arg(status)::text IN ('legacy','old_reporting') AND reporting_enabled_at IS NULL AND purged_at IS NULL)
      OR (sqlc.arg(status)::text = 'reporting' AND reporting_enabled_at IS NOT NULL AND purged_at IS NULL))
 AND (sqlc.arg(owner_id)::text = '' OR owner_user_id=NULLIF(sqlc.arg(owner_id)::text,'')::uuid)
 AND (sqlc.arg(group_id)::text = '' OR group_id=NULLIF(sqlc.arg(group_id)::text,'')::uuid)
 AND (sqlc.arg(parent_id)::text = '' OR parent_session_id=NULLIF(sqlc.arg(parent_id)::text,'')::uuid)
 AND (sqlc.arg(session_type)::text = '' OR session_type=sqlc.arg(session_type)::text)
 AND (sqlc.arg(client_type)::text = '' OR client_type=sqlc.arg(client_type)::text)
 AND (sqlc.arg(from_time)::text = '' OR started_at>=NULLIF(sqlc.arg(from_time)::text,'')::timestamptz)
 AND (sqlc.arg(until_time)::text = '' OR started_at<NULLIF(sqlc.arg(until_time)::text,'')::timestamptz)
ORDER BY COALESCE(last_active_at,started_at) DESC,id DESC
LIMIT sqlc.arg(page_limit)::integer OFFSET sqlc.arg(page_offset)::integer;

-- name: CountSessions :one
SELECT count(*) FROM sessions
WHERE
 (sqlc.arg(status)::text <> '' OR
  ((sqlc.arg(include_deleted)::boolean OR deleted_at IS NULL)
   AND (sqlc.arg(include_purged)::boolean OR purged_at IS NULL)
   AND (sqlc.arg(include_placeholder)::boolean OR placeholder=false)
   AND (sqlc.arg(include_legacy)::boolean OR reporting_enabled_at IS NOT NULL)))
 AND (sqlc.arg(status)::text = '' OR sqlc.arg(status)::text = 'all'
      OR (sqlc.arg(status)::text = 'deleted' AND deleted_at IS NOT NULL)
      OR (sqlc.arg(status)::text = 'purged' AND purged_at IS NOT NULL)
      OR (sqlc.arg(status)::text = 'placeholder' AND placeholder AND purged_at IS NULL)
      OR (sqlc.arg(status)::text IN ('legacy','old_reporting') AND reporting_enabled_at IS NULL AND purged_at IS NULL)
      OR (sqlc.arg(status)::text = 'reporting' AND reporting_enabled_at IS NOT NULL AND purged_at IS NULL))
 AND (sqlc.arg(owner_id)::text = '' OR owner_user_id=NULLIF(sqlc.arg(owner_id)::text,'')::uuid)
 AND (sqlc.arg(group_id)::text = '' OR group_id=NULLIF(sqlc.arg(group_id)::text,'')::uuid)
 AND (sqlc.arg(parent_id)::text = '' OR parent_session_id=NULLIF(sqlc.arg(parent_id)::text,'')::uuid)
 AND (sqlc.arg(session_type)::text = '' OR session_type=sqlc.arg(session_type)::text)
 AND (sqlc.arg(client_type)::text = '' OR client_type=sqlc.arg(client_type)::text)
 AND (sqlc.arg(from_time)::text = '' OR started_at>=NULLIF(sqlc.arg(from_time)::text,'')::timestamptz)
 AND (sqlc.arg(until_time)::text = '' OR started_at<NULLIF(sqlc.arg(until_time)::text,'')::timestamptz);

-- name: LockFamily :many
SELECT id::text FROM sessions WHERE id=$1::uuid OR parent_session_id=$1::uuid ORDER BY id FOR UPDATE;

-- name: DeleteModelCalls :exec
DELETE FROM model_calls WHERE session_id=ANY($1::uuid[]);
-- name: DeleteMCPCalls :exec
DELETE FROM mcp_tool_calls WHERE session_id=ANY($1::uuid[]);
-- name: DeleteImageCalls :exec
DELETE FROM image_calls WHERE session_id=ANY($1::uuid[]);
-- name: DeleteTurnTools :exec
DELETE FROM session_turn_tools WHERE session_id=ANY($1::uuid[]);
-- name: DeleteSkillEvents :exec
DELETE FROM session_skill_events WHERE session_id=ANY($1::uuid[]);
-- name: DeleteTurns :exec
DELETE FROM session_turns WHERE session_id=ANY($1::uuid[]);
-- name: DeleteSnapshotItems :exec
DELETE FROM session_resource_snapshot_items WHERE session_id=ANY($1::uuid[]);
-- name: DeleteSnapshots :exec
DELETE FROM session_resource_snapshots WHERE session_id=ANY($1::uuid[]);
-- name: PurgeSessions :exec
UPDATE sessions SET deleted_at=COALESCE(deleted_at,now()),client_deleted_at=COALESCE(client_deleted_at,now()),
 purged_at=COALESCE(purged_at,now()),updated_at=now() WHERE id=ANY($1::uuid[]);
