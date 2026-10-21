# 后端运行日志

后端以 JSON 输出安全的结构化运行日志。每个 HTTP 请求在完整路由入口生成本地 `request_id`，响应头为 `X-Request-ID`；客户端及上游同名头不能覆盖它。审计复用该 ID，模型的上游响应 ID 则写在 `response_id`，数据库中的原有对账 ID 语义不变。

普通请求完成记录为 DEBUG，健康检查成功不逐条记录。`http.request.completed` 表示 HTTP 处理结束；`model.call.completed` 表示上游或流式解析结束，两者可能发生在不同时间。HTTP 200、用量已知均不能单独证明模型调用成功。

## 配置

以下环境变量由创建根 logger 的独立入口读取；嵌入式 `server.Run` 使用调用方提供的最终 logger，不重新读取配置覆盖它。

| 环境变量 | 默认值 | 约束 |
| --- | --- | --- |
| `MONKEYAI_LOG_LEVEL` | `info` | 启动参数 `--log-level` 优先 |
| `MONKEYAI_LOG_DEDUP_ENABLED` | `true` | 布尔值 |
| `MONKEYAI_LOG_DEDUP_WINDOW` | `60s` | 1 秒至 10 分钟 |
| `MONKEYAI_LOG_DEDUP_MAX_KEYS` | `4096` | 128 至 65536 |

格式或范围无效会使入口启动失败，不回显配置值。关闭去重仍保留安全过滤、错误分类和请求关联。分钟级后台扫描的有效窗口至少为 5 分钟，实际重试节奏保持不变。

## 汇总与计数

只有代码明确登记的重复故障参与去重。首次故障直出，窗口内后续发生次数进入 `logging.error.summary`；没有后续请求时也由定时器刷新。持续窗口只输出摘要，完整空闲窗口后再次发生会直出首条。

摘要中的 `occurrence_count = detail_count + suppressed_count`，只统计该窗口。摘要保留原严重级别，最多保留三个关联 ID 样本；不能通过日志行数计算错误次数。关联 ID、时间及错误全文不参与指纹。任务与交易重试按对象隔离，上传块按上传 ID、块序号和阶段隔离。最终失败、审计失败、补偿和状态事件默认直出。

调用方可读取 `logging.Runtime.Snapshot()` 查看事件、压制、摘要、容量溢出、输出失败和 HTTP 完成计数。容量满时新指纹保守直出，不继续扩张内存。依赖恢复由实际执行检查的 worker 判断，先结算旧故障摘要，再输出一次恢复事件。

根 logger 的创建方在业务与其他模块全部结束、最终退出事件提交后调用 `Runtime.Close()`。关闭幂等，迟到事件直出；stdout 仍由创建方持有。强杀、进程崩溃及输出故障可能丢失日志，业务证据以原有审计和持久化状态为准。

## 部署

Compose 为各服务使用 `json-file` 轮转，默认每文件 20 MiB、保留 5 个文件，可通过 `MONKEYAI_LOG_MAX_SIZE`、`MONKEYAI_LOG_MAX_FILES` 调整。现有容器需要重建才能采用新的 Docker 日志驱动设置。多副本各自去重，容量预算还需乘以实例数量。

Nginx 日志调整暂缓，沿用本次 PR 之前的 access/error 日志配置；本次后端日志改造不改变 Nginx 的输出格式、开关和日志诊断范围。
