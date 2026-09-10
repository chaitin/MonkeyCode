# MCP 代理实施状态

目标：补齐 MonkeyAI HTTP MCP 工具代理，使标准客户端可从资源目录取得入口，使用 `mcp:invoke` 调用密钥完成握手、工具发现和调用。

- [x] 同步 main，创建 `feat-mcp-proxy` worktree，确认既有授权和计费边界。
- [x] MCP 协议校验、版本协商、通知、上游会话清理和 OAuth 刷新。
- [x] Agent 下发 `invoke` 能力与代理地址，接通 Nginx 和开发代理，更新接口契约。
- [x] 协议回归、数据库/计费集成、完整 Go 检查和代理配置验证。

采用无状态 Streamable HTTP 工具入口：POST 返回 JSON，解析上游 JSON/SSE；GET 和 DELETE 返回 405。不维护客户端 MCP 会话，不宣告服务端推送、resources、prompts 或双向交互能力。每次工具调用独立建立上游会话，结束后释放；未知调用结果不重放，沿用已有计费核查流程。


验证结果（2026-09-08）：

- Go 1.27.1 下 `go test ./... -count=1` 全部通过，使用独立随机 PostgreSQL schema 和专用 RustFS 测试 Bucket；`go vet ./...`、`make sqlc-check` 通过。
- 覆盖调用密钥作用域、资源授权、模板/工具禁用、独立凭证目录隔离、凭证撤销、OAuth 到期刷新、三种认证模式计费、JSON/SSE 响应、幂等去重、无效结果保留核查及参数精度。
- 两份 OpenAPI 的重复键与本地引用校验通过。Nginx 配置检查、容器内真实 POST 转发及 Vite 开发代理转发验证通过，认证 Header 正确保留。
- 已完成实现与验证，进入 PR 评审交付阶段；使用 `feat-mcp-proxy` 分支，主工作树保持原状。合并与部署另行执行。

兼容性修复（2026-09-10）：

- [x] 同步 main，在独立 worktree 创建 `fix-mcp-null-params` 分支。
- [x] 复现 `tools/list` 携带 `params: null` 时返回 `-32602`；将顶层 null 参数视为未传参数，继续拒绝数组和标量，并保留各方法的必填参数校验。
- [x] 补充空参数、无效参数类型、调用参数精度及元数据保真的协议回归；Go 1.27.1 下 `go test ./internal/mcp/... -count=1 -v` 和 `go vet ./internal/mcp/...` 通过，使用本地专用 PostgreSQL 测试容器及独立随机 schema，无跳过的测试。
- 当前修复已完成本地验证，进入 PR 评审交付阶段；使用 `fix-mcp-null-params` 分支，尚未合并或部署。

个人 MCP 工具修复（2026-09-10）：

- [x] 同步 main，创建独立 worktree 与 `fix-personal-mcp-tools` 分支。
- [x] 通过真实 PostgreSQL 和 HTTP 上游复现“发现 5 个工具，个人工具接口返回 0 个”：发现结果默认禁用，个人连接缺少启用入口。
- [x] 个人连接发现工具时自动启用，重复发现修复旧禁用记录；系统连接重复发现保留管理员的启停与积分配置。
- [x] 新增 `000010_mcp_enable_personal_tools` 数据迁移，启用已有个人连接当前配置版本下未删除的工具；down 保留数据修复结果。
- [x] 验证自定义/系统模板、无认证/Header/OAuth、重复发现、凭证撤销、用户隔离、目录版本更新、代理工具发现与零积分调用；覆盖数据迁移 up/down/up 和系统工具状态保护。
- [x] Go 1.27.1 下 `go test ./... -count=1 -json` 通过 285 项、跳过 0 项；`go vet ./...`、`make sqlc-check`、OpenAPI 重复键和本地引用检查通过。数据库使用独立随机 schema，对象存储使用专用测试 Bucket。
- 当前实现与本地验证完成，使用 `fix-personal-mcp-tools` 分支进入 PR 评审交付阶段，尚未合并或部署。部署时需执行版本 10 迁移，使已有个人工具无需重新发现即可下发。
