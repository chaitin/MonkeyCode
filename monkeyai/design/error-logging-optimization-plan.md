# 后端错误日志优化方案

- 创建日期：2026-10-16；修订日期：2026-10-20
- 代码基线：最初基于 `5b5c3d91` 实施；提交 PR 前同步 `a1cccb86` 主线，保留统计小时汇总和会话分组修复。
- 状态：三个实施阶段的代码已完成；已执行专用数据库、对象存储、真实 Nginx、预览浏览器和竞态回归。性能及验证边界见[实施验收记录](../backend/docs/logging-validation.md)，不代表镜像已发布或部署。
- 范围：MonkeyAI 后端运行日志、可嵌入服务入口、HTTP 网关、远程执行中转与预览、资源包上传/导入、审计、异步任务和部署日志边界。文中路径均相对本项目根目录。
- 核心决策：保留 Go `slog`；服务入口接收调用方提供的 `*slog.Logger` 并统一全局默认 logger，不在入口创建第二个实例。字段规范、错误分类、请求结果、异常恢复、记录边界和去重汇总均基于同一日志链路。

## 一、目标与边界

### 1.1 目标

日志需要回答五个问题：

1. 哪个请求、模型、工具、任务或交易失败了？
2. 在哪个阶段失败，属于什么原因，是否会重试？
3. HTTP 返回状态与业务最终结果是否一致？
4. 是单次失败还是持续故障，实际发生了多少次？
5. 如何关联前后日志、审计记录和持久化业务状态？

同时满足：不泄漏凭据和用户内容，不因正常断连产生大量 ERROR，不因日志改造破坏 SSE、WebSocket、计费、任务恢复、远程授权与预览隔离，或资源包分卷续传和导入幂等。

### 1.2 本轮不做

- 不替换 `slog`，不引入新的日志框架或外部日志平台。
- 不把运行日志写进业务数据库。
- 不重构计费状态机、重试策略、上游响应协议或数据库中已有 ID 字段的业务语义。
- 不默认记录请求体、响应体、提示词、工具参数、认证 Header、Cookie、OAuth 授权码及 Token。
- 不新增公开日志查询接口或管理端日志页面。
- 不引入跨实例 Redis 去重；限频按进程独立执行。

## 二、现状与问题依据

现已实现：

- `logging.New(output, level slog.Leveler)` 创建 JSON logger；根和派生 Handler 实时读取共享级别，并保留调用位置、缩短源码文件路径。
- 属性在 JSON 解析 `LogValuer` 前过滤；基础错误分类不格式化原始错误，不序列化任意对象或配置。`logging.ErrorLog` 将标准库 HTTP 文本替换为固定安全事件。
- `server.Run` 接受确切的调用方根实例，拒绝 nil，在配置/工厂/应用初始化前设为全局默认，不重建、包装、恢复旧值或关闭它。
- 公共启动日志选项解析和静态帮助已抽取；独立命令在业务初始化前装配日志，最终错误走同一安全链路。

已补齐共享请求上下文、完整应用 HTTP 观测、安全异常恢复、审计 ID 复用、显式事件策略、有界去重、定时摘要、进程统计、后台恢复及退出刷新。默认命令通过 `logging.NewRuntime` 创建并持有日志运行时；`logging.New` 仍提供没有后台 worker 的安全 logger。输出目标均由创建方持有。

下表保留最初的问题基线，便于复核改造动机；其中“待改造”描述属于实施前状态，当前实现与验证以第十二节及验收记录为准。

| 现状 | 代码位置 | 问题与改造方向 |
| --- | --- | --- |
| 可嵌入入口已显式接收根 logger 并统一全局默认 | `backend/server/server.go:27`、`backend/server/server.go:31` | 已落实不重建、不包装、不覆盖及创建方生命周期契约 |
| 独立命令已复用公共工厂并在业务初始化前安装根 logger | `backend/cmd/server/main.go:21`、`backend/cmd/server/main.go:31` | 帮助与日志级别解析不依赖数据库配置；失败安全输出后正常返回退出码 |
| `RequestID`、默认 `Recoverer` 在 API 子路由 | `backend/internal/httpapi/router.go:17` | 放到完整应用入口，覆盖网关及 OAuth，移除重复安装 |
| 外层先装 `PreviewGuard`，再注册模型、生图、视频、MCP、relay 和 OAuth | `backend/internal/app/app.go:273`、`backend/internal/app/app.go:286` | 不能仅改 `httpapi.New`；公共观测需在预览守卫之前，保留原隔离规则 |
| 审计中间件单独随机生成请求 ID | `backend/internal/audit/middleware.go:70` | 新审计记录复用本地 HTTP 请求 ID，历史记录不回写 |
| 模型 `Call.RequestID` 实际取自上游 `ResponseID` | `backend/internal/proxy/usage.go:141` | 运行日志区分本地 `request_id` 与 `response_id`，不改变计费字段语义 |
| 上游连接失败仅记录错误的 Go 类型 | `backend/internal/proxy/proxy.go:312` | 通过错误链提取安全分类，保留脱敏保护 |
| 非 2xx 上游响应主要结束计费，缺少统一运行日志 | `backend/internal/proxy/usage.go:94` | 独立观察上游状态，不能让日志依赖是否开启计费或用量记录 |
| 流式用量在影子协程中解析、记录 | `backend/internal/proxy/usage.go:184` | HTTP handler 返回不一定等于业务解析完成，分别定义完成事件 |
| 通用资源响应函数无请求上下文，且内部直接打印错误 | `backend/internal/resource/store.go:77` | 将请求上下文贯穿错误与响应边界 |
| 计费、生图、视频后台任务周期性重试 | `backend/internal/billing/transaction.go:538`、`backend/internal/imagegen/service.go:485`、`backend/internal/videogen/service.go:364` | 中间失败汇总，状态变化与最终失败单独保留 |
| MCP 已有受控错误分类 | `backend/internal/mcp/oauth.go:374` | 提取通用分类，保留 MCP 协议特有的受控原因 |
| 主 HTTP 与 pprof 的 `ErrorLog` 已接入公共安全适配 | `backend/internal/app/app.go:120`、`backend/internal/app/app.go:128` | 固定事件保留故障信号，不转存预格式化文本或另建 logger；代理旁路仍需逐项核对 |
| relay 已注入 logger，代理仅有 DEBUG 响应/流结束记录，`ErrorHandler` 只返回受控 503 | `backend/internal/relay/proxy.go:252`、`backend/internal/relay/proxy.go:320`、`backend/internal/relay/proxy.go:343` | 补原始 cause 的安全分类、传输结果及请求关联；检查未显式设置的 `ReverseProxy.ErrorLog` |
| relay 握手失败记录 `fault.Code/Message`，成功证明不等于通道 ready | `backend/internal/relay/bridge.go:157`、`backend/internal/relay/bridge.go:249` | 显式白名单映射，区分证明、就绪、关闭；普通 `resource.Error.Message` 不能自动视为安全文本 |
| 资源包已有分卷上传、块校验、续传、封存及导入双输入路径 | `backend/internal/resourceimport/upload.go:138`、`backend/internal/resourceimport/upload.go:236`、`backend/internal/resourceimport/load.go:35` | 增加跨请求 `upload_id` 和块阶段关联，不把每块成功当成最终导入成功 |
| 导入补偿和每分钟上传清理直接打印原始 error，补偿还打印存储 key | `backend/internal/resourceimport/service.go:214`、`backend/internal/resourceimport/upload.go:414` | 保留独立副作用诊断；改安全字段，清理故障按批次汇总 |
| readiness 检查端点停止状态、数据库和对象存储，路由却统称数据库失败 | `backend/internal/app/app.go:484`、`backend/internal/httpapi/router.go:31` | 保留检查顺序、超时与状态码，以安全依赖分类准确归因 |
| 应用已包含 relay 排空、HTTP 关闭、异步 Wait 和上传清理 worker 等待 | `backend/internal/app/app.go:402`、`backend/internal/app/app.go:444` | 沿用既有退出顺序；创建方最后刷新日志，不在单个组件关闭时提前关闭 logger |
| Nginx 普通路由仍使用默认 access log，若干敏感路径已关闭 access/error log | `admin/nginx.conf:14`、`admin/nginx/app.conf:4`、`admin/nginx/app.conf:43`、`admin/nginx/preview.conf.template:7` | 普通路由用受控模板，不输出原始 URI；敏感路径保持禁日志，不因统一格式重新开启 |

