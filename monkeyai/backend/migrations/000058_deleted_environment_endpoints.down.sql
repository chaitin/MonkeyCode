BEGIN;
-- 回滚联动逻辑，不重新授权已删除的云电脑。
DROP TRIGGER IF EXISTS revoke_deleted_environment_endpoint ON environments;
DROP FUNCTION IF EXISTS revoke_deleted_environment_endpoint();
COMMIT;
