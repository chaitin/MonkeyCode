# 数据库初始化

本次按重新部署要求，将原版本 000001—000004 与资源模型整合为一版：

- `000001_initial_create_schema.up.sql`：完整最终结构，包含身份、OAuth、调用密钥、模型、资源、计费及审计。
- `000001_initial_create_schema.down.sql`：依赖逆序撤销全部表，仅供可丢弃测试数据库验证。

必须连接**新的 PostgreSQL 数据库或数据目录**。仅重新创建容器并继续挂载旧目录不会重新执行版本 1；不要对旧库使用 `force 1` 代替初始化。此仓库改动不会清空现有数据库。

初始化：`migrate -path migrations -database "$MONKEYAI_DATABASE_URL" up`。首次成功后应为 `version=1, dirty=false`，再次执行为 `no change`。迁移镜像只包含这一对 SQL。

本次单版重置仅适用于本轮重新部署，后续正式发布的 schema 变更恢复追加版本。字符串统一使用 `text`，候选值使用 `CHECK`，名称按 `lower(btrim(name))` 约束唯一。
