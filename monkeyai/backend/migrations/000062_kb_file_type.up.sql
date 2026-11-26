ALTER TABLE knowledge_base_documents ADD COLUMN IF NOT EXISTS file_type text;
-- Earlier test deployments may already have the nullable column with a loose check.
ALTER TABLE knowledge_base_documents DROP CONSTRAINT IF EXISTS knowledge_base_documents_file_type_check;
ALTER TABLE knowledge_base_documents ADD CONSTRAINT knowledge_base_documents_file_type_check
    CHECK (file_type IS NULL OR file_type IN ('txt','md','html','svg','csv','docx','xls','xlsx','pptx','pdf','jpg','png'));
-- Only existing plain text documents have a trustworthy source contract.
UPDATE knowledge_base_documents SET file_type = 'md'
WHERE file_type IS NULL AND node_type = 'document' AND source_type = 'text'
  AND storage_key IS NULL AND (file_name IS NULL OR file_name = '');

CREATE INDEX knowledge_base_documents_storage_key_idx
    ON knowledge_base_documents (storage_key) WHERE storage_key IS NOT NULL;
