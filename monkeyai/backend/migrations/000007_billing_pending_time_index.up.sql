CREATE INDEX CONCURRENTLY billing_transactions_pending_time_idx
    ON billing_transactions(started_at, id)
    WHERE status NOT IN ('settled', 'released', 'rejected');
