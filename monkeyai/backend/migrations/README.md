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

成功后 `schema_migrations` 应为 `version=41, dirty=false`，再次 `up` 返回 `no change`。可丢弃测试库执行 `down -all` 后再 `up`，应能完整重建。

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
| `000022_video_poll_retry_limit` | 限制视频任务轮询失败次数和总时长 |
| `000022_video_poll_retry_limit` | 限制视频任务轮询失败次数和总时长 |
| `000023_video_seedance_provider` | 视频模型供应商增加 `volcengine` 和 `agnes`；up/down 均可在约束存在或缺失时重复执行 |
| `000024_remote_runtime` | 合并设备授权族、设备证明、中转连接、会话目录、独立设备码授权和独立密钥绑定 |
| `000025_remote_runtime_access_version` | 为连接权限代次增加独立 access_version，区分票据轮换和权限收窄 |
| `000026_endpoint_platform_text` | 设备平台改为非空、最多 64 字节的文本，不再限制固定枚举 |
| `000027_resource_import_uploads` | 增加资源包分片上传与续传任务 |
| `000028_stats_model_hourly` | 回填模型调用及模型账本的小时汇总，并安装事务内增量维护触发器 |
| `000029_billing_ledger_weekly` | 准备账本周分区、全局幂等登记和镜像，由新后端分批回填、校验及切换 |
| `000030_design_catalog_snapshots` | 增加设计模板目录快照 |
| `000031_session_client_runtime_add` | 扩展会话客户端类型 |
| `000032_billing_activity_weekly` | 准备交易、模型／工具／生图／视频调用周分区，由后台回填、校验和切换 |
| `000033_resource_admin_overrides` | 增加导入资源的管理端覆盖配置 |
| `000034_session_turns_monthly` | 准备轮次月分区、全局轮次登记、镜像和会话计数校准，由后台恢复回填并切换 |
| `000035_billing_activity_lock_retry` | 交易／调用周分区预建遇到锁竞争时返回可重试状态 |
| `000036_user_profile_add` | 增加独立的自定义头像字段、本人修改密码的尝试次数记录，以及待兑换设备批准的用户索引 |
| `000037_oauth_pairing` | 新增一次性手机扫码配对，保存凭据摘要、PKCE、状态及轮询退避信息 |
| `000038_cloud_environments` | 云环境、宿主接入、执行授权与调度 |
| `000039_environment_directory_storage` | 普通目录预设允许零存储额度 |
| `000040_engine_host_deletion` | 宿主软删除与调度保护 |
| `000041_environment_defaults` | 全局环境预设引用与统一默认用户配额 |

从 `backend` 目录执行：

```sh
migrate -path migrations -database "$MONKEYAI_DATABASE_URL" version
migrate -path migrations -database "$MONKEYAI_DATABASE_URL" up
migrate -path migrations -database "$MONKEYAI_DATABASE_URL" version
```

最终应为 `41` 且没有 dirty 标记；再次 `up` 返回 `no change`，随后启动新后端。Compose 部署使用配套的 `MIGRATE_IMAGE` 执行迁移服务，命令已配置为 `up`。

版本 `28` 首次升级会锁定调用、计费交易和账本写入，并在结构变更锁持有期间阻塞调用表读取；同时扫描历史数据完成回填，请停止旧后端并安排迁移窗口；升级后每次调用完成、状态/用量修正、退款均在原事务内增量维护。版本 `28` 回滚只删除统计投影与新增标记，保留原始调用和账本，再次升级可完整重建。

版本 `29` 的结构准备仍需维护窗口；启动新后端后，账本 worker 在后台按固定水位分批搬迁，数据库迁移版本为 29 不代表账本已经切换。通过 `billing_ledger_partition_state` 查看进度。启动及每 24 小时预建当前与未来 8 周，默认分区接受意外时间。观察期保留旧表事务内镜像，可用 `billing_finish_ledger_observation()` 显式结束，历史数据不自动删除。回滚前停止后端及业务读写；down 始终从权威分区表补齐旧副本缺失记录，不能只信任观察期标志，需预留维护时间与空间。默认分区总积压超过 10000 条时暂停自动 DDL 并告警，避免 ATTACH 扫描巨大默认分区。详见 [账本周分区运行方案](../../design/billing-weekly-partitions.md)。

版本 `34` 保持 `sessions` 普通表，将轮次按上海自然月分区。结构准备后由独立会话 worker 分批校准 `turn_count` 和回填事实，状态见 `session_turns_partition_state`；迁移版本为 34 不表示数据已全部切换。两个历史列表改用 `has_next`，前后端需配套发布，未校准的对话数暂为 `null`。回滚始终恢复权威数据的新增、修改和删除。发布窗口、默认分区搬迁、结束观察和回滚操作见 [轮次月分区运行方案](../../design/session-turn-monthly-partitions.md)。

版本 `35` 将交易／调用周分区预建中的 `55P03` 锁竞争转为返回 `false`，本次尝试整体回滚，由新后端按表一分钟后重试；成功后仍间隔 24 小时检查。默认分区积压超限、分区名称冲突等错误继续告警。只更新维护函数，不修改业务数据；down 恢复原错误行为。

