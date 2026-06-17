BEGIN;

-- up 建了全部 agent_* 表,down 直接 DROP(含级联的索引/约束)。
-- 按外键依赖反序删除。
DROP TABLE IF EXISTS agent_skill_group_bindings;
DROP TABLE IF EXISTS agent_skill_versions;
DROP TABLE IF EXISTS agent_plugin_versions;
DROP TABLE IF EXISTS agent_sync_jobs;
DROP TABLE IF EXISTS agent_skills;
DROP TABLE IF EXISTS agent_plugins;
DROP TABLE IF EXISTS agent_skill_repos;
DROP TABLE IF EXISTS agent_plugin_repos;
DROP TABLE IF EXISTS agent_rule_versions;
DROP TABLE IF EXISTS agent_rules;

COMMIT;
