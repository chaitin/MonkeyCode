DO $$
BEGIN
    RAISE EXCEPTION '旧系统分组授权已转换为用户授权，无法无损回滚；请恢复升级前的数据库备份';
END $$;
