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