版本 `36` 为 `users` 增加可空的 `custom_avatar_url`，不回填或修改已有 `avatar_url`；后者继续由 OAuth 同步。身份认证、成员、授权选择器、审计、账单、反馈、客户端和历史统计统一优先显示非空的自定义头像。本人头像上传/清除和密码修改不涉及成员创建与席位写入。须先执行迁移再启动新后端；新头像保存在现有对象存储。改密会同时取消已批准但未兑换的设备申请，新增部分索引按用户查找这类申请。宿主 OAuth 写入应继续仅更新同步字段，不应写入 `custom_avatar_url`。down 会删除自定义头像覆盖信息、密码尝试记录和设备批准索引，不删除同步头像或密码，也不会遍历清理对象存储。

版本 `37` 创建 `oauth_pairing_requests` 和过期、创建者状态、设备码摘要索引；手机端只取得账号级登录态，不登记执行设备。新后端修改密码时依赖该表撤销未兑换配对，因此须先迁移再启动。down 会删除全部一次性配对记录，再 up 只恢复空表；已签发的 OAuth 授权与令牌不由此表管理。

版本 `23` 回滚会恢复视频供应商约束；版本 `24` 回滚会移除远程执行新增结构；版本 `26` 回滚会恢复设备平台枚举，需先处理旧枚举以外的平台记录，否则回滚失败，不会静默改写平台值。已有生产数据回滚前必须先备份并按部署方案确认，测试 down/up 只用于隔离数据库。

升级回归测试使用独立临时 schema，通过真实 `migrate` CLI 验证版本顺序、业务数据保留、冻结额清理、新增结构与重复执行，需要本地安装 `migrate`：

```sh
MONKEYAI_TEST_DATABASE_URL="postgres://..." go test ./migrations -v
```

`000024_remote_runtime` 的 up/down SQL 将当前工作树新增的远程执行结构作为一个版本执行，支持重复执行。重复升级保留已有授权族、刷新链、设备版本、会话摘要和密钥绑定；旧 token 只在尚未绑定授权族时回填。重复回滚会保留既有撤销时间和原因，重新升级不会恢复已撤销凭据。

`TestRuntimeMigrationsIdempotent` 使用真实 PostgreSQL 验证 `000024_remote_runtime` 重复执行、完整迁移组重跑及回滚后重新升级，并检查业务数据、约束和旧写入触发器。`migrate up` 的 `no change` 检查仍单独保留。

### 000038_cloud_environments

云电脑能力统一使用一个迁移版本，包含宿主安装接入、环境预设、宿主容量、用户额度、环境及操作记录、runtime 身份绑定，以及 environment:read/manage 的 OAuth 授权约束。up 在同一事务中创建全部结构，down 在同一事务中按依赖逆序回滚；历史 1～37 版本不变。

先执行 38、39，再发布后端、engine 和兼容镜像；默认不启用新宿主调度，旧 token 不自动扩权。回滚前停止并确认所有实例、撤销云环境执行授权并备份控制记录。down 撤销含环境权限的客户端授权族与 token，过期相关未完成授权请求和授权码，再删除云环境及宿主控制记录；不会清理宿主容器或持久数据。重新升级不恢复已撤销凭据，无环境权限的其他客户端授权不受影响。

本分支迁移随主线顺延为 38、39，主线 36、37 分别为账户资料和扫码配对。已应用旧编号云环境迁移的测试库不能直接使用新版迁移包，也不能通过 force 跳过版本；可丢弃测试库需使用原迁移包回滚或重建，需保留数据时先备份并单独制定迁移。

### 000039_environment_directory_storage

普通目录模式允许预设的 storage_bytes 为零，不设置磁盘硬配额。回滚至 38 前必须处理零容量预设，否则约束恢复会拒绝回滚，不会伪造限额。

### 云环境迁移幂等性

`000038_cloud_environments` 和 `000039_environment_directory_storage` 的 up/down SQL 支持按顺序重复执行。重复 up 保留已有宿主、预设、环境、运行身份和普通目录的零容量配置；重复 down 不重复增加授权撤销版本，也不会恢复已撤销的凭据。39 的 down 在存在零容量预设时仍拒绝回滚，并在事务中保留原数据与约束。

幂等执行以已有对象结构与本迁移兼容为前提，不替代数据库版本历史修复，也不自动修复任意结构差异。旧编号测试库仍按上文处理。真实 PostgreSQL 回归覆盖 SQL 重放、数据保留、约束生效、回滚失败保护和重新升级。

版本 `41` 幂等创建默认配置，初始配额保持原有值（3 个环境、2 个同时运行、8 核、16 GiB）。管理端在宿主管理的「配置环境」中一次保存共享预设、默认配额和当前宿主容量。已有个人配额与环境规格不变；重复执行 up 保留管理员配置。down 删除全局配置，不删除预设或环境；重新 up 会恢复初始默认配额。升级需同步发布前后端。