现有安全测试必须保留并扩展：

- `backend/internal/proxy/proxy_test.go:307`：上游异常不得泄漏凭据或私密响应。
- `backend/internal/imagegen/service_test.go:319`：多层包装 URL 错误不得泄漏 Token 或查询参数。
- `backend/internal/proxy/reconcile_test.go`：上游响应关闭错误的脱敏及正常取消降噪。
- `backend/internal/relay/relay_test.go`、`interop_test.go`、`preview_test.go`、`nginx_test.go`、`previewtls_test.go`：代理、租约、撤销、隔离、预览与 Nginx 边界。
- `backend/internal/resourceimport/upload_test.go:153`：真实数据库中的上传、续传及导入集成路径；保留包解析与导入历史分页测试。

本轮已用独立 PostgreSQL / RustFS 执行后端完整集成回归，并执行公共日志、网关、relay、上传、计费、媒体、认证等包的竞态测试及 `go vet ./...`。真实 Nginx 的普通路由关联、敏感路径、提前拒绝、上游连接失败、Upgrade 和预览 TLS，以及 Chromium 预览存储隔离已单独验证。完整测试数字、跳过项、性能开销和命令见[实施验收记录](../backend/docs/logging-validation.md)。已修改本地 Compose/Nginx 配置，未发布镜像或部署。

## 三、整体架构

### 3.1 日志流水线

已新增轻量、可跨模块导入的公共包 `backend/logging`，继续向业务模块提供 `*slog.Logger`。构造、安全过滤、错误分类、请求关联、策略、去重与摘要均已接入同一流水线。

包路径为 `github.com/chaitin/MonkeyCode/monkeyai/backend/logging`，供独立命令和其他调用方创建统一日志实例。通用日志能力不依赖具体宿主应用；领域特有错误由对应业务模块映射。

服务入口不强制替换、包装或重建调用方已经传入的 logger。需要本方案的自动上下文字段、安全兜底和进程级去重时，调用方应在创建根 logger 时使用公共 logging 工厂或组合其 Handler，然后把最终实例传入入口。

```text
业务模块 / slog.Default / 经适配的标准库日志
                    ↓
        上下文字段补齐、保留原始调用位置
                    ↓
       安全字段规范化、受控错误分类及脱敏
                    ↓
         事件策略：直出 / 去重汇总
                    ↓
       创建方选定的 Handler / 输出目标
        （默认命令为 JSONHandler → stdout）
```

关键约束：

- 全局 `slog.Default()` 与注入各模块的 logger 使用同一底层流水线。
- `logger.With(...)`、`WithGroup(...)` 派生 logger 共用同一个去重状态，不创建独立限频器。
- 指纹必须从规范化后的安全字段生成，不能从未脱敏错误或原始业务对象生成。
- 默认 JSON Handler 启用 `AddSource`，保留原始 `slog.Record.PC`，避免源码位置全部指向包装器；输出不包含非必要的本机工作目录信息。
- `WithAttrs`、`WithGroup` 中的字段同样参与字段规范化和指纹提取；不要只处理单次记录的 Attrs。
- 保留日志级别过滤；ERROR 事件的摘要仍为 ERROR，不把持续严重故障降成 WARN。
- 汇总日志直接进入安全输出层，不再次进入去重层，避免递归。

### 3.2 建议的代码组织

当前公共包已实现以下结构，另有 `worker.go` 提供实际依赖检查的故障/恢复边界及 `Snapshot()` 进程统计：

```text
backend/logging/
  logger.go          初始化、上下文字段补齐、安全输出、派生 Handler
  context.go         请求关联字段、并发安全的请求观测状态
  error.go           通用安全错误分类
  safe.go            序列化前属性过滤
  policy.go          事件名称、严重级别及限频策略
  dedup.go           有界指纹状态、窗口计数、定时摘要及关闭刷新
  http.go            请求 ID、HTTP 完成摘要、JSON 异常恢复
  *_test.go          单元、并发、边界及性能测试
```

按实际代码量可以合并文件，不增加额外日志 DSL、业务事件总线或配置数据库。

### 3.3 入口注入与全局统一契约

`backend/server/server.go` 的导出入口已调整为显式接收 logger：

```go
func Run(
    ctx context.Context,
    args []string,
    logger *slog.Logger,
    factory MemberWriters,
    registrars ...AdminRegistrar,
) error
```

入口必须遵守：

1. `logger == nil` 时返回明确错误，不悄悄创建默认 logger 或退回另一套实例。
2. 在配置解析、成员工厂和应用初始化之前执行 `slog.SetDefault(logger)`，保证后续全局 `slog.*` 与注入 logger 一致。
3. 将传入的同一根实例继续交给 app 和各模块；不在入口调用 `slog.New`、`slog.NewJSONHandler` 或再次创建去重器。
4. 不用 `MONKEYAI_LOG_LEVEL`、启动参数或内部默认值覆盖调用方 logger 的级别、输出位置、Handler 和去重策略。
5. 服务入口返回时不恢复旧默认 logger，也不关闭调用方持有的 Handler、输出目标或去重器。
6. 参数、注释与错误文案仅描述通用服务及扩展契约；成员工厂缺失等错误使用中性的业务描述。

调用方创建 logger 后，应先安装为全局默认，再初始化其他会保存 logger 指针的模块；随后将同一根实例传给服务入口。入口再次确保默认值一致，不代表允许程序启动后随意切换 logger。

```text
调用方创建最终根 logger（含统一 Handler 与去重状态）
  → slog.SetDefault(logger)
    → 其他模块使用 logger / slog.Default()
      → server.Run(ctx, args, logger, factory, registrars...)
        → app 与子模块继续使用该根 logger
```

“全局统一”指根实例及底层日志链路统一，不要求 `logger.With("module", ...)` 返回相同指针。派生 logger 可以不同，但必须共享安全规则、级别控制、输出和同一个去重状态。传给入口的应是根 logger，而不是预先绑定了某个业务模块的派生实例。

### 3.4 初始化、配置与生命周期

- 公共 `logging` 工厂负责构造根 logger 及可关闭的去重运行时；创建方持有其生命周期。
- 独立命令 `backend/cmd/server/main.go` 使用同一工厂，创建后安装全局默认，再初始化应用；不能维持另一套行为不一致的 logger 实现。
- 可嵌入入口先安装传入实例，再解析业务配置和初始化/运行应用，不增加服务自行创建日志运行时的路径。
- 默认命令可以用 `MONKEYAI_LOG_LEVEL` 及日志配置创建 logger；外部注入场景以调用方已经构造的 logger 为准，服务配置不能改变其行为。
- `slog.SetDefault` 不会替换其他模块先前保存的指针，因此所有模块都必须在最终根 logger 安装后再初始化。
- 全局日志实例仅在进程启动阶段确定，不支持同一进程并发运行使用不同 logger 的多个服务，也不支持只切换默认值而保留旧派生 logger 的热替换。
- 关闭顺序由创建方负责：沿用应用现有的 relay/端点排空、HTTP 关闭、异步 Wait、worker 停止等待和数据库关闭流程；服务及其他模块退出、最终退出事件提交后，再关闭/刷新日志运行时及输出目标。不能在收到信号或某个组件 Shutdown 返回时提前刷新并关闭。
- 框架的错误边界直接生成安全诊断属性，不依赖任意外部 Handler 替业务脱敏；任意普通 `*slog.Logger` 可以注入，但自动上下文补齐和进程级去重仅在其 Handler 已组合相应公共能力时生效。
- 测试可以注入内存 logger；涉及全局默认值的测试需在清理阶段恢复，不并行争抢 `slog.SetDefault`。生产入口不自行恢复，以免调用方其他模块在返回后又切回不同日志链路。

## 四、统一字段规范

### 4.1 基础与关联字段

