BEGIN;
ALTER TABLE knowledge_bases ADD COLUMN avatar_s3_key text NOT NULL DEFAULT '';
COMMIT;
