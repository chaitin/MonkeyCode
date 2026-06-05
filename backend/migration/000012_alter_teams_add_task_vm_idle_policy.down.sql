ALTER TABLE teams
    DROP COLUMN IF EXISTS task_vm_recycle_seconds,
    DROP COLUMN IF EXISTS task_vm_recycle_enabled,
    DROP COLUMN IF EXISTS task_vm_sleep_seconds,
    DROP COLUMN IF EXISTS task_vm_sleep_enabled;
