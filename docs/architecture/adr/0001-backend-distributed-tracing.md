# ADR-0001：MonkeyCode Backend 分布式追踪

- 状态：已接受
- 日期：2026-07-16
- 决策者：MonkeyCode 团队

## 背景

MonkeyCode Backend 是用户任务进入服务端后的业务入口，并通过 HTTP、WebSocket 等方式调用 Taskflow。当前排障主要依赖业务日志以及 `task_id`、`session_id`、`request_id` 等字段，无法稳定还原一次操作在 MonkeyCode 与 Taskflow 之间的技术因果关系。

本次建设从 MonkeyCode Backend 开始，不改动 Web、Desktop、Mobile，也不改动 VM Agent 或 Coding Agent。客户端请求进入 MonkeyCode 后创建新的 Trace；Taskflow 到 Agent 的交互由 Taskflow 记录为黑盒边界。

## 决策

采用 OpenTelemetry 和 W3C Trace Context 建设 MonkeyCode Backend 到 Taskflow 的分布式追踪。一个 MonkeyCode 任务不是一条持续数小时的 Trace，而是由多条短生命周期 Trace 组成，并通过 `monkeycode.task.id` 聚合。同步调用使用父子 Span，异步阶段使用 Span Link。

```text
公网客户端
    │ 不信任外部 traceparent
    ▼
MonkeyCode Backend ── traceparent ──▶ Taskflow ──▶ Agent 黑盒边界
    ▲                                  │
    └──────── traceparent ─────────────┘
                 回调

MonkeyCode / Taskflow ── OTLP ──▶ OpenTelemetry Collector ──▶ Tempo
MonkeyCode / Taskflow ── structured logs ──▶ VictoriaLogs
```

### Trace 入口与信任边界

- MonkeyCode 的公网业务接口忽略客户端传入的 `traceparent` 和 `tracestate`，创建新的根 Trace。
- 未来若由受控网关创建 Trace，只能信任经过网关清洗并重新注入的上下文。
- Taskflow 内部回调端点允许提取经过认证的 Taskflow Trace Context。
- 不使用 OpenTelemetry Baggage 传播业务字段。

### 传播规则

- MonkeyCode 调用 Taskflow 时，通过 W3C `traceparent` 和 `tracestate` 传播上下文。
- HTTP 使用标准 Header；WebSocket 仅在握手阶段传播连接上下文。
- Token、日志片段、终端字节流和心跳不逐条创建 Span。
- `task_id`、`session_id`、`request_id`、`vm_id` 继续通过现有参数和消息体传递，由两端写入 Span 属性与结构化日志。
- Taskflow 发起的异步回调形成新的 Trace，MonkeyCode 将回调处理作为该 Trace 的下游 Span。

### Span 粒度

只追踪跨边界调用和关键业务阶段，不为普通 Go 函数创建 Span。

MonkeyCode 的核心 Span 包括：

- 接收任务创建、启动、停止、重启和模型切换请求；
- 用户、项目、模型与配额校验；
- 创建或更新任务记录；
- 调用 Taskflow；
- 建立 Task Live、Control、Terminal 等长连接；
- 接收 Taskflow 回调；
- 数据库、Redis 和外部服务调用。

健康检查、心跳、轮询和流式数据块默认不产生业务 Span。

### 属性规范

优先采用 OpenTelemetry Semantic Conventions。自定义属性使用以下名称：

| 属性 | 含义 |
| --- | --- |
| `monkeycode.task.id` | MonkeyCode 任务 ID |
| `monkeycode.agent.session.id` | 一次 Agent 执行会话 ID |
| `monkeycode.request.id` | 一次业务命令或交互 ID |
| `monkeycode.project.id` | MonkeyCode 项目 ID |
| `taskflow.vm.id` | Taskflow 虚拟机 ID |
| `taskflow.terminal.session.id` | 终端会话 ID |
| `task.outcome` | `succeeded`、`failed`、`cancelled` 或 `rejected` |

现有业务字段、协议字段和数据库字段保持不变，仅在遥测层统一命名。

### 数据安全

Trace 属性采用严格允许名单。允许采集服务名、版本、环境、路由模板、方法、状态码、规范化业务 ID、操作阶段、重试次数和清洗后的错误分类。

以下内容禁止进入 Trace：

- Prompt、模型回复、代码、文件内容和完整文件路径；
- 请求体、响应体和 URL 查询参数；
- Git 仓库地址；
- Authorization、Cookie、Token 和密钥；
- 用户名、邮箱、手机号和客户端 IP；
- SQL 参数、Redis Key 和 Value；
- 可能包含第三方响应正文的原始错误信息。

数据库 Span 只保留操作类型、表名、耗时和错误分类；Redis Span 只保留命令名。

