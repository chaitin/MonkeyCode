DROP TABLE IF EXISTS mcp_tool_calls;
DROP TABLE IF EXISTS team_group_mcp_upstreams;

DROP INDEX IF EXISTS idx_mcp_tools_scope_team_namespaced_name;
DROP INDEX IF EXISTS idx_mcp_tools_team_id;
DROP INDEX IF EXISTS idx_mcp_upstreams_scope_team_slug;
DROP INDEX IF EXISTS idx_mcp_upstreams_team_id;

ALTER TABLE mcp_tools DROP COLUMN IF EXISTS team_id;
ALTER TABLE mcp_upstreams DROP COLUMN IF EXISTS team_id;

DROP INDEX IF EXISTS idx_mcp_tools_scope_user_namespaced_name;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_tools_scope_user_namespaced_name
    ON mcp_tools USING btree (scope, user_id, namespaced_name);

DROP INDEX IF EXISTS idx_mcp_upstreams_scope_user_slug;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_upstreams_scope_user_slug
    ON mcp_upstreams USING btree (scope, user_id, slug)
    WHERE deleted_at IS NULL;

ALTER TABLE mcp_tools DROP CONSTRAINT IF EXISTS mcp_tools_scope_check;
ALTER TABLE mcp_tools
    ADD CONSTRAINT mcp_tools_scope_check
    CHECK ((scope)::text = ANY ((ARRAY['platform'::character varying, 'user'::character varying])::text[]));

ALTER TABLE mcp_upstreams DROP CONSTRAINT IF EXISTS mcp_upstreams_scope_check;
ALTER TABLE mcp_upstreams
    ADD CONSTRAINT mcp_upstreams_scope_check
    CHECK ((scope)::text = ANY ((ARRAY['platform'::character varying, 'user'::character varying])::text[]));
