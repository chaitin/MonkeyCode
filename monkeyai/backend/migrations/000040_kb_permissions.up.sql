BEGIN;
ALTER TABLE resource_access_grants ADD COLUMN updated_by_user_id uuid;
ALTER TABLE knowledge_base_documents ADD COLUMN updated_by_user_id uuid;
ALTER TABLE knowledge_base_documents ADD COLUMN content_updated_at timestamptz;
COMMIT;
