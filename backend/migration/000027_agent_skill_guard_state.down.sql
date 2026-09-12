DROP INDEX IF EXISTS idx_agent_skill_versions_guard_pending;

ALTER TABLE agent_skill_versions
  DROP COLUMN IF EXISTS guard_error,
  DROP COLUMN IF EXISTS guard_deadline,
  DROP COLUMN IF EXISTS guard_task_id,
  DROP COLUMN IF EXISTS guard_status;
