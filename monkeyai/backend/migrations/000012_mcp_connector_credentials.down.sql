DO $$ BEGIN
    RAISE EXCEPTION '多凭证结构不能无损恢复为单凭证；请恢复完整备份或另行完成数据归并，禁止静默删除凭证。';
END $$;
