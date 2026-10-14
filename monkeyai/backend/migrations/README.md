# 数据库迁移

本次按重新部署要求，将原 `000001` 至 `000013` 的最终结构收敛到一版初始化迁移：

- `000001_initial_create_schema.up.sql`：完整创建身份与邮箱认证、OAuth、调用密钥、分组、设置、模型、资源、连接与多凭证、专家、计费、统计索引及审计结构。
- `000001_initial_create_schema.down.sql`：按依赖逆序删除本版本的表、序列和计费流水保护函数，仅用于可丢弃测试数据库。

首次部署必须使用全新的 PostgreSQL 数据库或数据目录。重建容器但复用旧数据目录不构成全新初始化。收敛前的旧迁移历史不支持直接升级到当前迁移历史，也不能通过 `force 1` 代替数据迁移；需保留这类旧数据时应另行制定迁移方案。使用收敛后迁移历史的现有数据库正常追加迁移，版本 `14` 的升级步骤见下文。

从 `backend` 目录执行：

```sh
migrate -path migrations -database "$MONKEYAI_DATABASE_URL" up
migrate -path migrations -database "$MONKEYAI_DATABASE_URL" version
```

成功后 `schema_migrations` 应为 `version=21, dirty=false`，再次 `up` 返回 `no change`。可丢弃测试库执行 `down -all` 后再 `up`，应能完整重建。

初始化不预置用户、分组或业务设置。首次管理员由后端按部署环境变量创建，RustFS Bucket 由后端启动流程检查并按需创建。团队根节点仅用于界面展示，名称读取 `settings.branding.workspace_name`；顶层分组使用 `parent_id IS NULL`，成员关系通过 `group_users` 显式维护。

连接直接保存配置，专家直接关联连接；同一用户可以为同一连接创建多份凭证，每个连接最多保留一份未撤销的集中凭证。工具的组合外键防止跨连接引用凭证。计费账户校验冻结金额非负，允许调用结算后余额为负，流水触发器禁止修改和删除。

`migrations` 仍是结构定义的唯一来源。修改后在 `backend` 运行 `make generate` 更新 sqlc schema 与生成文件，再运行 `make check`；数据库集成测试验证有业务数据时的 `down → up`。迁移文件名和 up/down 配对由 `go test ./migrations` 检查。

新增迁移 `000003_group_quota_inheritance` 移除 `users.billing_group_id`，额度直接使用 `group_users`：个人自定义优先，多组取最高有效额度，无组继承团队。已有成员无需手工对齐；现有账户、余额与历史分组快照不修改。升级前备份，前后端需同步发布；down 仅恢复旧字段结构，不能恢复已移除的独立归属数据。

新增迁移 `000004_credit_account_overdraft` 允许余额为负及冻结额超过余额，仅保留冻结额非负约束。付费调用在可用积分（余额减冻结额）大于零时获准执行，完整预留费用，按实际用量结算；零或负可用积分不再接收新的付费调用，免费调用不受影响。百智云钱包自身的预扣限制不变。回滚前需结清负余额并释放超额冻结，否则回滚会失败，不会截断余额或改写历史流水。

本次单版重置是重新部署的特定安排。后续正式发布后的 schema 变更正常追加六位递增迁移版本，已发布迁移不再改写。字符串统一使用 `text`，候选值使用 `CHECK`。

## 从版本 14 升级

使用收敛后的迁移历史且当前状态为 `version=14, dirty=false` 的环境，支持原库升级，无需重建数据库或手动调整版本。升级前备份数据库并停止旧后端，使用与新后端配套的迁移包执行 `up`，将按以下顺序升级：

| 版本 | 变更 |
| --- | --- |
| `000015_billing_remove_credit_freeze` | 清零本地冻结积分，保留余额和历史流水 |
| `000016_outbound_proxy_add` | 增加出站代理设置与模型、连接器代理引用 |
| `000017_resource_import` | 创建资源导入批次、绑定表，增加资源多语言等字段 |
| `000018_resource_origin` | 区分本地与导入资源来源，调整系统资源名称唯一索引 |
| `000019_session_turn_content_add` | 增加轮次正文、截断标记及标题字段 |
| `000020_model_call_first_token_duration` | 为新产生的模型调用增加可空首字耗时；历史调用不回填 |
| `000021_video_output_metadata_optional` | 视频结果宽高允许为 0，表示元数据无法解析；成功视频仍可保存和下载 |

从 `backend` 目录执行：

```sh
migrate -path migrations -database "$MONKEYAI_DATABASE_URL" version
migrate -path migrations -database "$MONKEYAI_DATABASE_URL" up
migrate -path migrations -database "$MONKEYAI_DATABASE_URL" version
```

最终应为 `21` 且没有 dirty 标记；再次 `up` 返回 `no change`，随后启动新后端。Compose 部署使用配套的 `MIGRATE_IMAGE` 执行迁移服务，命令已配置为 `up`。

版本 `21` 回滚会恢复视频宽高必须大于 0 的约束；已有宽高为 0 的结果时，需先补齐真实宽高，回滚不会删除视频或伪造元数据。

升级回归测试使用独立临时 schema，通过真实 `migrate` CLI 验证版本顺序、业务数据保留、冻结额清理、新增结构与重复执行，需要本地安装 `migrate`：

```sh
MONKEYAI_TEST_DATABASE_URL="postgres://..." go test ./migrations -v
```
