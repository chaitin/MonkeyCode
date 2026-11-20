BEGIN;

-- G2-MOUNT-001: enterprise global rules need an admin start/stop switch
-- independent of soft-delete. Existing rows stay enabled so Create-path
-- injection behavior is unchanged until an admin disables a rule.

ALTER TABLE agent_rules
  ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE;

COMMIT;