### 日志关联

服务运行日志继续写入 VictoriaLogs，不引入 Loki 作为运行日志后端。日志处理器从 `context.Context` 提取并补充：

- `trace_id`；
- `span_id`；
- `monkeycode.task.id`；
- `monkeycode.agent.session.id`；
- `monkeycode.request.id`；
- `service.name`。

Grafana 必须支持从 VictoriaLogs 日志按 `trace_id` 打开 Tempo Trace，也支持从 Tempo 按 `trace_id` 和时间范围查询 VictoriaLogs。

Taskflow 中用于任务输出流的 Loki 业务能力不属于本次迁移范围。

### 错误语义

- 系统异常、网络失败、超时、数据库失败和 Taskflow 调度失败标记为 `Error`。
- HTTP 5xx 与 gRPC `Internal`、`Unavailable`、`DeadlineExceeded` 标记为 `Error`。
- 用户主动取消记录 `task.outcome=cancelled`，不标记系统错误。
- 参数校验失败、未授权、配额不足和并发上限记录 `task.outcome=rejected` 及规范化原因，不标记系统错误。
- 原始错误正文不进入 Trace。

### 导出与故障隔离

- 使用异步批量导出器，通过 OTLP 上报 OpenTelemetry Collector。
- Collector Endpoint 未配置或追踪关闭时使用 Noop Provider。
- 队列有界；队列满、网络阻塞或 Collector 不可用时丢弃 Trace，不阻塞业务。
- 应用关闭时限时 Flush，超时后继续退出。
- 导出失败、丢弃 Span 和队列使用率通过 Prometheus 暴露，并对错误日志限频。

优先使用 OpenTelemetry 标准环境变量配置导出地址、协议、服务名、环境和资源属性。应用配置只补充启停开关与无法由标准变量表达的限制。

### 采样与保留

应用将候选 Span 发送给 Collector，由 Collector 执行尾部采样：

- 开发、测试环境保留 100%；
- 生产正常请求保留 10%；
- 错误、超时、关键任务操作和慢请求保留 100%；
- 健康检查、心跳和轮询默认丢弃；
- HTTP 慢请求初始阈值为 2 秒，其他操作使用独立阈值。

生产 Trace 保留 7 天，测试环境保留 3 天，本地开发保留 24 小时。VictoriaLogs 继续使用现有保留策略。

### 性能预算

- HTTP P95 额外延迟不超过 5 ms；
- 应用 CPU 增量不超过 3%；
- 单实例遥测队列内存上限 64 MiB；
- WebSocket 和 gRPC 长连接吞吐下降不超过 2%；
- 不增加请求路径中的同步遥测网络调用；
- Collector 故障时业务接口和长连接不得明显恶化。

### 上线顺序

1. 部署 Collector、Tempo 和 Grafana 数据源，配置 VictoriaLogs 双向跳转。
2. Taskflow 上线接收端埋点和日志关联，默认关闭导出。
3. MonkeyCode 上线服务端埋点与 Taskflow 上下文传播。
4. 测试环境 100% 开启并完成验收。
5. 生产单实例或小流量开启，观察性能和导出健康度。
6. 满足性能预算后全量启用生产采样策略。

### 验收标准

- 正常创建任务可看到 MonkeyCode 接入、数据操作、Taskflow 调用和调度阶段；
- Taskflow 异步结果可通过 Span Link 和 `task_id` 关联到创建阶段；
- Taskflow 不可用、VM 创建失败和 Agent 超时正确保留并标记错误；
- 用户取消和业务拒绝不会误报为系统错误；
- WebSocket 重连形成独立连接 Span，并可通过业务 ID 聚合；
- VictoriaLogs 与 Tempo 可以双向跳转；
- Collector 停止时业务功能、延迟和长连接保持正常；
- Trace 中不存在禁止采集的数据；
- 性能测试满足既定预算。

## 影响

### 正面影响

- 可以从 `trace_id` 还原一次同步调用，也可以从 `task_id` 聚合长生命周期任务的多条 Trace。
- 日志与 Trace 形成统一排障入口。
- Agent 无需改动，降低协议和发布风险。
- 遥测故障与业务故障隔离。

### 代价

- 需要维护 Collector、Tempo、采样规则和 Grafana 配置。
- 异步关联需要 Taskflow 持久化起始 Trace Context。
- 关键异步代码必须正确传递 `context.Context`，日志才能自动关联。
- 尾部采样会增加 Collector 的入口流量与短期内存压力。

## 不在本次范围

- Web、Desktop、Mobile 客户端埋点；
- VM Agent、Coding Agent 内部追踪或协议修改；
- 业务任务日志从 Loki 迁移到 VictoriaLogs；
- 在应用仓库内维护生产级 Tempo 集群。
