BEGIN;

ALTER TABLE agent_rules
  ADD COLUMN IF NOT EXISTS extension_package_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS extension_rule_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS extension_version VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_agent_rules_extension_source
  ON agent_rules (extension_package_id, extension_rule_id)
  WHERE extension_package_id IS NOT NULL AND extension_rule_id IS NOT NULL;

COMMIT;
