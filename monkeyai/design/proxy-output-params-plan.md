# 模型代理输出参数修复计划

分支：`fix-proxy-shadow-billing`，基于拉取后的 `main` 创建独立 worktree，并继承 `fix-proxy-output-params` 的未提交修复。

- [已完成] 前置任务：计费仅估算成本，不返回输出控制值；显式请求值不受模型配置压低。
- [已完成] 前置任务：代理透传输出参数，不注入、覆盖或删除；输出上限终止单独分类。
- [已完成] 集成任务：更新适配层，验证请求透传、流式与非流式诊断、用量结算，并完成全量测试和 vet。

验收：三个模型端点的输出参数保持客户端语义；未传不补；输出上限终止保留未完成状态、用量和原因，不记为上游故障。计费模型配置仍可用于成本估算，不能反向改写请求。

验证进度：

- [已完成] 三个端点的流式/非流式请求参数透传回归；未传不补，字段不覆盖、不删除。
- [已完成] Responses 输出上限终止记 WARN，明确失败仍记 ERROR；保持响应原文、未完成状态和已知用量。
- [已完成] `go test ./...`、`go vet ./...`、`git diff --check`；API 与迁移无改动，迁移序号及配对检查通过。
- [已完成] 独立 PostgreSQL + RustFS 环境的 `TestBillingIntegration` 与 `TestEstimatedModelBilling`；配置 100、请求 1000 的流式/非流式请求透传和结算通过。
- [已完成] 计费包数据库回归：本次新增的缺省、小于配置、大于配置估算及结算用例通过。完整运行中既有 `TestActivityWeeklyBackfillDeleteRace` 出现一次分区切换失败，单独复跑该用例和 `TestModelOutputEstimate` 均通过；未修改分区逻辑。

交付状态：实现与验证完成，进入提交与 PR 交付阶段。临时 PostgreSQL 与 RustFS 容器已清理，尚未部署。

后续核查：

- [已完成] 梳理 LLM proxy 请求与响应改写：请求体仍有 model 映射；计费引入的 include_usage 强制写入和请求重序列化已移除。URL、认证、幂等/会话/转发头、编码协商和响应追踪头有适配；响应业务正文未重写，默认 HTTP Transport 可自动解压 gzip。另有入站参数及请求大小校验。该核查发现的计费请求改写已在下述镜像计费调整中移除。

镜像计费调整：

- [已完成] 对照 `backend/biz/llmproxy/usage_capture.go`，确认复制响应、后台解析与记录的边界。
- [已完成] 前置任务：删除计费引入的请求体改写，所有结果与自配模型记录异步执行，镜像读取先关闭再结算。
- [已完成] 集成任务：验证原请求与响应透传、慢结算不阻塞客户端、关闭与取消、已知和未知用量；proxy 全量测试、race、全量测试与 vet 通过。

默认保留调用前余额校验、交易登记与幂等检查；不为计费强制 include_usage 或重序列化请求。镜像管道沿用参考实现的同步复制方式，后台解析仍有背压，数据库结算不再阻塞响应读取。

当前计费边界：调用前保留余额校验、交易登记、幂等检查和 Start；上游响应到达后，镜像解析、计费用量结算与自配模型记录异步执行。

镜像计费最终验证：

- [已完成] 成功、400、502 响应在结算阻塞时仍完整返回，退出等待覆盖未完成结算。
- [已完成] 计费请求保留原始 JSON 字节，覆盖未传 stream_options、include_usage=false、stream_options=null。
- [已完成] `go test ./...`、`go vet ./...`、`go test -race ./internal/proxy/...`、`git diff --check`。
- [已完成] 独立 PostgreSQL + RustFS 的 `TestBillingIntegration` 与 `TestEstimatedModelBilling` 通过。
- [已完成] API、迁移没有变更，迁移命名与配对测试已包含在全量测试中。

本次没有移除调用前校验；异步结算仍使用脱离请求取消、最长 30 秒的上下文，结算任务由代理 Wait 统一等待。临时测试容器已清理；分支进入 PR 交付阶段，尚未部署。

PR 交付：

- [进行中] 提交 `fix-proxy-shadow-billing` 分支并向 `main` 创建 PR，说明请求透传、异步结算边界及验证记录。
