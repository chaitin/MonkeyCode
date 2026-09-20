ALTER TABLE credit_accounts
    DROP CONSTRAINT credit_accounts_amount_check,
    ADD CONSTRAINT credit_accounts_amount_check CHECK (frozen >= 0);
