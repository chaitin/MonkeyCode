BEGIN;

DROP INDEX IF EXISTS uniq_agent_skills_repo_name;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_agent_skills_repo_name
  ON agent_skills (repo_id, name);

DROP INDEX IF EXISTS uniq_agent_plugins_repo_name;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_agent_plugins_repo_name
  ON agent_plugins (repo_id, name);

DROP INDEX IF EXISTS idx_mcp_tools_scope_user_namespaced_name;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_tools_scope_user_namespaced_name
  ON mcp_tools USING btree (scope, user_id, namespaced_name)
  WHERE team_id IS NULL;

DROP INDEX IF EXISTS idx_mcp_tools_scope_team_namespaced_name;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_tools_scope_team_namespaced_name
  ON mcp_tools USING btree (scope, team_id, namespaced_name)
  WHERE team_id IS NOT NULL;

COMMIT;
