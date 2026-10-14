ALTER TABLE video_jobs
    ADD COLUMN poll_failures integer NOT NULL DEFAULT 0 CHECK (poll_failures >= 0);
