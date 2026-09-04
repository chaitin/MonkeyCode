# MonkeyAI AI 资源本期暂不实现范围

> 状态：已确认边界
>
> 目的：防止首版实现时把预留结构误当成本期功能

## 1. 专家版本管理

本期不实现专家草稿、发布版本、回滚和历史版本。专家、成员提示词、关联 Rule 和 Skill 的修改即成为服务端最新配置，并影响后续新任务。

连续运行中的任务继续使用创建时快照。恢复历史任务时使用服务端最新专家配置重新生成快照。

## 2. Rule 和 Skill 版本表

本期不新增 `rule_versions`、`skill_versions`、`expert_versions` 或版本关联表。

- Rule 当前正文直接保存在 `rules.content`。
- Skill 当前包由 `skills.package_s3_key` 及其摘要定位。
- 历史文件记录虽然保留，但不形成可查询、可恢复的业务版本。
- 专家是否更新资源由每台 Desktop 的本地物化清单控制，不在服务端固定旧版本。

## 3. 通用文件历史与清理

本期不实现：

- 通用文件表和文件引用历史表；
- 专家提示词历史列表和恢复；
- Skill ZIP 历史列表和恢复；
- 旧图标、旧提示词和旧 Skill ZIP 的自动清理；
- 通用引用计数。

替换文件时生成新的 S3 Object Key 并更新业务表字段，旧对象保留。

服务端仍会使用临时对象、SHA-256 和格式校验保证新文件可用，但本期不自动清理以下对象：

- 文件写入成功但数据库事务失败的未登记孤儿对象；
- 业务资源更新后失去当前引用的旧对象；
- 被软删除且不再引用的文件对象。

## 4. 多 Agent 专家团调度

数据结构按照专家团预留，但本期只允许一个 `role = lead` 的有效成员，并由该成员独立完成任务。

本期不实现：

- `role = member` 成员调度；
- Lead 创建或委派子 Agent；
- 团队拓扑语义；
- 成员间 handoff、review、并行协作；
- 成员级模型或轮数配置。

`profile.team.topology` 本期只能是空数组，其元素结构留待后续版本定义。

## 5. 服务端个人专家

本期服务端仅保存管理员创建的系统专家。个人专家仅由 Desktop 本地管理，不上传、不跨设备同步，也不进入 MonkeyAI 的专家表。

个人专家分享采用本地 ZIP 文件，不经过服务端分享关系。

## 6. 个人 Connector 分享

用户私有 Connector Definition 和 Connector 仅本人使用，本期不支持：

- 通过 `resource_access_grants` 分享 Definition 或 Connector；
- 管理员将个人 Definition 转为系统 Definition；
- 在不同 MonkeyAI 服务端之间自动迁移个人 Connector；
- 分享 Credential。

本地专家导出可携带非敏感 Definition 配置，接收者导入后创建自己的 Definition 与 Connector。

## 7. Credential 加密与外部 Secret Manager

本期 OAuth Client Secret、OAuth Token 和认证 Header 按当前数据模型明文保存在 PostgreSQL。

本期不实现：

- 应用层信封加密；
- KMS 或外部 Secret Manager；
- Credential 历史；
- 密钥轮换和批量重加密。

API、日志、审计参数、错误消息和资源同步内容仍禁止返回敏感值。

## 8. OAuth 动态客户端注册

本期不支持 OAuth Dynamic Client Registration。管理员必须预先配置 `client_id`，需要 Secret 时同时配置 `client_secret`。

支持 RFC 8414 Metadata URL、OIDC `.well-known/openid-configuration` URL 和手工 Endpoint 三种配置，但不缓存 Discovery 解析结果。

## 9. 本地 stdio MCP 的安全增强

本地 stdio MCP 的 `env` 首版以明文写入权限为 `0600` 的本地配置文件。

本期不实现：

- stdio `env` 加密；
- 系统凭证库；
- Secret 引用与注入；
- 服务端 AAA、审计、统计和计费；
- stdio Connector 跨设备同步。

## 10. 服务端 stdio 与远程非 HTTP Transport

服务端 Connector 首版只支持 `streamable_http`，并可兼容远程 SSE。

本期不实现服务端启动 stdio MCP 进程，也不扩展其他自定义 Transport。

## 11. Rule 启停

本期不为 `rules` 增加 `enabled` 字段。Rule 可修改、解除关联和删除；被专家引用时禁止删除。

## 12. 高级资源治理

本期不实现：

- 专家资源变更原因表；
- 专家关联关系软删除历史；
- Connector Definition 审核流程；
- 工具重命名识别；
- 多 Connector 工具目录合并；
- Connector Definition 或 Profile 的结构化版本迁移工具；
- 已运行会话的资源热更新。

## 13. 已知首版限制

- 最近一次 Connector 的 `tools/list` 会覆盖 Definition 的共享工具目录；不同实例暴露不同工具时，最后一次结果为准。
- MCP 工具名称忽略大小写唯一，但调用上游时仍使用原始名称。
- `target_member_keys` 使用 JSONB，成员完整性只能由应用层校验。
- `default_model_id` 位于 Profile JSONB，只能由应用层校验模型引用。
- Desktop 未确认专家资源更新时，可继续使用本地旧 Skill 或旧 Rule 副本。

## 14. 知识库与专家知识库依赖

最新一期数据模型明确不包含知识库，因此本期不创建 `knowledge_bases`、`knowledge_contents` 或 `expert_knowledge_bases`。

未来实现时沿用本次已确认方案：

- 系统专家只能关联系统知识库；
- `expert_knowledge_bases` 包含 `expert_id`、`knowledge_base_id`、`target_member_keys`、`sort_order` 和 `created_at`；
- 同一专家不能重复关联同一知识库；
- 知识库仍执行用户权限交集，不享受专家委托授权；
- 无权限、禁用或不可用的知识库从任务中跳过并提示，不阻止专家启动；
- 知识库禁用时保留专家关系，重新启用后恢复；
- 专家 Manifest 只包含知识库关联配置，不包含知识库内容和学习状态；
- 知识库内容变化不触发专家资源更新。
