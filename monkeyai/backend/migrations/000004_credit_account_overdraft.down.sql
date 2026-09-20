-- 回滚前需结清负余额并释放超额冻结；不截断余额，以免破坏账本一致性。
ALTER TABLE credit_accounts
    DROP CONSTRAINT credit_accounts_amount_check,
    ADD CONSTRAINT credit_accounts_amount_check CHECK (balance >= 0 AND frozen >= 0 AND frozen <= balance);
