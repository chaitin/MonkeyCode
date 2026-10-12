UPDATE credit_accounts SET frozen = 0, updated_at = now() WHERE frozen <> 0;