| 字段 | 含义与约束 |
| --- | --- |
| `time`、`level`、`msg`、`source` | 沿用 `slog` JSON 标准字段；`msg` 使用固定中文文案 |
| `event` | 稳定事件名称，例如 `http.request.completed`、`model.call.completed`，不依赖中文文案做聚合 |
| `module` | 模块名，例如 `proxy`、`billing`、`imagegen`、`mcp`、`relay`、`resourceimport` |
| `operation` | 稳定操作名，例如 `proxy_request`、`settle`、`poll_job` |
| `request_id` | 本服务生成的本地 HTTP 请求 ID |
| `response_id` | 模型协议中的上游响应 ID，例如 Responses ID |
| `upstream_request_id` | 约定响应 Header 中的上游请求标识；不是本地请求 ID |
| `session_id`、`user_id` | 已验证的内部业务 ID，按需记录，不记邮箱、姓名等非必要个人信息 |
| `model_id`、`connector_id` | 故障资源关联 ID |
| `job_id`、`transaction_id` | 异步任务与交易关联 ID |
| `machine_id` | 端点连接的内部设备标识，按需记录，不输出认证凭据 |
| `server_id`、`boot_id`、`connection_id` | relay 的服务、设备进程及逻辑访问连接标识；只使用已验证或内部生成值，不是票据或访问断言；设备桥接或文件请求不一定有 connection ID |
| `channel_kind`、`lease_epoch` | 经验证的控制/数据通道枚举及现有租约代次，不记录租约载荷 |
| `upload_id`、`chunk_index` | 资源包上传任务 ID 和已校验块序号，关联多个 HTTP 请求；不等同于 relay 远程文件上传的标识 |
| `import_id` | 导入批次的内部 ID；仅生成后可用，提交前不能标记为已完成导入，不为日志新增数据库字段或改变返回协议 |
| `worker_run_id` | 一次后台扫描或恢复批次的关联 ID，不伪装为 HTTP 请求 ID |

规则：无值的可选字段省略；本地 ID 以 context 中的权威值为准，禁止业务字段覆盖；同一条 JSON 不输出重复键。

### 4.2 请求、结果与错误字段

| 字段 | 含义 |
| --- | --- |
| `method`、`route` | HTTP 方法和路由模板；模板含 `{id}` 等占位符，不记录查询串 |
| `status` | 实际已写出的下游 HTTP 状态；未写出响应时省略，不编造 499 或 500 |
| `upstream_status` | 上游 HTTP 状态，连接失败时省略 |
| `duration_ms` | 单调时间计算的持续时间，HTTP 与业务完成事件分别定义 |
| `stream` | 是否为流式调用 |
| `transport_result` | HTTP 传输结果：`completed`、`aborted`、`canceled` 等 |
| `result` | 业务结果：`succeeded`、`failed`、`canceled`、`unknown` |
| `error_code` | 稳定受控分类，用于检索和聚合 |
| `error_type` | 错误链中提取的相关 Go 类型，不是完整错误文本 |
| `error_message` | 可选；仅允许代码中固定、安全的原因说明 |
| `terminal_event` | 流式协议终止事件 |
| `usage_known`、`usage_error_code` | 用量确定性与采集问题，不能等同于模型调用成功与否 |
| `attempt`、`max_attempts`、`retry_at` | 仅在业务确实有这些信息时记录，不为日志而新增重试行为 |
| `sqlstate`、`timeout`、`errno` | 从已识别类型中提取的安全诊断字段 |
| `dependency`、`phase` | 受控依赖名和操作阶段，例如 `database`、`object_storage`、`endpoint`，以及 `handshake`、`open_stream`、`write_chunk`、`seal`、`apply`、`cleanup` |

补充语义：

- HTTP 200 可以对应 `result=failed`，例如 SSE 收到错误事件。
- `usage_known=true` 不能自动推导 `result=succeeded`；本地估算补齐用量也不能抹掉流式失败事实。
- 正常完成但用量未知可以为 `result=succeeded`、`usage_known=false`，另外记录采集告警。
- 路由不存在或未匹配时使用固定 `route=unmatched`，不记录可能含秘密或任意高基数的原始路径。
- WebSocket 建连与连接结束使用专门事件，不能把升级握手耗时当作整个连接生命周期。

## 五、请求关联与 HTTP 中间件

### 5.1 安装位置与顺序

完整应用只安装一次，顺序为：

```text
本地请求 ID 与观测上下文
  → HTTP 完成统计与摘要
    → JSON 异常恢复
      → PreviewGuard（保留原有访问隔离）
        → 完整应用路由
          → 认证、审计、业务处理
```

覆盖 API、模型、生图、视频、MCP、OAuth、relay 桥接/代理、文件与预览、资源包分卷上传/导入、健康检查、注册的管理扩展路由以及未匹配路径。安装在 `app.go` 外层 `PreviewGuard` 之前，保证预览域名拒绝非预览路径等提前拒绝也有本地请求 ID 与完成统计；不得改变原有访问控制、Host 校验或沙箱响应头。

生产应用保留 `*applicationHandler` 外层类型，将包装后的 router 放入其嵌入的 `http.Handler`。现有 `newApp` 和测试会断言 `handler.(*applicationHandler)`，不能直接返回普通中间件 wrapper 导致运行时 panic。测试用 `newHandler` 也复用相同中间件链。

`httpapi.New` 移除内部重复 `RequestID`、`Recoverer`，其单独使用的测试在测试入口显式安装公共链路。

pprof 是独立监听入口：仅统一安全的服务器日志，不把业务内容或公共排障能力暴露到 pprof；不改变其监听地址与权限边界。

### 5.2 本地请求 ID

- 每个请求生成 128 位随机 ID，编码为固定长度的十六进制字符串。
- 默认不直接信任客户端传入的 `X-Request-ID`，防止伪造关联和高基数字段污染。
- 在写响应之前设置 `X-Request-ID`，包括认证失败、404、预览守卫拒绝和尚未提交响应的异常；模型上游或执行端返回的同名 Header 不能覆盖本地权威值。跨域读取如需暴露此 Header，只在现有 CORS 规则内追加允许头，不扩大 Origin、凭据或预览权限。
- 所有关联查询使用 `logging.RequestID(ctx)`；迁移已有手写 `middleware.GetReqID` 的调用点。
- 如果未来需要接受可信入口传来的 ID，另行明确代理信任边界与格式规则，本轮不启用。
- 不默认向任意上游透传本地请求 ID；上游已有 Header 语义不变。

### 5.3 审计与持久化 ID

- HTTP 审计 `requestState.id` 复用本地 ID，不再另生成一套；测试与独立挂载入口必须提供请求上下文。
- 审计数据库的 `request_id` 是 text，本轮无需修改表结构；保留同一 HTTP 请求下多个审计事件的关联与完成更新行为。
- 审计事件本身不参与运行日志去重；审计写入失败仍需独立保留诊断事件。
- 不把模型 `Call.RequestID`、计费 `RequestID` 改成本地 ID；它们继续用于上游对账。只在运行日志中使用正确名称 `response_id` 或 `upstream_request_id`。
- 异步任务创建时记录一条含 `request_id + job_id + transaction_id` 的关联事件；进程重启后以持久化 `job_id`、`transaction_id` 继续关联，不承诺本轮新增原始 HTTP ID 的持久化。
- 分卷上传每个 HTTP 请求仍有独立 `request_id`，跨块及重启续传使用已有 `upload_id`；导入批次 ID 生成后再建立 `upload_id + import_id` 关联，不能要求旧式 multipart 请求一定有 upload ID。
- relay 的 HTTP 请求、设备桥接和业务流分开关联：仅在标识已验证且确实可用时附加 `server_id + user_id + machine_id`、`boot_id`、`connection_id` 或租约代次，不能用不受控路径、票据或签名载荷补齐。

### 5.4 兼容 SSE、WebSocket 与取消

- 复用或扩展已有 chi 响应包装能力，并验证 `http.Flusher`、`http.Hijacker`、`http.Pusher`、`io.ReaderFrom` 和 `http.ResponseController` 的适用行为。
- 对支持的接口进行等价转发，底层不支持时不能伪装支持；提供正确的解包能力。
- 不缓存完整响应，不读取业务响应体来猜测是否失败，不额外阻塞 flush。
- 普通请求的完成统计在 handler 返回时产生；已升级的 WebSocket 由连接层另外记录生命周期。
- 观测状态使用并发安全的数据结构；后台协程读取的是显式字段或快照，不保留整个 request、body 或 ResponseWriter。
- `context.WithoutCancel(ctx)` 保留关联字段，但后台工作继续使用原有的独立超时与退出控制；不因保留日志上下文改变业务取消语义。

