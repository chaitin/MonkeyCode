ALTER TABLE teams
    ADD COLUMN IF NOT EXISTS task_concurrency_limit integer DEFAULT 3 NOT NULL;
