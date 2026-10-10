DROP TABLE video_calls;
DROP TABLE video_outputs;
DROP TABLE video_job_inputs;
DROP TABLE video_jobs;
DROP TABLE video_inputs;

ALTER TABLE credit_ledger_entries
    DROP CONSTRAINT credit_ledger_entries_category_check,
    ADD CONSTRAINT credit_ledger_entries_category_check CHECK (category IN ('model', 'tool', 'image', 'other'));

ALTER TABLE billing_transactions
    DROP CONSTRAINT billing_transactions_category_check,
    ADD CONSTRAINT billing_transactions_category_check CHECK (category IN ('model', 'tool', 'image'));
