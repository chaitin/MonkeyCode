DELETE FROM resource_import_sections WHERE section='knowledge';
ALTER TABLE resource_import_sections DROP CONSTRAINT resource_import_sections_section_check;
ALTER TABLE resource_import_sections ADD CONSTRAINT resource_import_sections_section_check CHECK (section IN ('agent','design'));
