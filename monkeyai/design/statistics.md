# 管理后台统计

统计路由由 `internal/stats` 显式注册并复用管理员 Cookie 鉴权。Agent token 和调用密钥没有访问权限。查询使用 PostgreSQL 只读 Repeatable Read 快照，单次请求限时 15 秒，返回 `private, no-store`。

## 时间口径

- 模型、用户、任务总览的近 90 天趋势统一按北京时间（`Asia/Shanghai`）自然日汇总，与 Pro 实例使用统计上报一致。接口的 `timezone` 返回 `Asia/Shanghai`。
- 每日窗口为 `[当天 00:00, 次日 00:00)`，以北京时间解释日期。今天仅统计到 `generated_at`，空白日期补零。每日模型积分也使用同一时区。
- 最近 24 小时、上一段 24 小时、最近 30 分钟及实时状态仍为滚动窗口，统一使用 `[from, until)`。滚动 24 小时与自然日是不同指标。
- 前端直接使用服务端返回的 `date` 绘制每日趋势，不按浏览器时区重新划分日期。

## 模型调用与 Token

`/api/admin/v1/statistics/models/overview` 按 `model_calls.completed_at` 统计已完成、非 `running` 的模型调用，返回近 24 小时、上一段 24 小时、近 30 分钟指标及 90 天趋势。

Token 和 TPM 与 Pro 上报采用同一用量判定：

1. 优先采用同 ID 的 `billing_transactions.usage.known`。
2. 没有该字段或计费交易时，以 `model_calls.error_code` 为空或 NULL 判断用量明确。
3. 只累计用量明确的输入和输出 Token，成功、失败、取消均可有真实用量。
4. 输入 Token 已包含缓存输入，不再叠加 `cached_input_tokens`。

上述规则同时用于模型总览的日趋势、两个 24 小时窗口和 TPM，以及 `/statistics/realtime` 的输入、输出和 TPM。调用次数、RPM、成功率、缓存命中率和耗时保留原有调用样本，不因用量不明而隐藏失败调用。

近 30 分钟平均响应耗时与平均首字耗时只使用成功调用，单位为毫秒：

- 响应耗时优先使用记录值，缺失时使用完成时间减开始时间；首字耗时只取实际采集到的流式样本。
- 两项指标分别排序，各自剔除最慢的 `floor(样本数 × 5%)` 条，再求算术平均值。不足 20 条时保留全部样本；相同耗时按条数截尾。
- 无有效样本返回 `null`，页面显示 `—`；有样本时换算成秒并保留一位小数。

积分净消费只累计 `credit_ledger_entries` 中 `category=model` 的 `charge` 和 `refund`，按 `occurred_at` 统计。额度发放、重置、人工调整不计入模型消费，纯退款窗口允许负值。调用与积分独立聚合，避免多笔流水放大调用量。金额以十进制字符串返回，前端数值转换只用于展示和绘图。

## 用户与任务

- `/statistics/users` 返回全部用户数、滚动 24 小时新增与活跃用户及每日趋势。新增按 `users.created_at`，包含软删除和停用用户；活跃按有 `session_turns` 记录的会话所属用户去重，以轮次开始时间归日。
- `/statistics/tasks/overview` 只统计上报启用、非占位、未删除或清理的根任务。新增按根任务开始时间；活跃按轮次开始时间，子任务归属根任务并去重。
- `/statistics/history` 按任务开始时间倒序并以 UUID 稳定排序，支持标题 / UUID、姓名 / 邮箱、时间与分页筛选。只展示上报启用、非占位、未删除或清理的根任务。
- `/statistics/realtime` 的活跃用户按有完成模型 / MCP 调用、有会话活动或仍在执行计费调用的真实用户 ID 去重，不代表登录 DAU。

Pro 上报使用独立统计台账，保留业务数据清理前的调用事实；管理后台查询业务表。清理过的历史记录仍可能导致两边总数不同。当日上报为最近成功发送的快照，可能落后于实时查询；对账时应使用相同实例、日期和截止时间。

## 验证

设置隔离的 `MONKEYAI_TEST_DATABASE_URL` 后运行 `go test ./internal/stats/...`。回归用例覆盖北京时间午夜、UTC 与北京时间日期不同、90 天起点、今日截止时间、空白日补零、每日积分归属，以及计费用量明确标记、历史调用回退和失败调用保留。

修改 SQL 后运行 `make generate`，使用 sqlc 生成查询代码；集成检查包括 `make sqlc-check`、`go test ./...`、`go vet ./...` 和管理前端测试。
