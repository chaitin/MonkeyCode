-- name: Current :one
SELECT c.revision, c.publisher_id, COALESCE(c.snapshot_id::text,'') AS snapshot_id,
       s.source_release_id, s.schema_version, s.digest_schema
FROM design_current c LEFT JOIN design_snapshots s ON s.id=c.snapshot_id WHERE singleton;

-- name: LockCurrent :one
SELECT revision, publisher_id, COALESCE(snapshot_id::text,'') AS snapshot_id FROM design_current WHERE singleton FOR UPDATE;

-- name: Snapshot :one
SELECT id::text AS id, publisher_id, source_release_id, schema_version, digest_schema, snapshot_digest, taxonomy
FROM design_snapshots WHERE publisher_id=$1 AND source_release_id=$2;

-- name: Entries :many
SELECT data FROM design_entries WHERE snapshot_id=$1::uuid ORDER BY resource_type,catalog_id;

-- name: InsertSnapshot :exec
INSERT INTO design_snapshots(id,publisher_id,source_release_id,schema_version,digest_schema,snapshot_digest,taxonomy,actor_user_id)
SELECT (d->>'id')::uuid,d->>'publisher_id',d->>'release_id',(d->>'schema_version')::integer,d->>'digest_schema',d->>'snapshot_digest',d->'taxonomy',(d->>'actor_user_id')::uuid
FROM (SELECT sqlc.arg(data)::jsonb AS d) v;

-- name: InsertEntry :exec
INSERT INTO design_entries(id,snapshot_id,resource_type,catalog_id,content_digest,data)
SELECT (d->>'id')::uuid,(d->>'snapshot_id')::uuid,d->'entry'->>'kind',d->'entry'->>'id',d->'entry'->>'content_digest',d->'entry'
FROM (SELECT sqlc.arg(data)::jsonb AS d) v;

-- name: InsertFile :exec
INSERT INTO design_files(entry_id,path,sha256,size,mime,role,object_key)
SELECT (d->>'entry_id')::uuid,d->>'path',d->>'sha256',(d->>'size')::bigint,d->>'mime',d->>'role',d->>'object_key'
FROM (SELECT sqlc.arg(data)::jsonb AS d) v;

-- name: Activate :execrows
UPDATE design_current SET publisher_id=$1,snapshot_id=$2::uuid,revision=revision+1
WHERE singleton AND revision=$3;
