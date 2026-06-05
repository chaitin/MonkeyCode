ALTER TABLE teams
    ADD COLUMN IF NOT EXISTS task_vm_sleep_enabled boolean DEFAULT true NOT NULL,
    ADD COLUMN IF NOT EXISTS task_vm_sleep_seconds integer DEFAULT 0 NOT NULL,
    ADD COLUMN IF NOT EXISTS task_vm_recycle_enabled boolean DEFAULT true NOT NULL,
    ADD COLUMN IF NOT EXISTS task_vm_recycle_seconds integer DEFAULT 0 NOT NULL;
