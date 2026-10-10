-- name: ListImportBindings :many
SELECT to_jsonb(b) FROM resource_import_bindings b WHERE publisher = $1 ORDER BY slug;

-- name: GetLatestImport :one
SELECT version, release_id::text AS release_id, manifest_sha256
FROM resource_imports WHERE publisher = $1 AND status = 'succeeded'
ORDER BY version DESC LIMIT 1;

-- name: ListImportHistory :many
SELECT to_jsonb(i) FROM resource_imports i ORDER BY created_at DESC, id DESC LIMIT 100;

-- name: GetImportHistory :one
SELECT to_jsonb(i) FROM resource_imports i WHERE id = $1::uuid;

-- name: LockImportPublisher :one
SELECT pg_advisory_xact_lock($1::bigint);

-- name: LockImportSkill :one
SELECT id::text FROM skills WHERE id = $1::uuid FOR UPDATE;

-- name: LockImportRule :one
SELECT id::text FROM rules WHERE id = $1::uuid FOR UPDATE;

-- name: LockImportConnector :one
SELECT id::text FROM connectors WHERE id = $1::uuid FOR UPDATE;

-- name: LockImportExpert :one
SELECT id::text FROM experts WHERE id = $1::uuid FOR UPDATE;

-- name: GetImportTarget :one
SELECT data FROM (
    SELECT id, to_jsonb(s) AS data FROM skills s WHERE $1::text = 'skill' AND id = $2::uuid AND deleted_at IS NULL
    UNION ALL
    SELECT id, to_jsonb(r) AS data FROM rules r WHERE $1::text = 'rule' AND id = $2::uuid AND deleted_at IS NULL
    UNION ALL
    SELECT id, to_jsonb(c) AS data FROM connectors c WHERE $1::text = 'connector' AND id = $2::uuid AND deleted_at IS NULL
    UNION ALL
    SELECT id, to_jsonb(e) AS data FROM experts e WHERE $1::text = 'expert' AND id = $2::uuid AND deleted_at IS NULL
) t LIMIT 1;

-- name: ListImportReferences :many
SELECT id FROM (
    SELECT e.id::text AS id FROM expert_skills l JOIN experts e ON e.id=l.expert_id
    WHERE $1::text='skill' AND l.skill_id=$2::uuid AND e.deleted_at IS NULL AND e.enabled
    UNION ALL
    SELECT e.id::text AS id FROM expert_rules l JOIN experts e ON e.id=l.expert_id
    WHERE $1::text='rule' AND l.rule_id=$2::uuid AND e.deleted_at IS NULL AND e.enabled
    UNION ALL
    SELECT e.id::text AS id FROM expert_connectors l JOIN experts e ON e.id=l.expert_id
    WHERE $1::text='connector' AND l.connector_id=$2::uuid AND e.deleted_at IS NULL AND e.enabled
) refs;

-- name: GetImportSkillSHA :one
SELECT package_sha256 FROM skills WHERE id=$1::uuid;

-- name: CreateImportBatch :exec
INSERT INTO resource_imports (id,publisher,release_id,version,manifest_sha256,actor_user_id,status,result_counts)
VALUES ((sqlc.arg(data)::jsonb->>'id')::uuid,sqlc.arg(data)::jsonb->>'publisher',
        (sqlc.arg(data)::jsonb->>'release_id')::uuid,(sqlc.arg(data)::jsonb->>'version')::bigint,
        sqlc.arg(data)::jsonb->>'manifest_sha256',(sqlc.arg(data)::jsonb->>'actor_user_id')::uuid,
        'succeeded',sqlc.arg(data)::jsonb->'result_counts');

-- name: CreateImportSkill :exec
INSERT INTO skills (id,owner_user_id,ownership_type,name,description,name_i18n,description_i18n,
                    package_file_name,package_s3_key,package_size_bytes,package_sha256,file_count)
SELECT (d->>'id')::uuid,(d->>'actor_id')::uuid,'system',d->>'name',d->>'description',d->'name_i18n',d->'description_i18n',
       d->>'package_file_name',d->>'package_s3_key',(d->>'package_size_bytes')::bigint,d->>'package_sha256',(d->>'file_count')::int
FROM (SELECT sqlc.arg(data)::jsonb AS d) input;

-- name: UpdateImportSkill :exec
UPDATE skills SET name=d->>'name',description=d->>'description',name_i18n=d->'name_i18n',description_i18n=d->'description_i18n',
       package_file_name=d->>'package_file_name',package_s3_key=CASE WHEN d->>'package_s3_key'='' THEN package_s3_key ELSE d->>'package_s3_key' END,
       package_size_bytes=(d->>'package_size_bytes')::bigint,package_sha256=d->>'package_sha256',file_count=(d->>'file_count')::int,
       enabled=true,revision=revision+1,updated_at=now()
FROM (SELECT sqlc.arg(data)::jsonb AS d) input WHERE id=(d->>'id')::uuid;

-- name: CreateImportRule :exec
INSERT INTO rules (id,owner_user_id,ownership_type,name,content,name_i18n,description_i18n)
SELECT (d->>'id')::uuid,(d->>'actor_id')::uuid,'system',d->>'name',d->>'content',d->'name_i18n',d->'description_i18n'
FROM (SELECT sqlc.arg(data)::jsonb AS d) input;

-- name: UpdateImportRule :exec
UPDATE rules SET name=d->>'name',content=d->>'content',name_i18n=d->'name_i18n',description_i18n=d->'description_i18n',
       enabled=true,revision=revision+1,updated_at=now()
