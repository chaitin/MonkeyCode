BEGIN;
DO $$
DECLARE rel regclass; has_records boolean;
BEGIN
 IF to_regclass('environment_billing_periods') IS NOT NULL THEN
  IF EXISTS(SELECT 1 FROM environment_billing_periods WHERE closed_at IS NULL OR settled_amount>0) THEN
   RAISE EXCEPTION '请先停止环境计费并归档环境账务记录，再回退云环境迁移';
  END IF;
 END IF;
 FOR rel IN
  SELECT source_relation FROM billing_activity_partition_state WHERE table_name='billing_transactions'
  UNION SELECT target_relation FROM billing_activity_partition_state WHERE table_name='billing_transactions'
  UNION SELECT source_relation FROM billing_ledger_partition_state
  UNION SELECT target_relation FROM billing_ledger_partition_state
 LOOP
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM %s WHERE category=''environment'')',rel) INTO has_records;
  IF has_records THEN
   RAISE EXCEPTION '存在环境账务记录，不能直接回退云环境迁移';
  END IF;
 END LOOP;
 IF to_regclass('host_upgrades') IS NOT NULL THEN
  IF EXISTS(SELECT 1 FROM host_upgrades WHERE status IN ('pending','running')) THEN
   RAISE EXCEPTION 'cannot roll back while host upgrades are pending';
  END IF;
 END IF;
 IF to_regclass('environment_operations') IS NOT NULL THEN
  IF EXISTS(SELECT 1 FROM environment_operations WHERE kind='runtime_upgrade' AND status='pending') THEN
   RAISE EXCEPTION 'cannot roll back while runtime upgrades are pending';
  END IF;
 END IF;
 IF to_regclass('environments') IS NOT NULL THEN
  IF EXISTS(SELECT 1 FROM environments WHERE NOT(desired='deleted' AND phase='deleted' AND generation=observed_generation)) THEN
   RAISE EXCEPTION 'cannot roll back while environments have not been confirmed deleted';
  END IF;
 END IF;
END $$;
WITH changed AS (
 UPDATE oauth_grants SET
 scopes=array_remove(array_remove(scopes,'environment:read'),'environment:manage'),
 revoked_at=COALESCE(revoked_at,now()),
 revoke_reason=COALESCE(revoke_reason,'environment_scope_rollback'),
 revocation_version=revocation_version+1
 WHERE scopes && ARRAY['environment:read','environment:manage']::text[]
 RETURNING id
)
UPDATE oauth_tokens SET revoked_at=COALESCE(revoked_at,now()) WHERE grant_id IN(SELECT id FROM changed);
UPDATE oauth_authorization_requests SET expires_at=LEAST(expires_at,now()) WHERE scopes && ARRAY['environment:read','environment:manage']::text[];
UPDATE oauth_authorization_codes SET expires_at=LEAST(expires_at,now()) WHERE scopes && ARRAY['environment:read','environment:manage']::text[];
ALTER TABLE oauth_grants DROP CONSTRAINT IF EXISTS oauth_grants_scopes_check;
ALTER TABLE oauth_grants ADD CONSTRAINT oauth_grants_scopes_check CHECK(
 scopes <@ ARRAY['device:bind','device:publish','device:connect','device:manage',
 'session:report','session:read','session:control','files:read','files:write','resources:manage']::text[]
);
DELETE FROM resource_access_grants WHERE resource_type='host';
ALTER TABLE resource_access_grants DROP CONSTRAINT IF EXISTS resource_access_grants_resource_type_check;
ALTER TABLE resource_access_grants ADD CONSTRAINT resource_access_grants_resource_type_check
 CHECK(resource_type IN ('model','skill','rule','connector','expert','kb'));

DROP TABLE IF EXISTS environment_billing_periods;
DROP TABLE IF EXISTS environment_operations,environment_runtimes,environments,environment_quotas;
DROP TABLE IF EXISTS host_upgrades,host_environment_configs;
DROP TABLE IF EXISTS hosts;

DO $$
DECLARE rel regclass; child regclass;
BEGIN
 FOR rel IN
  SELECT source_relation FROM billing_activity_partition_state WHERE table_name='billing_transactions'
  UNION SELECT target_relation FROM billing_activity_partition_state WHERE table_name='billing_transactions'
 LOOP
  EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS billing_transactions_category_check',rel);
  FOR child IN SELECT relid FROM pg_partition_tree(rel) WHERE level>0 ORDER BY level LOOP
   EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS billing_transactions_category_check',child);
  END LOOP;
  EXECUTE format('ALTER TABLE %s ADD CONSTRAINT billing_transactions_category_check CHECK (category IN (''model'',''tool'',''image'',''video''))',rel);
 END LOOP;
 FOR rel IN SELECT source_relation FROM billing_ledger_partition_state UNION SELECT target_relation FROM billing_ledger_partition_state LOOP
  EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS credit_ledger_entries_category_check',rel);
  FOR child IN SELECT relid FROM pg_partition_tree(rel) WHERE level>0 ORDER BY level LOOP
   EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS credit_ledger_entries_category_check',child);
  END LOOP;
  EXECUTE format('ALTER TABLE %s ADD CONSTRAINT credit_ledger_entries_category_check CHECK (category IN (''model'',''tool'',''image'',''video'',''other''))',rel);
 END LOOP;
END $$;
COMMIT;
