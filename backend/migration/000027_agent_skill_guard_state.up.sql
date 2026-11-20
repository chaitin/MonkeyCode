ALTER TABLE agent_skill_versions
  ADD COLUMN IF NOT EXISTS guard_status VARCHAR(16) NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS guard_task_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS guard_deadline TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS guard_error VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_agent_skill_versions_guard_pending
  ON agent_skill_versions (guard_status, guard_deadline)
  WHERE guard_status = 'pending';
