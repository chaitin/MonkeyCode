UPDATE credit_accounts a
SET frozen = COALESCE((
    SELECT sum(t.reserve) FROM billing_transactions t
    WHERE t.account_id = a.id AND t.status NOT IN ('settled', 'released', 'rejected')
), 0), updated_at = now();
