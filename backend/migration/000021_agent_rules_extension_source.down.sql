BEGIN;

DROP INDEX IF EXISTS idx_agent_rules_extension_source;

ALTER TABLE agent_rules
  DROP COLUMN IF EXISTS extension_version,
  DROP COLUMN IF EXISTS extension_rule_id,
  DROP COLUMN IF EXISTS extension_package_id;

COMMIT;
