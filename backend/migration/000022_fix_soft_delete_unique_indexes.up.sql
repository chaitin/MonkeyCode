BEGIN;

-- agent_skills / agent_plugins 的 (repo_id, name) 唯一索引未带软删过滤,
-- 导致软删旧资源后无法再创建/上传同名资源。改为 partial unique。

DROP INDEX IF EXISTS uniq_agent_skills_repo_name;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_agent_skills_repo_name
  ON agent_skills (repo_id, name)
  WHERE is_deleted = FALSE;

DROP INDEX IF EXISTS uniq_agent_plugins_repo_name;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_agent_plugins_repo_name
  ON agent_plugins (repo_id, name)
  WHERE is_deleted = FALSE;

-- mcp_tools 在 000020 中改为 partial unique 时只过滤了 team_id,
-- 没过滤 deleted_at(对照 mcp_upstreams 同次迁移是有的)。补上。

DROP INDEX IF EXISTS idx_mcp_tools_scope_user_namespaced_name;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_tools_scope_user_namespaced_name
  ON mcp_tools USING btree (scope, user_id, namespaced_name)
  WHERE deleted_at IS NULL AND team_id IS NULL;

DROP INDEX IF EXISTS idx_mcp_tools_scope_team_namespaced_name;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_tools_scope_team_namespaced_name
  ON mcp_tools USING btree (scope, team_id, namespaced_name)
  WHERE deleted_at IS NULL AND team_id IS NOT NULL;

COMMIT;
