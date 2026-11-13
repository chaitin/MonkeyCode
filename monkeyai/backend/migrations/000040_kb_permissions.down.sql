BEGIN;
ALTER TABLE knowledge_base_documents DROP COLUMN content_updated_at;
ALTER TABLE knowledge_base_documents DROP COLUMN updated_by_user_id;
ALTER TABLE resource_access_grants DROP COLUMN updated_by_user_id;
COMMIT;
