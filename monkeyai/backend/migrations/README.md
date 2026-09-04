# Migrations

存放 PostgreSQL 迁移。使用 `migrate create -ext sql -dir migrations -seq <feature>_<action>` 创建文件，采用默认六位递增序号。合并前必须检查序号未被其他分支占用；如有冲突，重新生成序号。已经发布的迁移只追加、不改写。

可变长度字符串统一使用 `text`，不使用 `varchar` 设置长度上限；固定候选值通过 `CHECK` 约束限制。
