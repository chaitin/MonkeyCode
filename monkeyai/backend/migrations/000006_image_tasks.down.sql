-- 存在生图任务、图片或账单时拒绝回滚，不自动删除用户数据。
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM image_jobs)
       OR EXISTS (SELECT 1 FROM image_inputs)
       OR EXISTS (SELECT 1 FROM image_outputs)
       OR EXISTS (SELECT 1 FROM image_job_inputs)
       OR EXISTS (SELECT 1 FROM image_calls)
       OR EXISTS (SELECT 1 FROM billing_transactions WHERE category = 'image')
       OR EXISTS (SELECT 1 FROM credit_ledger_entries WHERE category = 'image') THEN
        RAISE EXCEPTION 'image data exists; cannot roll back image_tasks';
    END IF;
END $$;

DROP TABLE image_outputs;
DROP TABLE image_job_inputs;
DROP TABLE image_jobs;
DROP TABLE image_inputs;
DROP TABLE image_calls;
ALTER TABLE credit_ledger_entries DROP CONSTRAINT credit_ledger_entries_category_check;
ALTER TABLE credit_ledger_entries ADD CONSTRAINT credit_ledger_entries_category_check CHECK (category IN ('model', 'tool', 'other'));
ALTER TABLE billing_transactions DROP CONSTRAINT billing_transactions_category_check;
ALTER TABLE billing_transactions ADD CONSTRAINT billing_transactions_category_check CHECK (category IN ('model', 'tool'));
