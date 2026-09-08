BEGIN;

-- 降级前须显式撤销全员授权，避免静默丢失访问范围。
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM resource_access_grants WHERE all_users) THEN
        RAISE EXCEPTION '请先撤销全员授权，再回滚迁移';
    END IF;
END
$$;

DROP INDEX resource_access_grants_all_users_key;

ALTER TABLE resource_access_grants
    DROP CONSTRAINT resource_access_grants_subject_check,
    DROP COLUMN all_users,
    ADD CONSTRAINT resource_access_grants_subject_check CHECK (
        (user_id IS NOT NULL)::integer + (group_id IS NOT NULL)::integer = 1
    );

COMMIT;
