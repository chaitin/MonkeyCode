BEGIN;
ALTER TABLE knowledge_bases DROP COLUMN avatar_s3_key;
ALTER TABLE knowledge_base_documents DROP COLUMN content_updated_at;
ALTER TABLE knowledge_base_documents DROP COLUMN updated_by_user_id;
COMMIT;
