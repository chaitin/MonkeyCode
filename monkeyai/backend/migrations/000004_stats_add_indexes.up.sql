BEGIN;
CREATE INDEX model_calls_started_idx ON model_calls (started_at);
CREATE INDEX model_calls_completed_idx ON model_calls (completed_at) WHERE completed_at IS NOT NULL;
CREATE INDEX mcp_tool_calls_completed_idx ON mcp_tool_calls (completed_at) WHERE completed_at IS NOT NULL;
CREATE INDEX sessions_started_idx ON sessions (started_at DESC,id DESC) WHERE deleted_at IS NULL;
CREATE INDEX sessions_last_active_idx ON sessions (last_active_at) WHERE deleted_at IS NULL;
COMMIT;
