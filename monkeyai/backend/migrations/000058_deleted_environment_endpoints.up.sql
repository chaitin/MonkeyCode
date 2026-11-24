BEGIN;

CREATE OR REPLACE FUNCTION revoke_deleted_environment_endpoint() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    UPDATE endpoints d
    SET remote_access_state='revoked', registration_version=registration_version+1,
        grant_version=grant_version+1, updated_at=now()
    FROM environment_runtimes r
    WHERE r.environment_id=NEW.id AND d.user_id=NEW.user_id
      AND d.machine_id=r.machine_id AND d.execution_public_key=r.public_key
      AND d.remote_access_state<>'revoked';
    RETURN NEW;
END;
$$;

-- 升级前已提交、升级后才确认的删除也需要处理。
CREATE OR REPLACE TRIGGER revoke_deleted_environment_endpoint
AFTER UPDATE OF desired, phase ON environments FOR EACH ROW
WHEN (NEW.desired='deleted' AND (OLD.desired<>NEW.desired OR
      (NEW.phase='deleted' AND NEW.observed_generation=NEW.generation)))
EXECUTE FUNCTION revoke_deleted_environment_endpoint();

UPDATE endpoints d
SET remote_access_state='revoked', registration_version=registration_version+1,
    grant_version=grant_version+1, updated_at=now()
FROM environments e JOIN environment_runtimes r ON r.environment_id=e.id
WHERE e.deleted_at IS NOT NULL AND d.user_id=e.user_id
  AND d.machine_id=r.machine_id AND d.execution_public_key=r.public_key
  AND d.remote_access_state<>'revoked';

COMMIT;