## 六、安全错误分类与脱敏

### 6.1 分类方式

使用 `errors.Is`、`errors.As` 遍历包装链，不按 `err.Error()` 的文案匹配，也不输出整条包装链。

| 场景 | 建议 `error_code` | 安全附加字段 |
| --- | --- | --- |
| 客户端主动取消 | `client_canceled` | 取消阶段 |
| 上游请求超时 | `upstream_timeout` | `timeout=true`、相关类型 |
| DNS 解析失败 | `dns_failed` | 受控 DNS 原因，不输出带凭据的地址 |
| 连接被拒绝或重置 | `connection_refused`、`connection_reset` | `errno` |
| TLS 证书验证失败 | `tls_verification_failed` | 相关错误类型，不输出完整证书或 URL |
| 上游返回非成功 HTTP 状态 | `upstream_http_error` | `upstream_status` |
| 数据库故障 | `database_error` | `sqlstate`，不输出 SQL、参数、Detail 或连接串 |
| 流式协议错误或传输中断 | 复用已存在的稳定代码 | `terminal_event`、传输阶段 |
| 无法安全识别 | `internal_error` 或模块受控错误码 | `error_type` |

分类优先级先处理明确业务及网络细分类，再用通用 `net.Error` 兜底，避免所有错误都变成 `network_error`。错误来源由操作边界提供，不能把任何 `DeadlineExceeded` 都自动归因给上游。

同理，不能仅因 `ctx.Err()!=nil` 就吞掉独立的数据库、清理或结算错误；正常取消降噪需要错误链及操作来源同时匹配。

### 6.2 对外部输入采用白名单

禁止记录：

- Authorization、X-Api-Key、Cookie、Set-Cookie、OAuth code、access/refresh Token、client secret。
- 完整 URL、URL userinfo、查询参数、数据库 DSN、预签名存储地址。
- 用户请求体、模型输出、工具参数、配置与凭据对象。
- relay 票据、访问断言、租约签名、挑战 nonce、设备证明、文件 grant、能力路径中的令牌及 WebSocket 认证子协议；不能因其位于路径而认为已脱敏。
- 上传包/块内容、用户文件名、归档内部路径、任意对象存储 key、导入清单正文和历史分页游标。
- 不受控 panic 值、第三方错误全文、自定义 `Stringer` 或 `LogValuer` 的任意输出。

允许记录：

- 内部 ID、稳定事件名、代码生成的分类、状态码、耗时、次数。
- 约定用于标识响应的少数上游 Header；限制长度和字符范围，不遍历输出所有 Header。
- 适配器明确映射为受控枚举的上游错误码，不直接把任意响应 JSON 字段打印出来。

第一阶段不额外读取上游错误 body。诊断先依赖状态码、安全错误类型、内部资源 ID 和响应标识，避免读取影响转发。

公共 Handler 对历史 `error` 属性做安全转换兜底，不能先调用其 `Error()` 再脱敏；对敏感键屏蔽，对不受控对象不做通用序列化。逐步迁移已存在的 `failure`、`reason`、字符串化错误和动态文案；Handler 不能保证清除已经拼进任意字符串的秘密，必须配合调用点清理和测试。

### 6.3 标准库与部署层

- 主 HTTP、pprof、relay 控制 HTTP 以及模型/relay 的 `ReverseProxy.ErrorLog` 均显式接入 `logging.ErrorLog(logger)`。适配器只输出固定安全事件；原始原因由代理错误边界分类，不依赖标准库全局重定向。
- 标准库格式化字符串通常已丢失原始错误类型：使用专用适配器输出受控事件，不能把未知整行文本视为安全内容；详细原因仍由代理边界中的原始错误分类提供。适配器不得另建根 logger 或形成标准库日志回流递归。
- 普通路由的 Nginx access log 使用 `escape=json` 的安全 JSON 格式，仅包含方法、受控路由标签、状态、耗时及后端返回的 `$upstream_http_x_request_id`。标签通过受控 map/location 生成，默认 `unmatched`；不用 `$request`、`$request_uri`、原始 `$uri`、Referer 或认证字段。**去掉查询串仍不足以保护路径中的 grant、能力令牌或文件名。**
- 保持 `app.conf` 中 `/preview/`、`/device`、设备授权请求、远程端点代理/文件路径，以及 `preview.conf.template` 整个预览站点现有的 `access_log off` / `error_log /dev/null` 策略；不因新增全局格式而在这些路径重新开启日志。必要诊断由后端以受控事件提供，不能在两层都默认记录全量访问。
- 本地请求 ID 默认由后端生成，Nginx 自身拒绝且未到达后端的请求可以没有该 ID，不能伪造后端 ID；敏感路径不为记录该 ID 而恢复访问日志。
- 单独审计仍启用日志的 OAuth 回调及其他敏感入口的 Nginx error log；access log 改格式不代表 error log 已安全。检查 location 选择前的拒绝、连接错误与上层继承日志，不能只验证应用已收到的请求，也不能依赖应用 Handler 为 Nginx 输出脱敏。
- 配置由 `admin/entrypoint.sh` 生成并包含主站点/预览站点，验收最终展开的配置而不是只看模板。保留现有分卷上传的 64 MiB、传统导入的 2064 MiB 请求体上限、关闭请求缓冲、长超时、SSE 和 Upgrade 设置。
- Nginx 配置属于部署变更，在单独实施步骤验证，不随设计文档直接修改线上配置。

## 七、HTTP、模型调用与任务完成日志

### 7.1 两种完成时间不能混淆

1. `http.request.completed`：handler 结束时生成，记录实际 HTTP 状态、传输结果、请求耗时，不臆测尚未结束的异步业务结果。
2. `model.call.completed`：上游结果与流式解析结束时生成，记录 `result`、`terminal_event`、`response_id`、用量确定性及调用耗时。

模型结果可在 HTTP handler 返回之后由影子协程产生。不能为等待日志而无限阻塞 handler，也不能让一个协程提前清空另一个协程要写的观测状态。

### 7.2 请求摘要策略

| 类型 | 默认策略 |
| --- | --- |
| 普通成功请求、预期参数或权限错误 | 完成统计始终保留；运行日志默认 DEBUG，避免默认 INFO 被逐请求访问日志占满 |
| 健康检查成功 | 默认不输出逐请求运行日志 |
| 就绪检查依赖故障 | 首次输出，后续按实际依赖及错误分类汇总；端点正常停止不当作数据库 ERROR |
| API 未处理系统故障 | 业务边界记录一次主诊断；完成层不再额外输出相同原因的 WARN/ERROR |
| 没有主诊断且未被明确分类为预期结果的 HTTP 5xx 或中断 | 完成层记录兜底诊断，并按允许策略汇总 |
| 模型等网关失败 | 网关记录主诊断；HTTP 完成只保留统计与可选 DEBUG 摘要 |
| SSE HTTP 200 后发生错误 | `model.call.completed` 记录业务失败，不能由 HTTP 200 抹掉 |
| WebSocket 正常断连 | 连接层 DEBUG 或不记录；异常断连按连接阶段分类 |
| relay 设备离线、授权失效、限流或服务排空 | 受控预期结果默认 DEBUG；授权存储、隧道系统故障按实际原因和影响分级，不仅依据 503 |
| 分卷块成功、同内容重传、用户输入/封存冲突 | 默认 DEBUG；不逐块输出 INFO，不将校验失败、缺块或过期任务视为系统 ERROR |

普通非敏感路由的成功访问日志可由部署层承担；敏感路径继续禁日志，后端 DEBUG 摘要也必须遵守字段白名单。开启 DEBUG 或单独全量访问日志后，输出量会增加，不属于错误去重失效；不应为排障恢复敏感路径原始访问日志。

预期结果与主诊断归属都在观测状态中显式标记，不依赖某条日志是否通过级别过滤。已知设备离线、排空等结果即使 DEBUG 不输出，完成层也不能仅因状态是 503 而补打一条系统 ERROR。

主诊断的归属标记在事件提交时设置，而不是在实际输出时设置。即使该诊断被去重压制，完成层也不能另打一条 ERROR 绕过限频。

