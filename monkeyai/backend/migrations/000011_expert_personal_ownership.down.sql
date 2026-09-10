DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM experts WHERE ownership_type = 'user' AND deleted_at IS NULL) THEN
        RAISE EXCEPTION '存在未删除的个人专家，不能回退专家归属迁移';
    END IF;
END $$;

DROP INDEX experts_user_name_key;
DROP INDEX experts_system_name_key;
CREATE UNIQUE INDEX experts_name_key ON experts(lower(btrim(name))) WHERE deleted_at IS NULL;
ALTER TABLE experts DROP COLUMN owner_user_id, DROP COLUMN ownership_type;
