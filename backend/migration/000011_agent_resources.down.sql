BEGIN;

-- 反向 FK 先 drop
ALTER TABLE IF EXISTS agent_plugins
  DROP CONSTRAINT IF EXISTS agent_plugins_active_version_fk;
ALTER TABLE IF EXISTS agent_skills
  DROP CONSTRAINT IF EXISTS agent_skills_active_version_fk;
ALTER TABLE IF EXISTS agent_rules
  DROP CONSTRAINT IF EXISTS agent_rules_active_version_fk;

DROP TABLE IF EXISTS agent_sync_jobs;
DROP TABLE IF EXISTS agent_plugin_versions;
DROP TABLE IF EXISTS agent_skill_versions;
DROP TABLE IF EXISTS agent_plugins;
DROP TABLE IF EXISTS agent_skills;
DROP TABLE IF EXISTS agent_plugin_repos;
DROP TABLE IF EXISTS agent_skill_repos;
DROP TABLE IF EXISTS agent_rule_versions;
DROP TABLE IF EXISTS agent_rules;

COMMIT;
