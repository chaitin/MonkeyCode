BEGIN;
ALTER TABLE knowledge_base_documents ADD COLUMN updated_by_user_id uuid;
ALTER TABLE knowledge_base_documents ADD COLUMN content_updated_at timestamptz;
ALTER TABLE knowledge_bases ADD COLUMN avatar_s3_key text NOT NULL DEFAULT '';
COMMIT;
