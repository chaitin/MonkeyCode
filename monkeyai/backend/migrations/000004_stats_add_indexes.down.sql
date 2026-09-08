BEGIN;
DROP INDEX sessions_last_active_idx;
DROP INDEX sessions_started_idx;
DROP INDEX mcp_tool_calls_completed_idx;
DROP INDEX model_calls_completed_idx;
DROP INDEX model_calls_started_idx;
COMMIT;