### 7.3 流式与用量特殊处理

- 非 2xx 上游观察逻辑放在计费/recorder 开关之前，即使没有开启用量采集也能记录上游 HTTP 失败。
- 运行日志中的调用失败分类与用量采集分类分开存储，不直接依赖可能被估算逻辑清空的 `Call.ErrorCode`。
- 一次流式调用内重复出现相同解析问题，累计次数，只在调用完成时输出有限诊断；DEBUG 才保留必要的受控阶段信息。
- `model.call.completed` 在已有解析/转发流程结束点产生一次；连接失败、非 2xx、成功解析等互斥路径不能重复完成。
- 对没有用量采集的网关路径，也要在现有响应读取/关闭边界补齐必要结果观察，保持不缓存、不新增第二次读取、不改变下游内容。
- 计费结算、审计写入、存储清理失败属于不同副作用，允许独立事件，不被“一个请求只打一条错误”的全局标记吞掉。

## 八、日志级别、异常恢复与记录归属

### 8.1 级别规则

| 级别 | 适用范围 |
| --- | --- |
| DEBUG | 成功请求摘要、正常取消/断连、受控阶段信息 |
| INFO | 服务启停、任务受理、关键状态变化、明确检测到的故障恢复 |
| WARN | 可恢复或会重试的故障、上游限流/可预期拒绝、用量未知等需关注状态 |
| ERROR | 请求不可恢复的系统故障、状态持久化失败、重试耗尽、结算最终失败、程序异常 |

不能仅按 HTTP 状态机械分级。例如无效用户密钥不是系统 ERROR；上游 401 可能意味着模型配置错误，需要结合所有权和调用阶段判断。

“等待恢复”的中间故障可以 WARN，但“首次进入未知/待核查状态”仍是独立状态事件；严重等级由业务影响确定，而不是为了降噪一律降级。

### 8.2 异常恢复

- 使用统一 JSON 恢复中间件，输出 `event=http.request.panicked`、本地请求 ID、已提交状态、panic 类型、受控调用栈。
- 调用栈使用 `runtime.CallersFrames` 等提取函数、文件、行号，不输出可能含参数值的任意堆栈文本；限制帧数与最大长度。
- 响应未提交时返回通用 500，不将 panic 值回显给客户端。
- 响应已提交时不尝试再写 500，记录真实状态并中止传输，避免把截断响应伪装为正常成功。
- `http.ErrAbortHandler` 是标准库控制流，不当作程序 panic；保留其终止语义，结合代理已记录的原因生成或关联传输结果。
- 审计中间件继续完成审计并向外传播真实 panic，由外层统一恢复；不能因迁移恢复中间件改变审计结果。

### 8.3 一次失败的记录边界

- repository 返回错误；service 补充安全业务上下文；最终能决定响应或任务状态的边界记录主诊断。
- 移除“记录后原样返回、上层再记录”的重复模式。
- HTTP 错误响应统一携带 context；建议直接迁移 `resource.Fail`、`resource.JSON` 及其调用点，而不是长期保留两套有/无 context 的 API。
- 不能把“已记录”的标记挂在错误对象全局复用；记录归属在当前请求或任务的明确事件范围内管理。
- 回滚、补偿、审计、结算是独立操作；它们失败时单独输出，并关联主请求/交易 ID。

### 8.4 批次与后台重试边界

- 批次错误不能直接输出 `errors.Join` 全文作为指纹，也不能将一次批次失败的计数误称为多个任务失败次数。
- 共享依赖故障按每批次记录一次；独立任务重试则按任务及尝试边界记录，上层不重复同一原因。
- 需要分类的错误在日志边界之前保留内部 cause 或受控分类；错误链一旦丢失，公共 Handler 无法重新推断超时、DNS 等原因。
- 日志改造不得改变任务锁、幂等、状态转换、退避、重试间隔或禁用开关。

### 8.5 远程执行中转、文件与预览

- 沿用现有 `relay.Service` 注入的同一 logger，将缺少 context 的握手、响应和结束日志迁移到请求/连接上下文；后台清理使用 worker 上下文，不保留整个 HTTP request。
- 代理在 `ErrorHandler` 可获得原始错误的位置做安全分类，并在 `ModifyResponse` 观察状态；保留现有对外错误码/状态码。`device_offline` 503 不能代替内部区分开流、响应头超时、重定向被拒绝和写回中断，也不能把授权数据库故障归为普通离线。
- `route` 仍为外层模板；必要时使用受控 `operation` 区分 ACP、读取会话/配置/交互、资源写入、MCP 能力、上传、文件和预览。当前 DEBUG 标签对多种路径笼统落入 `/acp`，不能据此做准确聚合；不得补记原始 `p`、通配路径或执行端地址。
- 建议分别定义 `relay.bridge.ready`、`relay.bridge.closed`、`relay.stream.completed`。证明提交、`ready_ack`、通道发布/附着和连接结束是不同阶段；现有“设备证明已提交”不能直接改名为 ready。控制通道和数据通道分开记录，标识、关闭原因和级别均经过白名单。
- HTTP 101 仅表示升级，不代表长连接业务成功。复用既有连接与传输结束边界，不额外读取帧或缓存数据；确实无法识别的业务结果用 `unknown`，不借用模型用量解析逻辑。正常撤销、到期、替换旧代次、设备排空及客户端取消不产生重复 ERROR。
- `wsError` 的 `resource.Error.Code/Message` 经显式映射后才能进入运行日志，不因类型是 `resource.Error` 就直接输出 Message；保留对外协议错误行为。
- 保留预览 Host/Origin 绑定、文件授权、Cookie/Authorization 剥离、禁止重定向和沙箱响应头；日志中间件、Header 关联与标准库适配不能弱化这些限制。

### 8.6 资源包上传、导入与补偿

- 保留 `/resource-import-uploads` 创建、列表、续传、块写入、complete 和取消流程，以及 JSON upload ID / 旧式 multipart 两种导入输入；运行日志以 `upload_id`、已验证 `chunk_index`、受控阶段和内部资源 ID 关联，不序列化 `Upload.Files`、包清单或错误全文。
- 缺块、块大小/哈希不符、同块不同内容、上传封存、过期及预览确认冲突是现有输入或状态结果；不按系统 ERROR 处理，不为日志增加 attempt 计数、重试或修改 SHA-256 校验与幂等响应。
- 块写入失败由最终 HTTP 边界记录主诊断；对象写入、数据库块记录/提交失败按阶段区分。同上传同块的重复系统故障才允许合并，不能将其他上传或其他块失败一起吞掉。
- `complete` 只表示上传包已校验且 ready，不表示已导入。导入预览、资源事务提交、上传 imported 状态更新分别观察；当前 `Apply` 提交后才调用 `loaded.finish`，后者失败不能被写成“资源事务已回滚”。必要时分别记录资源应用结果及上传收尾失败，不改变现有事务/返回协议。
- 导入批次 ID 目前在 `Apply` 内生成；通过内部观测状态传递可用 ID，业务提交和必要收尾完成后才记录相应成功事件。已导入的幂等返回不伪造新的批次完成事件；审计与导入历史按原有机制保留，不参与去重。
- 对象存储补偿失败是独立副作用，不被主失败已记录标记压掉；省略原始 key，以受控资源类型、已有内部 ID 和操作阶段定位，不额外建立业务索引或改变补偿范围。
- `CleanupUploads` 每批次失败记录一次安全诊断，`Run` 的每分钟检查采用至少 5 分钟汇总窗口；保留取消后的清理抑制、现有锁、过期规则及删除/提交顺序。relay 每小时清理及运行密钥每分钟清理各按实际周期处理，不为日志更改调度。

### 8.7 就绪检查的依赖归因

- `readiness.Ping` 当前先检查端点 Ready，再在现有 5 秒超时内检查数据库和对象存储；保持顺序和 503 响应，用受控依赖标记包装内部 cause，交给路由边界分类，不再把所有失败都记为“数据库就绪检查失败”。
- 正常端点停止标记为生命周期结果，避免故意排空时刷 ERROR；数据库或对象存储故障按 `dependency + error_code` 记录及汇总，不附连接串、bucket/key 或原始错误消息。健康响应写入失败另按传输/取消分类，不重复记录依赖故障。
- 多个 readiness 请求不共享请求级的已记录标记；共享的是进程级去重状态。只有确实维护了依赖状态的边界才能输出恢复事件，不能因后续未检查该依赖就推断恢复。

