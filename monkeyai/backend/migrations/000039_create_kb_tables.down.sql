BEGIN;

DELETE FROM resource_tags WHERE resource_type = 'kb';
DELETE FROM resource_access_grants WHERE resource_type = 'kb';

ALTER TABLE resource_access_grants
    DROP CONSTRAINT IF EXISTS resource_access_grants_resource_type_check;
ALTER TABLE resource_access_grants
    ADD CONSTRAINT resource_access_grants_resource_type_check CHECK (
        resource_type IN ('model', 'skill', 'rule', 'connector', 'expert')
    );

ALTER TABLE resource_tags
    DROP CONSTRAINT IF EXISTS resource_tags_resource_type_check;
ALTER TABLE resource_tags
    ADD CONSTRAINT resource_tags_resource_type_check CHECK (
        resource_type IN ('model', 'skill', 'rule', 'connector', 'expert')
    );

DROP TABLE IF EXISTS kb_learning_jobs;
DROP TABLE IF EXISTS kb_chunks;
DROP TABLE IF EXISTS kb_documents;
DROP TABLE IF EXISTS kb;

DELETE FROM migrations WHERE name = '000039_create_kb_tables';

COMMIT;
