CREATE INDEX CONCURRENTLY billing_transactions_pending_account_idx
    ON billing_transactions(account_id)
    INCLUDE (reserve)
    WHERE status NOT IN ('settled', 'released', 'rejected');