FROM (SELECT sqlc.arg(data)::jsonb AS d) input WHERE id=(d->>'id')::uuid;

-- name: CreateImportConnector :exec
INSERT INTO connectors (id,owner_user_id,ownership_type,name,description,url,
                        authorization_mode,authorization_method,oauth_config,timeout_ms,auth_header_name,name_i18n,description_i18n)
SELECT (d->>'id')::uuid,(d->>'actor_id')::uuid,'system',d->>'name','',d->>'url',d->>'authorization_mode',
       NULLIF(d->>'authorization_method',''),d->'oauth_config',(d->>'timeout_ms')::int,d->>'auth_header_name',d->'name_i18n',d->'description_i18n'
FROM (SELECT sqlc.arg(data)::jsonb AS d) input;

-- name: UpdateImportConnector :exec
UPDATE connectors SET name=d->>'name',description='',url=d->>'url',authorization_mode=d->>'authorization_mode',
       authorization_method=NULLIF(d->>'authorization_method',''),oauth_config=d->'oauth_config',timeout_ms=(d->>'timeout_ms')::int,
       auth_header_name=d->>'auth_header_name',name_i18n=d->'name_i18n',description_i18n=d->'description_i18n',
       config_revision=(d->>'config_revision')::bigint,connection_status=d->>'connection_status',
       last_checked_at=CASE WHEN (d->>'config_changed')::boolean THEN NULL ELSE last_checked_at END,
       last_error=CASE WHEN (d->>'config_changed')::boolean THEN NULL ELSE last_error END,
       enabled=true,revision=revision+1,updated_at=now()
FROM (SELECT sqlc.arg(data)::jsonb AS d) input WHERE id=(d->>'id')::uuid;

-- name: InvalidateImportTools :exec
UPDATE mcp_tools SET deleted_at=now() WHERE connector_id=$1::uuid AND deleted_at IS NULL;

-- name: RevokeImportCredentials :exec
UPDATE connector_credentials SET revoked_at=now(),revision=revision+1,updated_at=now()
WHERE connector_id=$1::uuid AND revoked_at IS NULL;

-- name: CreateImportExpert :exec
INSERT INTO experts (id,created_by_user_id,owner_user_id,ownership_type,name,description,prompt,
                     avatar_s3_key,name_i18n,description_i18n)
SELECT (d->>'id')::uuid,(d->>'actor_id')::uuid,(d->>'actor_id')::uuid,'system',d->>'name',d->>'description',d->>'prompt',
       d->>'avatar_s3_key',d->'name_i18n',d->'description_i18n'
FROM (SELECT sqlc.arg(data)::jsonb AS d) input;

-- name: UpdateImportExpert :exec
UPDATE experts SET name=d->>'name',description=d->>'description',prompt=d->>'prompt',avatar_s3_key=d->>'avatar_s3_key',
       name_i18n=d->'name_i18n',description_i18n=d->'description_i18n',enabled=true,revision=revision+1,updated_at=now()
FROM (SELECT sqlc.arg(data)::jsonb AS d) input WHERE id=(d->>'id')::uuid;

-- name: ClearImportExpertSkills :exec
DELETE FROM expert_skills WHERE expert_id=$1::uuid;

-- name: ClearImportExpertRules :exec
DELETE FROM expert_rules WHERE expert_id=$1::uuid;

-- name: ClearImportExpertConnectors :exec
DELETE FROM expert_connectors WHERE expert_id=$1::uuid;

-- name: LinkImportExpertSkill :exec
INSERT INTO expert_skills(expert_id,skill_id) VALUES ($1::uuid,$2::uuid);

-- name: LinkImportExpertRule :exec
INSERT INTO expert_rules(expert_id,rule_id) VALUES ($1::uuid,$2::uuid);

-- name: LinkImportExpertConnector :exec
INSERT INTO expert_connectors(expert_id,connector_id) VALUES ($1::uuid,$2::uuid);

-- name: UpsertImportBinding :exec
INSERT INTO resource_import_bindings(publisher,slug,resource_type,resource_id,source_sha256,applied_sha256,last_import_id)
SELECT d->>'publisher',d->>'slug',d->>'resource_type',(d->>'resource_id')::uuid,d->>'source_sha256',d->>'applied_sha256',(d->>'last_import_id')::uuid
FROM (SELECT sqlc.arg(data)::jsonb AS d) input
ON CONFLICT (publisher,slug) DO UPDATE SET source_sha256=EXCLUDED.source_sha256,
    applied_sha256=EXCLUDED.applied_sha256,last_import_id=EXCLUDED.last_import_id,
    retired_at=NULL,retired_import_id=NULL,updated_at=now();

-- name: RetireImportExpert :exec
UPDATE experts SET enabled=false,revision=revision+1,updated_at=now() WHERE id=$1::uuid;

-- name: RetireImportSkill :exec
UPDATE skills SET enabled=false,revision=revision+1,updated_at=now() WHERE id=$1::uuid;

-- name: RetireImportRule :exec
UPDATE rules SET enabled=false,revision=revision+1,updated_at=now() WHERE id=$1::uuid;

-- name: RetireImportConnector :exec
UPDATE connectors SET enabled=false,revision=revision+1,updated_at=now() WHERE id=$1::uuid;

-- name: RetireImportBinding :exec
UPDATE resource_import_bindings SET retired_at=now(),retired_import_id=sqlc.arg(import_id)::uuid,
    last_import_id=sqlc.arg(import_id)::uuid,updated_at=now()
WHERE publisher=sqlc.arg(publisher) AND slug=sqlc.arg(slug);
