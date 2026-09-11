# Connector 多凭证实施计划

> 2026-09-11 迁移收敛：按本轮重新部署要求，原 1–13 版已折叠到 `000001` 完整初始化结构，仅支持全新数据库。下文旧增量迁移及验收记录保留为实施历史，当前部署以 [数据库迁移说明](../backend/migrations/README.md) 为准。

状态：多凭证认证、用户信息回包、全局 API Key 与凭证专属 MCP 地址均已完成实现与本地验收，通过 [PR #1275](https://github.com/chaitin/MonkeyCode/pull/1275) 交付，等待审查。依据 [设计方案](connector-auth-design.md)。

- [x] 同步 main，创建 `feat-connector-credentials` worktree，迁入已确认设计。
- [x] 数据迁移、歧义预检查、连接与凭证 SQL。
- [x] MCP 服务、OAuth/Header 多凭证、图标、工具与网关。
- [x] 专家直接依赖连接、目录与会话凭证选择、调用幂等。
- [x] 管理前端、两份 OpenAPI 与接入文档。
- [x] 多凭证隔离、OAuth 并发、迁移与全链路回归。
- [x] Go、sqlc、API、前端和最终变更检查。
- [x] 同步设计文档完成状态，核对交付分支与发布边界。
- [x] 推送实现分支并创建面向 `main` 的 PR，附验证结果与迁移要求。

验收结果（2026-09-11）：

- Go 1.27 下 `go test ./...`、`go vet ./...`、`make sqlc-check` 通过，sqlc 使用项目固定的 v1.30.0。
- PostgreSQL 与 RustFS 隔离环境全链路回归通过；覆盖凭证多份共存、工具目录隔离、共享撤权、会话选择、专家过滤、集中计费和跨凭证幂等。
- `go test -race ./internal/mcp/...` 通过；覆盖 Header 发现期间替换、OAuth 重复回调、并发重新授权、回调交换期间配置变化、刷新与撤销竞争、invalid_grant 和临时故障。
- 只读预检查与迁移演练通过；多候选阻断、显式映射、旧 ID/实例地址/图标/禁用状态保留、有损回滚拒绝。
- 管理前端 build、lint 和 43 项测试通过。浏览器实际验证创建连接、Header 保存后测试失败仍保留凭证、单独改名、秘密不回填；390px 宽度无横向溢出。
- 两份 OpenAPI 通过 Redocly 校验；存在 170 条非阻断风格告警（如未使用的公共组件和缺少 operationId）。

交付分支：`feat-connector-credentials`。生产迁移与部署未执行，按 [迁移与接入说明](connector-migration.md) 切换。Desktop/OhMyAgent 在本仓库交付 API 契约，外部加载器需采用返回的明确凭证绑定。

本轮调整：

- [x] 拉取 main 并创建 `feat-mcp-credential-urls` worktree。
- [x] 公开资源归属继续使用 `user: {id, name, email}`。
- [x] 全局 API Key 仅负责身份认证和 scope 检查，移除连接与凭证绑定字段。
- [x] 集中和独立凭证使用各自 `/mcp/connectors/{id}/credentials/{credential_id}`；免认证使用 `/mcp/connectors/{id}`。
- [x] 目录与专家解析下发具体凭证地址，工具恢复上游名称；同步 OpenAPI 和接入文档。
- [x] 完成模块、集成、并发及 API 校验，核对迁移与生成文件。
- [x] 更新 PR #1275 的代码、描述和验收结果。

本轮验收结果（2026-09-11）：

- Go 1.27.1 下 `go test -race ./... -count=1` 全量通过 315 项测试，失败与跳过均为 0；使用独立 PostgreSQL schema 与专用 RustFS 测试 Bucket。
- 覆盖同一个全局 Key 跨连接和凭证调用、集中和独立凭证地址、同名工具隔离、地址越权拒绝、凭证撤销与替换、资源分享撤销、密钥轮换与撤销、OAuth 刷新和计费幂等。
- `go vet ./...`、`make sqlc-check`、Go 格式与变更检查通过；SQL 生成器沿用项目固定的 v1.30.0。
- 两份 OpenAPI 通过 Redocly、重复字段及本地引用校验，保留 172 条非阻断风格告警。已确认 Nginx 与 Vite 转发 `/mcp` 前缀的全部子路径。
- 最终只需迁移 `000012_mcp_connector_credentials`，API Key 表无需增加绑定字段。生产迁移与部署未执行。

凭证回包精简调整：

- [x] 拉取 main，复用本轮已创建的 `feat-credential-user-response` worktree。
- [x] 移除 Connector、凭证目录及专家解析中的 `tools_path`。
- [x] 凭证统一返回平台用户 `user: {id, name, email}`，集中凭证为 `null`。
- [x] 同步管理端类型、两份 OpenAPI、设计与接入说明。
- [x] 完成凭证回包、目录和专家解析验证，以及 Go、API 和前端检查。
- [x] 提交并推送至 PR #1275，更新 PR 描述与验收结果。

凭证回包调整验收结果（2026-09-11）：

- Go 1.27.1 下 `go test ./... -count=1` 全量通过 316 项测试，失败和跳过均为 0；使用隔离 PostgreSQL schema 与专用 RustFS 测试 Bucket。
- 覆盖凭证新增、详情、更新、列表、管理端工具上下文、共享连接接收方归属、集中凭证 `user: null`、用户资料更新后的目录版本，以及 Connector 和专家解析移除 `tools_path`。
- `go vet ./...`、`make sqlc-check`、Go 格式、迁移序号配对及变更检查通过；数据库表结构无需调整。
- 两份 OpenAPI 通过 Redocly、重复字段和本地引用校验，保留 172 条已有非阻断风格告警。
- 管理前端 build、lint 和 43 项测试通过；凭证选择器改为显示所属用户姓名或邮箱。构建保留已有 bundle 大小提示。
