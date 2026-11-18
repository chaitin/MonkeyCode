BEGIN;
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM environment_billing_periods WHERE prepaid_until IS NOT NULL) THEN
  RAISE EXCEPTION '请先归档整小时预付账务记录，不能直接回退计费迁移';
 END IF;
END $$;
DROP INDEX IF EXISTS environment_billing_prepaid_expiry;
ALTER TABLE environment_billing_periods DROP CONSTRAINT IF EXISTS environment_billing_settled_duration;
ALTER TABLE environment_billing_periods DROP CONSTRAINT IF EXISTS environment_billing_prepaid_hour;
ALTER TABLE environment_billing_periods DROP COLUMN IF EXISTS prepaid_until;
ALTER TABLE environment_billing_periods ADD CONSTRAINT environment_billing_periods_check2
 CHECK(settled_seconds<=EXTRACT(EPOCH FROM confirmed_until-started_at));
COMMIT;