## 九、重复错误去重、限频与汇总

### 9.1 策略选择：显式允许，不无差别压制

在代码中定义事件策略注册表。默认直出，只有明确允许的高频运行事件进入去重器。

| 事件类型 | 策略 |
| --- | --- |
| 上游连接、DNS、超时、非 2xx、流式同类失败 | 按故障指纹汇总 |
| 健康检查、后台依赖扫描持续失败 | 按故障指纹汇总 |
| 某任务或交易的中间重试失败 | 指纹包含 `job_id` 或 `transaction_id`，只合并同一对象的重复尝试 |
| relay 同设备同操作的重复隧道系统故障 | 按已验证服务/用户/设备范围及操作、阶段、错误分类汇总；正常离线等预期结果不升级成错误 |
| 同资源包上传同块的重复系统故障 | 指纹包含 `upload_id + chunk_index + phase`；未到块阶段则仅按有效上传及操作范围，不能跨上传/块合并 |
| 上传清理、运行密钥清理等共享依赖故障 | 按批次、受控依赖及操作汇总，分钟级周期使用至少 5 分钟窗口 |
| 设备就绪/撤销/代次切换、上传封存/导入完成等状态事件 | 在真实状态边界输出，不跨业务对象合并；普通块成功及幂等返回不重复产生状态事件 |
| 首次进入待核查、重试停止、最终失败 | 保留每个业务对象的状态事件，不跨对象合并 |
| panic、数据一致性异常、审计落库失败、最终结算失败 | 默认直出，不静默压制 |
| 审计记录、业务落库与错误计数 | 不经过运行日志去重 |

关键事件应在状态转换边界记录，防止“每次扫描重复报告同一个最终状态”；这属于修正记录时机，不是跨业务事件丢弃日志。

### 9.2 指纹规则

基础指纹：

```text
level + event + module + operation + error_code + error_type
  + 可选 upstream_status / sqlstate
  + 策略指定的资源范围
```

资源范围由事件策略决定：

- 模型上游故障加 `model_id`；MCP 故障加 `connector_id`。
- 后台共享依赖故障用固定依赖名，不按每个用户细分。
- 中间结算重试加 `transaction_id`；媒体任务重试加 `job_id`。
- relay 设备故障加已验证的 `server_id + user_id + machine_id` 及受控操作/阶段；不使用原始票据、文件路径或每次重连变化的 ID。设备生命周期变化另保留独立状态事件。
- 资源包块故障加 `upload_id + chunk_index + phase`，上传其他阶段按对应策略使用可用的 `upload_id`；缺少必须范围时直出。上传清理的共享依赖故障不按每个块拆指纹。

不得加入：本地请求 ID、时间戳、耗时、attempt、响应 ID、完整 URL、完整错误字符串或用户输入。

不同模型、操作、HTTP 状态或严重等级不能被错误合并。指纹字段缺失、事件未登记时保守直出，不能只凭相同 `msg` 合并。

指纹哈希只用于索引；内部仍保留规范化元组用于核对，避免哈希碰撞误压制。

### 9.3 窗口与计数语义

推荐初始值：默认窗口 60 秒，单进程最多 4096 个活跃指纹，空闲淘汰至少 10 分钟，最多 3 个关联 ID 样本（按事件选取类型，不按字段分别扩容）。

分钟级后台扫描故障使用代码策略指定的 `max(5分钟, 全局窗口)` 汇总周期。否则“一分钟重试一次 + 60 秒窗口”基本不会降低输出量。最终状态事件仍立即保留；这只调整日志汇总周期，不调整实际重试间隔。

使用从该指纹首次出现开始的固定窗口，而不是“每次重复都延长静默期”的滑动消音：

1. 第一条立即输出，建立窗口。
2. 窗口内后续同类事件不逐条输出，只更新累计、最近时间和有限样本。
3. 到期且存在被压制事件时，由公共定时器输出摘要，即使没有新请求也输出；只有一条已直出的事件不再输出冗余摘要。
4. 持续活跃的后续窗口每窗口输出一条摘要，不重复打印首条详情。
5. 一个窗口内没有事件则不输出摘要；下次再次发生时按新一轮首次事件立即输出。没有事件不代表故障已恢复。
6. 错误分类、资源、操作或级别变化产生新指纹，立即输出。

每份摘要字段：

```text
fingerprint、original_event、original_level
window_started_at、window_ended_at、window_seconds、flush_reason
first_seen_at、last_seen_at
occurrence_count、detail_count、suppressed_count
sample_request_ids / sample_job_ids / sample_transaction_ids
  / sample_upload_ids / sample_connection_ids（按事件选择，总样本数有界）
以及原事件的安全指纹字段
```

计数恒等式：`occurrence_count = detail_count + suppressed_count`，仅统计当前窗口，不滚动累加进多个摘要。

例如首窗口发生 1000 次：输出 1 条详情、1 条摘要，摘要计数为 1000 / 1 / 999；第二窗口继续发生 600 次：输出 1 条摘要，计数为 600 / 0 / 600。

摘要不能带一个看似代表全部事件的顶层 `request_id`，改用明确的有限样本列表。摘要保留原事件级别；ERROR 洪峰的汇总不会变成 WARN。

### 9.4 恢复事件

恢复由确实执行检查的 worker 或连接状态机报告，不由去重器根据“最近没日志”推断。

- 失败状态到成功状态只输出一次 `dependency.recovered`，记录持续时长及可确定的失败次数。
- 恢复事件走同一状态锁/序列边界，先刷新该故障未输出摘要，再结束该轮去重状态；后续再次失败能够立即输出。
- 普通请求无全局健康状态时，不额外建立推测性的“上游已恢复”状态机。

### 9.5 内存、并发与容量保护

- 全进程共用一个状态容器和一个清理/汇总调度器，不为每个指纹创建 goroutine 或 ticker。
- 使用可注入时钟，窗口计算依赖单调时间；测试不靠真实等待一分钟。
- 锁内只更新状态或提取待输出快照，不执行 JSON 序列化和 I/O；同指纹详情与摘要需保持可解释的窗口标识，不要求跨协程所有日志严格全局排序。
- 状态只保存安全标量、计数和有限样本，不保留原始 error、context、request 或完整 `slog.Record`。
- 活跃容量达到上限时，优先清理空闲且无待输出计数的条目；不反复驱逐热点指纹造成持续首条输出。
- 仍无容量时，新指纹保守直出，并输出限频的容量告警及累计溢出次数。明确边界：这防止内存失控，但不能阻止大量不同错误刷屏，不能为降量而吞掉未知故障。
- 进程内去重不是跨实例保证；多个副本分别输出首条与摘要，通过部署平台实例标签区分。

### 9.6 关闭与输出可靠性

- 正常关闭沿用 `App.Run` 现有顺序：先调用 relay 和端点 Shutdown 进入排空并关闭桥接，再关闭 HTTP server，等待模型/媒体异步处理与监听退出；返回过程取消并等待计费、relay、运行密钥、MCP、端点观察、媒体及上传等清理 worker，最后关闭数据库。日志不得在任一中间阶段提前关闭；logger 创建方在服务和其他模块退出、最终事件提交后，停止汇总器并刷新未输出计数。
- `server.Run` 返回时不能关闭调用方持有的日志运行时；应用以外的模块可能仍在清理。Shutdown/Wait 超时也不等于全部 goroutine 已排空，保留超时诊断和关闭后迟到事件的安全直出，不宣称强制退出可完整刷新。
- `Close/Flush` 幂等；关闭后的迟到事件直接输出，不继续进入无人刷新的聚合状态。
- 新增 logger 生命周期管理时检查所有 `os.Exit` 路径；不能依赖 `os.Exit` 后执行 defer。主入口应在退出进程前完成可执行的刷新。
- 记录输出错误计数；必要的降级告警只使用固定安全文案，并独立限频，不能递归调用同一失败 Handler。
- 日志仍是 best effort：强杀、进程崩溃、stdout 写失败可能丢失未刷新摘要；不能宣称 exactly-once 或崩溃不丢。
- 审计、交易状态和任务状态仍以原持久化机制为准，不能依赖汇总器保存业务证据。

