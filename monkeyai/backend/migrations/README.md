# Migrations

存放 PostgreSQL 迁移。文件使用唯一 UTC 毫秒时间戳 `<YYYYMMDDHHMMSSmmm>_<feature>_<action>.{up,down}.sql` 命名；并行任务创建后必须检查版本未被占用，已经发布的迁移只追加、不改写。
