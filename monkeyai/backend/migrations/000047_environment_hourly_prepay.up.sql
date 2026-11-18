BEGIN;
ALTER TABLE environment_billing_periods ADD COLUMN IF NOT EXISTS prepaid_until timestamptz;
ALTER TABLE environment_billing_periods DROP CONSTRAINT IF EXISTS environment_billing_periods_check2;
ALTER TABLE environment_billing_periods DROP CONSTRAINT IF EXISTS environment_billing_settled_duration;
ALTER TABLE environment_billing_periods ADD CONSTRAINT environment_billing_settled_duration
 CHECK(settled_seconds<=EXTRACT(EPOCH FROM COALESCE(prepaid_until,confirmed_until)-started_at));
ALTER TABLE environment_billing_periods DROP CONSTRAINT IF EXISTS environment_billing_prepaid_hour;
ALTER TABLE environment_billing_periods ADD CONSTRAINT environment_billing_prepaid_hour
 CHECK(prepaid_until IS NULL OR prepaid_until=started_at+interval '1 hour');
CREATE INDEX IF NOT EXISTS environment_billing_prepaid_expiry ON environment_billing_periods(environment_id,prepaid_until DESC) WHERE prepaid_until IS NOT NULL;
COMMIT;