## 十、计数与可观测性

日志行数不等于错误发生次数，不能据此计算错误率。

本轮至少提供进程内可读取的统计快照：

- 候选事件数、直出详情数、压制数、摘要数。
- 活跃指纹数、容量溢出数、输出错误数。
- HTTP 请求完成/失败统计在去重之前计算，且每请求一次；业务调用最终结果另行统计，不能把两个口径相加。

统计使用有界标签，仅按已登记事件、模块、错误分类等分组；不把 `request_id`、`user_id`、`job_id`、`upload_id`、`machine_id`、`connection_id` 等业务关联 ID、URL 或任意错误文本作为指标标签。

不为本次日志改造新增公共 `/metrics` 或监控依赖。若后续接入现有监控系统，则导出上述计数；没有监控系统时，使用独立低频统计摘要辅助观察，并明确进程重启后累计值重置。

## 十一、配置与默认行为

默认命令沿用 `MONKEYAI_LOG_LEVEL`，建议只增加三项日志构造配置；可嵌入入口不读取这些值来覆盖已经传入的 logger：

| 配置 | 默认值 | 作用 |
| --- | --- | --- |
| `MONKEYAI_LOG_DEDUP_ENABLED` | `true` | 是否启用已登记事件的去重 |
| `MONKEYAI_LOG_DEDUP_WINDOW` | `60s` | 汇总窗口 |
| `MONKEYAI_LOG_DEDUP_MAX_KEYS` | `4096` | 活跃指纹容量上限 |

建议配置边界：窗口 1 秒至 10 分钟，容量 128 至 65536；格式与范围错误直接启动失败，错误日志不回显敏感配置值。

空闲 TTL 为 `max(10分钟, 2×该事件有效窗口)`，清理/到期调度间隔不超过 `min(1秒, 全局窗口)`，样本上限 3，调用栈长度使用代码内安全上限，不把全部参数都做成环境变量。分钟级 worker 的有效窗口遵循第九节策略。

默认命令的配置必须贯穿 config、logger 工厂、`docker-compose.yml` 和部署说明；仅新增环境变量解析、但未在创建根 logger 时使用，不能视为完成。可嵌入调用方通过公共 logging 构造选项自行指定日志策略，服务入口不得重新包装 logger 以强制覆盖。

去重开关关闭后恢复逐事件输出，但不关闭脱敏、字段规范、ID 关联或错误分类。严重事件绕过去重是代码策略，不接受客户端 Header 或业务输入控制。

默认命令在配置读取之前可使用安全的引导期 JSON logger，并在所有业务模块初始化之前安装最终根实例；可嵌入入口使用传入实例覆盖初始化阶段，不另建引导 logger。引导期只输出受控错误码与必要配置键名，不打印完整命令行、连接串或任意配置错误原文；帮助请求按 CLI 契约正常返回，不进入业务初始化。

## 十二、实施顺序与改造清单

所有六项均在本轮方案内，按依赖分步提交，每步附测试，不使用一次性全仓库替换。

### 阶段一：公共基础、安全字段与关联 ID

- [x] 新增公共 `logging` 工厂、基础安全分类、序列化前过滤与动态 Leveler Handler。
- [x] 补齐请求上下文字段、完整错误分类与各领域映射。
- [x] `server.Run` 增加显式 logger 参数，校验非空，在初始化前设为全局默认，不再自行创建 logger。
- [x] 同步入口签名及示例，编译检查调用约定；不新增第二套启动/日志运行时 API。
- [x] 默认 `cmd/server` 使用 `NewRuntime` 创建根实例，在业务及最终事件结束后 Close；输出目标仍由创建方持有，`server.Run` 不关闭调用方运行时。
- [x] 在 `PreviewGuard` 之前统一安装请求 ID、完成统计和恢复中间件，覆盖 relay/预览和上传入口，保留 `applicationHandler` 类型及访问隔离。
- [x] 审计复用本地请求 ID；明确模型及计费的上游 ID 命名。
- [x] 增加与执行基本链路、脱敏、源码位置、panic 和流式兼容测试。

### 阶段二：记录边界、结果补齐与限频闭环

- [x] 实现有界去重器、策略注册表、定时摘要、统计、关闭刷新及配置开关。
- [x] 迁移 `resource`、apikey、认证等 HTTP 错误与响应边界，消除上下层重复打印。
- [x] 网关补齐上游连接、非 2xx、SSE 终止/中断等结果日志，统一安全分类。
- [x] relay 补齐代理原始错误分类、标准库 ErrorLog、握手/通道及流结束边界，不泄漏 grant、能力路径或签名载荷。
- [x] 资源包上传/导入补齐 `upload_id`、块/阶段关联与独立补偿事件，区分封存、资源提交和上传状态收尾。
- [x] 就绪检查按端点、数据库、对象存储准确归因，保留既有检查与响应语义。
- [x] 分离业务结果与用量采集结果，不改计费业务结果存储协议。
- [x] 请求摘要遵循主诊断归属与去重策略，避免换个事件名继续刷屏。
- [x] 将现有代理、安全错误与用量测试适配到新字段，不削弱原断言。

### 阶段三：后台任务、部署边界与全面验证

- [x] 计费、媒体任务、MCP 后台扫描、端点与 relay 生命周期、资源包/运行密钥清理接入同一日志链路和事件策略。
- [x] 中间重试按对象汇总，最终状态、审计、结算等关键事件保留。
- [x] 有明确健康状态的 worker 增加一次性恢复事件，不改重试节奏。
- [x] 检查标准库日志旁路、Nginx 查询串/敏感路径泄漏及安全请求关联，保留现有敏感 location 和预览站点的禁日志策略。
- [x] 配置现有容器日志驱动的轮转/保留上限；去重不能替代磁盘容量管理，具体值依部署容量确定。
- [x] 完成并发、性能、故障注入与退出验证。

重点修改区域：

| 区域 | 预期变更 |
| --- | --- |
| `backend/server/server.go` | 接收根 logger、统一全局默认，不重新创建、包装或关闭调用方 logger |
| `backend/cmd/server/main.go` | 默认命令创建根实例、统一安装、最终错误输出与关闭刷新 |
| `backend/internal/config/config.go` 及测试 | 去重配置和边界验证 |
| `backend/logging/` | 新增跨模块可导入的共享实现与测试 |
| `backend/internal/app/app.go` | 在 `PreviewGuard` 前安装公共链路，同一根 logger 传递；就绪依赖归因，沿用 relay/端点排空与 worker 等待 |
| `backend/internal/httpapi/router.go` 及测试 | 移除重复链路、健康检查策略 |
| `backend/internal/audit/` | HTTP ID 复用、独立写入失败事件 |
| `backend/internal/resource/` 与 HTTP 调用点 | 贯穿 context、统一响应错误边界 |
| `backend/internal/proxy/` | 上游分类、最终结果、异步关联及限频 |
| `backend/internal/apikey/`、`identity/`、`endpoint/` | 错误归属、运行密钥清理、级别及正常断连降噪 |
| `backend/internal/relay/` | 代理 cause 安全分类、请求/设备/通道关联、生命周期与传输结果，保留授权和预览安全边界 |
| `backend/internal/resourceimport/` | 分卷续传/块关联、封存与导入结果、独立补偿及清理聚合，不改事务与幂等 |
| `backend/internal/billing/`、`imagegen/`、`videogen/`、`mcp/` | 重试、状态事件、恢复及关键业务保护 |
| `admin/nginx.conf`、`admin/nginx/` 与 `admin/entrypoint.sh` | 普通路由的安全日志标签及关联 ID，保留敏感路径禁日志，验证最终生成配置与日志旁路 |
| `docker-compose.yml` 与部署说明 | 默认容器日志构造选项、轮转与部署检查；不修改数据库 |

## 十三、测试与验收标准

本节是持续复核的验收条件，不作为实施任务状态。实施进度见第十二节；各轮实际执行结果、专项补验、跳过项和性能限制以验收记录为准，不按代码完成度推定未执行场景通过。

### 13.1 入口注入、全局统一与公共 Handler

