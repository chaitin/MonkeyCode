# 数据库迁移

本次按重新部署要求，将原 `000001` 至 `000013` 的最终结构收敛到一版初始化迁移：

- `000001_initial_create_schema.up.sql`：完整创建身份与邮箱认证、OAuth、调用密钥、分组、设置、模型、资源、连接与多凭证、专家、计费、统计索引及审计结构。
- `000001_initial_create_schema.down.sql`：按依赖逆序删除本版本的表、序列和计费流水保护函数，仅用于可丢弃测试数据库。

必须使用全新的 PostgreSQL 数据库或数据目录。重建容器但复用旧数据目录不构成全新初始化。此版本替换了旧迁移历史，不支持在已执行旧版迁移的数据库上直接升级，也不能通过 `force 1` 代替数据迁移；需保留旧数据时应另行制定迁移方案。本次代码收敛不操作现有部署数据。

从 `backend` 目录执行：

```sh
migrate -path migrations -database "$MONKEYAI_DATABASE_URL" up
migrate -path migrations -database "$MONKEYAI_DATABASE_URL" version
```

成功后 `schema_migrations` 应为 `version=1, dirty=false`，再次 `up` 返回 `no change`。可丢弃测试库执行 `down -all` 后再 `up`，应能完整重建。

初始化不预置用户、分组或业务设置。首次管理员由后端按部署环境变量创建，RustFS Bucket 由后端启动流程检查并按需创建。团队根节点仅用于界面展示，名称读取 `settings.branding.workspace_name`；顶层分组使用 `parent_id IS NULL`，成员关系通过 `group_users` 显式维护。

连接直接保存配置，专家直接关联连接；同一用户可以为同一连接创建多份凭证，每个连接最多保留一份未撤销的集中凭证。工具的组合外键防止跨连接引用凭证。计费账户从初始化起校验余额与冻结金额，流水触发器禁止修改和删除。

`migrations` 仍是结构定义的唯一来源。修改后在 `backend` 运行 `make generate` 更新 sqlc schema 与生成文件，再运行 `make check`；数据库集成测试验证有业务数据时的 `down → up`。迁移文件名和 up/down 配对由 `go test ./migrations` 检查。

本次单版重置是重新部署的特定安排。后续正式发布后的 schema 变更正常追加六位递增迁移版本，已发布迁移不再改写。字符串统一使用 `text`，候选值使用 `CHECK`。
