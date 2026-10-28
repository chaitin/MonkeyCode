# 模型代理可靠性修复与排查

本次变更由 2026-10-27 的数据库死锁、流式用量告警和连接清理日志触发。

## 数据库锁

计费开户/入场以用户行锁序列化同用户操作，结算先更新账户，再插入包含用户外键的流水。原用户 `FOR UPDATE` 与外键检查需要的 `KEY SHARE` 不兼容，可形成“入场等待账户、结算等待用户”的环路。`LockUser` 改为 `FOR NO KEY UPDATE`，仍互斥同用户入场，但允许结算的外键检查。

会话状态更新不修改会话 ID，`LockSession` 和占位数量检查的 `LockReportingUser` 同样使用 `FOR NO KEY UPDATE`。清除会话树的强锁不变。两项数据库回归先在原锁下触发锁超时，再在调整后通过。

这只能证明并修复当前代码中的锁冲突，不能替代线上 PostgreSQL 死锁报告。再次出现 `40P01` 时，按 `request_id`、`phase` 和时间查找 PostgreSQL 的 DETAIL/CONTEXT、参与 SQL 与锁等待关系；不要根据 `model_id` 将问题归因于某个上游。不得通过重放整个代理请求来重试数据库事务。

## 代理与诊断

- `GetBody` 从最终改写后的请求体创建独立 reader，供 HTTP Transport 在允许的 GOAWAY 等场景重放；没有增加应用层 POST 重试。
- SSE 的 `[DONE]` 仅代表终止，不重复解析上一事件，已识别的 `response.completed` 等终止事件保留。
- `model.usage.failed` 仅表示最终用量未知；解析中途失败但已恢复用量的记录使用 DEBUG `model.usage.parse.recovered`。
- 区分 `parse_error_count` 和 `read_error_count`。解析诊断记录类型、字节偏移和事件类型，不记录响应正文或解析值。
- `response.incomplete` 补充 `incomplete_reason`，但继续保留业务失败状态和已知用量，避免改变计费语义。
- 非成功 HTTP 响应透传时最多旁路捕获 16 KiB，仅提取 JSON 错误的 code/type/param，经过日志字段过滤；正文、message、过大或不完整响应不参与诊断。
- 模型端点日志保留标准化 `route`，`phase` 区分 `resolve_model`、`ensure_session`、`billing_begin`、`billing_start`、`upstream`。

## 连接与认证

关闭路由在互斥锁下标记为已关闭，重复关闭直接返回；关闭后的控制通道不能重新附着。清理阶段忽略已关闭连接、EOF、session shutdown 和取消错误，真实探测超时仍记录 WARN，并带设备和启动标识。

未登录时缺少 Cookie、审计可选 UUID 为空不再产生内部错误告警。密钥验证与模型解析保留取消和截止时间错误，不将其转换为密钥无效；客户端取消的资源请求不再追加 ERROR 响应诊断。

## 用量对账

保留原有指数退避和 8 次上限，增加以下可检索事件：

- `billing.reconciliation.pending`：待重试原因、上游状态、响应 ID 和尝试次数。
- `billing.reconciliation.stopped`：重试耗尽或上游不支持/拒绝、用量缺失等原因。

停止操作进入现有单交易对账锁，只有实际停止调度才打印停止事件，状态继续为 `unknown`。通过 `transaction_id` 关联前一次 pending/失败事件了解最后的上游结果。

管理员使用现有 `/api/admin/v1/billing/reconciliation` 查找待核查交易，取得上游用量证据后通过 `/billing/transactions/{id}/resolve` 提交用量和核查原因。`/retry` 只适用于用量已确定的 `settling` 交易，不能用于未知结果；本次没有新增强制重放或自动扣费入口。

## 后续观察

按模型和上游聚合失败率、延迟、`40P01` 数量、未知用量占比、停止对账数量。确认对账积压和数据库连接占用后，再决定是否引入任务租约和有限并发，当前没有盲目提高上游请求量或超时上限。HTTP 502、TLS 超时、MCP 超时及上游断流仍需结合上游服务和网络侧证据排查。