- 注入 logger 后，`slog.Default()` 与传入根实例一致；配置解析和成员工厂初始化前已经安装。
- nil logger 返回明确错误，不回退、不创建第二个 logger。
- 配置、环境变量和入口内部实现不覆盖调用方的级别、输出目标或 Handler。
- 注入的自定义 Handler 无重复包装，调用计数符合预期；模块派生 logger 共用同一去重状态。
- 入口返回后全局默认不切回旧值，调用方 logger 未被关闭，其他模块仍能输出。
- 默认命令创建并管理根实例；help 正常返回，不启动数据库或任务；最终错误安全输出后刷新。
- 注入 logger、全局 `slog`、`With`、`WithGroup` 均有正确字段且共享去重状态。
- context 本地请求 ID 不被业务属性覆盖，JSON 没有重复键。
- 源码位置指向业务调用点，不全部指向包装层。
- 外层/内层 URL 错误、数据库 Detail、Token、Cookie、OAuth code 和恶意自定义错误均不泄漏。
- 未识别对象不调用可能泄密的 String/LogValue，也不序列化完整配置。
- ERROR 摘要在 `MONKEYAI_LOG_LEVEL=error` 时仍可见。

### 13.2 去重与计数

- 1000 次相同错误，首窗口仅 1 条详情和 1 条摘要，计数 1000 / 1 / 999。
- 无后续请求时，到期仍输出摘要；单次事件不产生多余重复摘要。
- 持续第二窗口 600 次只输出一条摘要，计数 600 / 0 / 600，不重复累计首窗口。
- 改变 request ID 不影响去重；改变资源、操作、状态码或级别会立即输出新详情。
- 未登记事件、最终交易失败、审计失败等不会被跨事件合并。
- relay 不同设备/操作/阶段、不同 upload ID 或块的故障不误合并；设备状态变化及独立补偿不会被请求主诊断标记吞掉。
- 热点指纹稳定，达到容量上限后内存有界，新指纹保守直出且有溢出统计。
- 并发提交、到期、恢复和关闭无数据竞争、漏计或同窗口重复刷新。
- 恢复后再次失败立即输出，未观察到新事件不能自动输出“恢复”。
- 关闭刷新、重复 Close、迟到事件、输出错误与 `os.Exit` 正常可控路径均有覆盖。

### 13.3 HTTP、协议与任务回归

- API、各网关、OAuth、relay/文件/预览、分卷上传/导入、注册的管理扩展、404、认证失败和预览守卫拒绝均返回本地请求 ID；恶意外部请求 ID 不被直接采纳，执行端同名响应头不能覆盖它。
- 审计与运行日志使用同一本地 ID，模型上游响应 ID 和自动对账仍正确。
- 没有启用 billing/recorder 时，上游非 2xx 仍有诊断。
- SSE HTTP 200 后的错误、非正常 EOF、缺终止事件、用量补算均保留正确且独立的结果语义。
- HTTP 摘要不重复 ERROR，不绕过错误限频；预期离线/排空即使 DEBUG 被过滤也不触发 5xx 错误兜底；异步完成事件只产生一次。
- 流式首块及时到达，flush 不受影响，取消不阻塞；WebSocket 握手与连接功能不退化。
- 未提交响应的 panic 返回通用 500；已提交响应的 panic 不伪造新状态；`ErrAbortHandler` 不被当作程序异常重复记录。
- 后台重试节奏、幂等、余额、审计事务、任务状态不因日志改造改变。
- relay 的控制/数据通道、租约/撤销、旧代次替换、流量限额及桥接排空不变；离线、取消、正常关闭不刷 ERROR，系统故障保留安全主诊断。
- 文件/预览的 Host 与 grant 绑定、Header 剥离、重定向拒绝、CSP/沙箱和 Origin 限制不变；日志中不存在票据、grant、能力令牌、证明或原始通配路径。
- 分卷上传缺块续传、相同块幂等、不同内容冲突、SHA-256、封存、过期、取消、旧式 multipart 和 JSON upload ID 导入均不退化；无包内容、文件名、存储 key 或游标泄漏。
- 资源提交成功但上传 imported 更新失败时，运行日志保留两个真实阶段；幂等再次导入不伪造新批次，补偿失败仍有独立安全事件。
- readiness 的数据库、对象存储和端点停止场景正确区分；5 秒超时、检查顺序及响应不变，不将正常排空记为数据库故障。
- 批次和单任务失败不重复计数；分钟级扫描故障在 5 分钟策略下可实际汇总。
- 默认部署中的日志构造选项实际传入容器并用于创建根 logger；外部注入场景不被环境变量改变。
- 每个独立交易/任务的最终失败都可定位；同一对象中间重试可汇总。
- 经真实 Nginx 验证普通路由的后端 ID 关联、SSE、Upgrade、长连接/分卷上传设置，以及 OAuth 查询参数与路径 grant 不泄漏；同时检查 access/error 两条输出、最终配置和提前拒绝路径，敏感 location/预览站点仍禁日志。
- 退出场景覆盖 relay/端点排空、上传/运行密钥清理及其他 worker 等待、数据库关闭和最终日志刷新；超时路径不假设全部协程已退出。

### 13.4 建议检查命令

以下命令用于复核完整实现。已执行结果、外部环境和跳过项以[实施验收记录](../backend/docs/logging-validation.md)为准：

在当前项目根目录执行：

```sh
cd backend
go test ./logging ./server ./internal/httpapi ./internal/proxy -count=1
go test -race ./logging ./server ./internal/httpapi ./internal/proxy -count=1
go test ./internal/audit ./internal/apikey ./internal/identity ./internal/endpoint -count=1
go test ./internal/app ./internal/resource ./internal/resourceimport ./internal/relay -count=1
go test -race ./internal/app ./internal/resourceimport ./internal/relay -count=1
go test ./internal/billing ./internal/imagegen ./internal/videogen ./internal/mcp -count=1
go test ./... -count=1
go vet ./...
```

入口单元测试使用内存 Handler，验证真实全局默认、级别、输出和生命周期契约；应用启动集成测试使用已有专用数据库及存储环境。镜像发布、安装或部署不属于方案验证，另行确认。

需要数据库、对象存储或 Nginx 的测试使用已有专用测试基础设施，不能对生产数据执行故障注入；因环境跳过的测试必须明确列出，不能算作已通过。

- relay 与分卷上传集成测试需要 `MONKEYAI_TEST_DATABASE_URL`；真实 Nginx 测试还需要 `MONKEYAI_TEST_NGINX_IMAGE` 及可用容器环境，分别检查主站点代理和预览 TLS。
- `backend/internal/relay/browser_test.go:19` 的预览沙箱测试需 `MONKEYAI_BROWSER_PREVIEW_DIR` 和真实浏览器配合；只运行 `go test` 后跳过，不能当作浏览器隔离验收完成。
- 环境变量先按各测试的现有契约准备；本轮文档对齐不启动这些基础设施，不执行镜像发布或部署。

新增性能基准覆盖：去重关闭、单热点重复、4096 指纹分布、容量溢出、并发输出及流式场景。记录相对现有 `slog` 的耗时、分配和吞吐，检查持续运行时 goroutine 与内存是否稳定。

## 十四、上线、回退与限制

- 同时验收默认命令和注入自定义 logger 的可嵌入入口，确保全局及模块日志均经过同一链路；仅检查一种入口不算完成。
- 先完成代码与测试，再按实际部署的灰度能力启用；观察错误实际计数、输出量、汇总延迟、容量溢出和流式表现。
- 初始使用 60 秒窗口、4096 指纹；异常时可关闭去重恢复逐事件输出，但仍保持脱敏和本地请求 ID。
- 字段迁移影响已有日志检索与告警，按本地 ID/上游 ID 新语义同步规则，不为兼容旧查询继续输出错误语义的字段。
- 无数据库迁移，回退应用无需回滚业务数据；Nginx 与容器轮转配置独立验证、独立回退。
- 本轮不保证跨实例去重、不保证崩溃前未刷新日志不丢、不保证每个被压制请求都可通过日志单独检索；需要逐请求证据的业务依赖审计和持久化记录。

最终验收不是“日志明显少了”，而是：**常见失败能快速定位，重复故障有准确数量和样本，关键业务事件不被吞掉，凭据不泄漏，协议与业务行为不变。**
