ALTER TABLE skills ADD COLUMN origin text NOT NULL DEFAULT 'local'
    CHECK (origin IN ('local', 'package') AND (origin = 'local' OR ownership_type = 'system'));
ALTER TABLE rules ADD COLUMN origin text NOT NULL DEFAULT 'local'
    CHECK (origin IN ('local', 'package') AND (origin = 'local' OR ownership_type = 'system'));
ALTER TABLE connectors ADD COLUMN origin text NOT NULL DEFAULT 'local'
    CHECK (origin IN ('local', 'package') AND (origin = 'local' OR ownership_type = 'system'));
ALTER TABLE experts ADD COLUMN origin text NOT NULL DEFAULT 'local'
    CHECK (origin IN ('local', 'package') AND (origin = 'local' OR ownership_type = 'system'));

UPDATE skills t SET origin = 'package' FROM resource_import_bindings b
WHERE b.resource_type = 'skill' AND b.resource_id = t.id;
UPDATE rules t SET origin = 'package' FROM resource_import_bindings b
WHERE b.resource_type = 'rule' AND b.resource_id = t.id;
UPDATE connectors t SET origin = 'package' FROM resource_import_bindings b
WHERE b.resource_type = 'connector' AND b.resource_id = t.id;
UPDATE experts t SET origin = 'package' FROM resource_import_bindings b
WHERE b.resource_type = 'expert' AND b.resource_id = t.id;

DROP INDEX skills_system_name_key;
CREATE UNIQUE INDEX skills_system_name_key ON skills(lower(btrim(name)))
WHERE ownership_type = 'system' AND origin = 'local' AND deleted_at IS NULL;
DROP INDEX rules_system_name_key;
CREATE UNIQUE INDEX rules_system_name_key ON rules(lower(btrim(name)))
WHERE ownership_type = 'system' AND origin = 'local' AND deleted_at IS NULL;
DROP INDEX connectors_system_name_key;
CREATE UNIQUE INDEX connectors_system_name_key ON connectors(lower(btrim(name)))
WHERE ownership_type = 'system' AND origin = 'local' AND deleted_at IS NULL;
DROP INDEX experts_system_name_key;
CREATE UNIQUE INDEX experts_system_name_key ON experts(lower(btrim(name)))
WHERE ownership_type = 'system' AND origin = 'local' AND deleted_at IS NULL;
