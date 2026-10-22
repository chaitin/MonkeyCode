DROP VIEW resource_import_history;
DROP TABLE resource_import_sections;
ALTER TABLE resource_import_uploads DROP COLUMN cleaned_at;
ALTER TABLE resource_imports DROP COLUMN upload_id;
DROP TABLE design_current;
DROP TABLE design_files;
DROP TABLE design_entries;
DROP TABLE design_snapshots;
