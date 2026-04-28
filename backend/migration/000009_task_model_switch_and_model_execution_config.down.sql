DROP INDEX IF EXISTS idx_task_model_switches_user_id_created_at;
DROP INDEX IF EXISTS idx_task_model_switches_task_id_created_at;
DROP TABLE IF EXISTS task_model_switches;

ALTER TABLE models
    DROP COLUMN IF EXISTS output_limit,
    DROP COLUMN IF EXISTS context_limit,
    DROP COLUMN IF EXISTS thinking_enabled;
