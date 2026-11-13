BEGIN;
ALTER TABLE knowledge_bases DROP COLUMN avatar_s3_key;
COMMIT;
