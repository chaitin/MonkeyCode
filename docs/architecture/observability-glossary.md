# MonkeyCode 可观测性术语表

## 领域标识

| 术语 | 遥测字段 | 定义 |
| --- | --- | --- |
| 任务 | `monkeycode.task.id` | MonkeyCode 中的长生命周期业务聚合。一个任务可关联多条 Trace |
| Agent 执行会话 | `monkeycode.agent.session.id` | 一次 Agent 执行上下文，不等同于终端会话 |
| 业务请求 | `monkeycode.request.id` | 一次命令、交互或请求响应配对标识，不等同于 Trace ID |
| 项目 | `monkeycode.project.id` | MonkeyCode 项目标识 |
| 虚拟机 | `taskflow.vm.id` | Taskflow 管理的执行环境标识 |
| 终端会话 | `taskflow.terminal.session.id` | 一次终端连接会话，不等同于 Agent 执行会话 |

现有协议和数据库中的 `task_id`、`session_id`、`request_id` 不重命名。写入 Trace 时必须映射到语义明确的规范字段。

## 追踪术语

| 术语 | 定义 |
| --- | --- |
| Trace | 一次有边界的技术调用链。一个 MonkeyCode 任务通常包含多条 Trace |
| Span | Trace 中的一个操作，例如处理 HTTP 请求或调用 Taskflow |
| Trace Context | 由 `traceparent` 和 `tracestate` 表示的跨进程因果上下文 |
| Span Link | 将异步 Trace 与先前 Trace 建立关系，不形成长期父子 Span |
| Baggage | 可随 Trace Context 传播的业务数据容器。本设计不使用它传播业务 ID |
| 根 Trace | 没有上游父 Span 的 Trace。MonkeyCode 公网入口会创建新的根 Trace |
| 连接 Span | 描述 WebSocket 或 gRPC 长连接建立、断开与重连的 Span，不覆盖全部流消息生命周期 |
| 边界 Span | Taskflow 对 Agent 发送、等待或接收行为的观测。Agent 内部仍是黑盒 |
| 尾部采样 | Collector 收到完整候选 Trace 后，根据错误、耗时和属性决定是否保留 |

## 存储与查询

| 组件 | 职责 |
| --- | --- |
| OpenTelemetry SDK | 在 MonkeyCode、Taskflow 进程内创建并批量导出 Span |
| OpenTelemetry Collector | 接收 OTLP、执行尾部采样并转发 Trace |
| Tempo | 存储 Trace 数据 |
| VictoriaLogs | 存储 MonkeyCode、Taskflow 的结构化运行日志 |
| Grafana | 查询 Trace 和日志，提供二者之间的跳转入口 |
| Loki 任务日志 | Taskflow 当前用于任务输出流的业务存储，不等同于服务运行日志 |

## 结果语义

| 结果 | `task.outcome` | Span 状态 |
| --- | --- | --- |
| 成功 | `succeeded` | Unset |
| 系统或执行失败 | `failed` | Error |
| 用户主动取消 | `cancelled` | Unset |
| 参数、权限、配额或并发限制拒绝 | `rejected` | Unset |

## 信任边界

- 公网客户端传入的 Trace Context 默认不可信，MonkeyCode 创建新的根 Trace。
- 经过认证的 MonkeyCode 到 Taskflow 请求可以传播 Trace Context。
- 经过认证的 Taskflow 回调可以向 MonkeyCode 传播 Trace Context。
- Agent 不传播 Trace Context，本次不改动 Agent。

## 数据分类

允许进入 Trace 的数据包括服务资源信息、路由模板、状态码、规范化业务 ID、耗时、重试次数和错误分类。

Prompt、模型回复、代码、文件内容、完整路径、请求响应正文、查询参数、仓库地址、认证信息、个人信息、SQL 参数、Redis Key/Value 和原始第三方错误正文属于禁止采集数据。
