# MonkeyAI 单进程端点桥接设计

状态：服务端单进程桥接已实现并完成自动验证，待评审合并，尚未部署；原生客户端业务协议与联合验收不在本次交付范围。

日期：2026-09-16。

## 1. 目标与范围

为同一 MonkeyAI 用户的桌面端和移动端提供端点发现与双向 WebSocket 通道，使移动端能够通过客户端业务协议控制桌面端工作 Agent。

本期交付：

- 当前用户端点的登记、查询、改名、撤销和恢复。
- 原生客户端使用 OAuth Bearer access token 建立长连接。
- `request`、`response`、`event` 信封校验和在线单播转发。
- 连接替换、目录快照、心跳、凭据复验、背压、限流和优雅停机。

本期不交付：

- 多副本、跨进程路由、Redis、消息队列或高可用协调器。
- 离线消息、消息重放、服务端请求状态、业务执行保证和自动业务重试。
- 会话接续、文件读取、执行停止、权限确认等具体 Agent 方法。
- 浏览器直接接入、设备配对、设备级登录授权撤销、端到端加密。
- 移动应用后台保活或推送唤醒。

桥接上线只意味着通信通道可用，不等于远程控制业务已完整上线。后端不执行客户端命令、不解释业务 `payload`，也不因此获得代替用户调用模型或 MCP 的权限。

## 2. 与原方案的关系

本文基于 MonkeyCode 的《端点桥接协议》和《端点桥接客户端接入协议》（原文件名分别为 `2026-07-17-client-bridge-protocol.md`、`2026-07-17-client-bridge-client-protocol.md`），是 MonkeyAI 的独立实现规范，不依赖工作树中的原文件才能理解或实现。

| 项目 | MonkeyAI 约定 |
|---|---|
| 消息结构 | 沿用原桥接协议主版本 `1` 的信封与握手结构 |
| 认证 | Cookie 改为原生客户端 OAuth Bearer access token |
| 在线目录与路由 | 单进程内存，不使用 Redis 租约和 Pub/Sub |
| 持久化 | PostgreSQL 保存端点资料和撤销状态，不保存业务消息 |
| 连接代次 | 保留，仅用于本进程连接替换和竞态隔离 |
| `4003` | 凭据失效；经统一 OAuth 管理器恢复后可重新连接，不直接使用旧凭据重连 |
| `stale_route` | 首版不产生；检查代次与业务入队在同一用户临界区完成 |
| 服务重启 | 所有连接断开，重连后重新握手和同步目录 |

主版本 `1` 表示消息格式，不表示不同产品认证流程完全兼容。旧 MonkeyCode 客户端必须适配 Bearer 和 `4003` 恢复行为后才能连接；服务端不兼容 Cookie，也不通过消息主版本协商登录方式。

## 3. 系统架构

```text
移动端原生网络层 ── WSS / OAuth Bearer ──┐
                                        │
                                   Nginx 入口
                                        │
桌面端原生网络层 ── WSS / OAuth Bearer ──┘
                                        │
                           MonkeyAI 单后端进程
                             internal/endpoint
                               ├─ identity：认证与凭据复验
                               ├─ PostgreSQL：端点资料
                               ├─ 内存：目录状态、连接、队列、限流器
                               └─ audit：安全事件
```

只允许一个提供桥接能力的后端进程。当前部署不增加分布式锁或自动选主，因此部署方必须保证这一前提；普通负载均衡或粘性会话不能使多个进程正确互通。

更新时先停止旧进程，再启动新进程，允许连接中断，不承诺滚动更新无缝接续。不得使用两个后端并行接入的方式发布桥接服务。

## 4. 身份、认证与权限

### 4.1 发现域

端点归属键为 `(user_id, machine_id)`。所有 HTTP 查询与 WebSocket 路由均从服务端认证上下文获取 `user_id`，客户端不得声明用户身份。

- 仅当前用户端点可见、可管理、可通信。
- 管理员身份、分组授权、资源分享不能突破发现域。
- 机器标识只是地址，不是认证凭据，也不是可信硬件身份。
- 同一个机器标识在不同用户下是两个独立端点。
- 客户端本地目录和 pending 必须按服务地址、用户隔离；退出或切换账号时清空，不得沿用上一用户状态。

### 4.2 Upgrade 与 HTTP 认证

所有端点接口复用 Agent OAuth 认证，要求 `Authorization: Bearer <access_token>`。

- 不接受浏览器 Cookie、refresh token 或模型/MCP 调用密钥作为访问凭据。
- 凭据不得进入查询参数、`hello`、业务载荷、日志或关闭原因。
- access token 在 Upgrade 前校验，失败返回 HTTP `401`，不建立 WebSocket。
- identity 必须能区分无效凭据与数据库暂时不可用：前者 `401`，后者 `503`，不能把数据库故障当作用户需要重新登录。
- 验证用户仍为启用状态、未删除，token 未过期、未撤销。
- 原生网络层负责附加 Authorization；不要求浏览器标准 WebSocket API 支持自定义请求头。

生产环境使用 WSS，客户端拒绝明文远程连接；开发环境只允许 loopback 地址使用 WS。Nginx TLS 终止后到容器内后端可使用 HTTP，但后端端口不直接暴露公网。

原生请求可以不带 Origin；非空 Origin 必须匹配配置的 `MONKEYAI_PUBLIC_URL` 来源（scheme、host、有效 port），不接受通配符或 `null`。开发时同样使用配置的对外来源。Origin 不是身份凭据。

### 4.3 长连接凭据复验

现有 `RequireAgent` 只把用户写入请求上下文，不能独自完成升级后的凭据复验。实现时扩展 identity，提供认证结果和可复验的内部凭据引用：

- 用户标识、access token 到期时间，以及 token 摘要或不透明引用。
- 能根据引用验证原 token 和用户状态，且区分认证失败与基础设施错误。
- 引用只在进程内流转；连接不长期保留明文 access token。
- endpoint 定义所需的最小接口，由集成层适配 identity；endpoint 不直接查询身份表。

每条连接独立每 30 秒复验一次，数据库操作超时为 5 秒，不等待收到 Pong 才开始复验。身份中间件对基础设施错误统一返回 `503 service_unavailable`，这一错误分类同时适用于现有 Agent 接口。

- 到达已知 access token 过期时间时立即停止新业务入队并关闭 `4003`。
- 检测到撤销、用户停用或删除时关闭 `4003`。
- 复验超时或数据库不可用时停止该连接路由并关闭 `1013`，不能沿用旧验证结果无限服务。
- 通过数据库检测的撤销/用户停用允许最多约 35 秒的收敛窗口，不宣称瞬时失效；端点 HTTP 撤销按第 9 节在本进程立即生效。
- 已经交付给 Agent 的操作无法由桥接撤回。

### 4.4 token 刷新与重连

当前 OAuth 刷新会撤销旧 token 记录并生成新记录，因此刷新后旧 WebSocket 的凭据也失效。

每个客户端安装、每个账号只保留一个 OAuth 刷新管理器和一个桥接连接管理器，避免多个页面或模块并发轮换同一 refresh token。

正常轮换流程：

1. 提前于 access token 到期时间刷新，建议提前 60 秒并加入小幅抖动。
2. 暂停新桥接请求；未完成请求结算为 `outcome_unknown`，关闭旧连接。
3. 由统一 OAuth 管理器完成刷新并安全保存新 token 对。
4. 使用新 access token 建连，重新 `hello → welcome → directory.snapshot`。
5. 恢复业务入口，不自动重发旧消息。

收到 Upgrade `401` 或关闭码 `4003` 时：

- 已有比失败连接更新的凭据，直接使用新凭据；否则合并为一次 OAuth 刷新操作。
- 新凭据成功才允许重新连接。新凭据仍立即被拒绝时停止桥接恢复，提示重新认证或账号不可用，不能无限刷新。
- refresh 返回 `invalid_grant` 时清理不可用登录凭据并提示重新登录。
- 网络错误或服务端暂时错误保留登录状态，按退避恢复 OAuth，不拿已失效的旧 token 循环连接。

原生客户端退出时先停止桥接，再调用 OAuth revoke 并清理本地凭据。浏览器 logout 仅退出浏览器会话，不隐式撤销原生客户端授权。

## 5. 数据模型

新增 `endpoints` 表，按现有迁移序列新增，不预先占用迁移号。

| 字段 | 类型/约束 | 说明 |
|---|---|---|
| `id` | UUID 主键，服务端生成 | 内部记录标识，不作为协议路由地址 |
| `user_id` | UUID 外键，非空 | 所属用户 |
| `machine_id` | UUID，非空 | 安装生成的随机 UUIDv4 |
| `device_name` | text，非空 | 安装上报名称 |
| `alias` | nullable text | 用户自定义别名 |
| `platform` | text，限定枚举 | `macos/windows/linux/ios/android` |
| `os_version` | text，非空 | 系统版本 |
| `arch` | text，非空 | 架构 |
| `client_version` | text，非空 | 客户端版本 |
| `protocol_version` | integer，非空 | 最近一次成功登记的协议主版本 |
| `status` | text，`active/revoked` | 持久管理状态 |
| `created_at/updated_at` | timestamptz | 资料时间 |
| `last_seen_at` | nullable timestamptz | 最近一次持久化的活动观测时间 |
| `revoked_at` | nullable timestamptz | 撤销时间；恢复时置空 |

约束与索引：

- 唯一约束 `(user_id, machine_id)`，用户目录查询以 `user_id` 为前缀。
- `status` 与 `revoked_at` 保持一致；状态约束同时落在数据库。
- 默认最多 20 个 `active` 端点，离线也计入；恢复端点同样检查上限。
- 限额检查和新增/恢复写入在同一事务内串行化，可锁定所属用户行，避免两个并发登记共同突破上限。
- 不持久化 `online`、连接代次、队列、限流额度、请求或业务消息。

`machine_id` 首次安装随机生成并保存在原生安全存储，重启及账号切换不重新生成；卸载重装可生成新值。不使用 MAC、序列号或硬件指纹。客户端不得主动复制机器标识到其他安装。

资料字段上限按 UTF-8 字节计算：`device_name/alias` 128、`os_version/client_version` 64、`arch` 32；字符串拒绝控制字符。必填值不得为空或仅空白；`alias: null` 表示清除别名，空字符串不作为有效别名。展示名称为 `alias ?? device_name`，客户端按文本渲染。

`last_seen_at` 在连接成功登记时写入，在线期间最多每 60 秒合并写一次，正常离线时尽力写入；崩溃可能丢失最近一段观测。在线连接可返回更新的内存观测时间。它不是租约、不保证精确离线时刻，也不参与 online 判定。资料审计不因每次 last_seen 更新产生事件。

不提供端点硬删除接口，撤销记录继续保留；列表使用分页，避免历史撤销记录无限膨胀响应。用户删除的数据保留策略沿用系统既有约定，不由桥接额外规定永久保存用户数据。

## 6. HTTP 接口

统一位于 `/api/v1/endpoints`，要求 Bearer；响应设置 `Cache-Control: private, no-store`。

| 方法 | 路径 | 行为 |
|---|---|---|
| GET | `/api/v1/endpoints` | 分页查询当前用户端点，含 revoked |
| GET | `/api/v1/endpoints/{machine_id}` | 查询一个当前用户端点 |
| PATCH | `/api/v1/endpoints/{machine_id}` | 只修改 alias |
| POST | `/api/v1/endpoints/{machine_id}/revoke` | 撤销端点并关闭其连接 |
| POST | `/api/v1/endpoints/{machine_id}/restore` | 显式恢复，受 active 上限约束 |
| GET | `/api/v1/endpoints/connect` | WebSocket Upgrade；具体路径优先于动态路径 |

- 列表参数 `page` 默认 1、`page_size` 默认 20、最大 100；按 `created_at DESC, id DESC` 稳定排序，返回 `{items, total, page, page_size}`。
- 列表只用于管理，分页不是跨请求一致性快照；实时目录始终以 WebSocket 全量快照为准。
- 单条、PATCH、revoke、restore 成功返回 `200` 与最新端点对象；重复 revoke/restore 幂等，不产生重复状态变更审计。
- HTTP 端点对象包含 `machine_id`、profile 字段、alias、display_name、protocol_version、status、online、created_at、updated_at、last_seen_at、revoked_at，不暴露 token 或连接代次。
- HTTP 时间统一输出 Unix 毫秒，可空时间为 `null`；目录结构见第 7 节。
- 未知或其他用户的管理目标统一 `404 endpoint_not_found`；字段无效 `400 invalid_request`；端点限额冲突 `409 endpoint_limit_exceeded`；认证失败 `401 invalid_token`；存储暂不可用 `503 service_unavailable`。
- 未知 JSON 字段在管理写接口中拒绝，PATCH 只允许 `alias` 且必须提供。revoke/restore 不接收业务参数。
- HTTP 错误沿用 `{error: {code, message}}`，不要混用 WebSocket `type:error` 信封。
- 不提供 HTTP 新建端点接口；首次有效 hello 完成登记。

## 7. WebSocket 握手与目录

### 7.1 编码与边界

使用 `github.com/coder/websocket`，这是标准库没有对应能力时引入的唯一新增业务通信依赖，不新增通用传输抽象层。

- 使用 UTF-8 JSON 对象文本消息，禁止二进制消息与 `permessage-deflate`。
- 本文大小限制针对完整 WebSocket 消息，而不是单个物理分片；分片累计同样受限。
- 入站完整消息最大 256 KiB；注入服务端字段后的出站消息也不得超过 256 KiB。
- hello 上限 4 KiB；JSON 嵌套深度上限 64，拒绝重复对象键、非法 UTF-8、尾随多余 JSON 或顶层非对象，避免解析差异和资源滥用。
- 消息类型决定允许字段；客户端发送 `source`、`routed_at`、`user_id` 等保留身份字段时拒绝。未知非保留顶层字段丢弃，不转发；已知字段不符合该类型时拒绝。
- payload 必须为对象，空载荷使用 `{}`；不将业务数字转成 float64 后重新编码，避免大整数精度丢失。使用 `json.RawMessage` 保留 payload 的 JSON 值，允许序列化时规范化空白与转义，不改变数字精度；服务端只做结构和资源边界验证。

### 7.2 握手

Upgrade 后 5 秒内只能接收一次 hello；超时、重复 hello 或在 welcome 前发业务消息关闭 `1002`。

```json
{
  "type": "hello",
  "protocol_versions": [1],
  "machine_id": "4f1207be-1ce0-4e88-8e3e-e92690567ec8",
  "profile": {
    "device_name": "办公电脑",
    "platform": "macos",
    "os_version": "15.5",
    "arch": "arm64",
    "client_version": "260916.1"
  }
}
```

`protocol_versions` 是非空、无重复的正整数数组，最多 8 项；选择共同支持的最高主版本，首版仅支持 1。没有共同版本时尽力发送 `unsupported_protocol` 后关闭 `1002`。machine_id 使用规范小写、带连字符的 UUIDv4 字符串。

有效 hello 在用户串行化临界区内执行：检查凭据仍有效、读取端点状态、检查限额、持久化 profile，然后原子安装新连接代次。revoked 记录不能被 hello 自动恢复；失败的 hello 不替换已有有效连接。hello 不修改用户 alias。

```json
{
  "type": "welcome",
  "protocol_version": 1,
  "server_time": 1789545600000,
  "heartbeat": {"interval_ms": 30000, "timeout_ms": 10000},
  "limits": {"max_frame_bytes": 262144, "max_endpoints": 20}
}
```

`max_frame_bytes` 保留原字段名，语义是完整消息上限。第一条出站应用消息必须是 welcome，第二条为当前 directory.snapshot，之后才可以发送业务消息。初始化期间允许将业务消息放入有界队列，但不能先于这两条消息发出；初始化写失败时清理当前代次并视为离线。

### 7.3 全量目录

```json
{
  "type": "directory.snapshot",
  "endpoints": [
    {
      "machine_id": "4f1207be-1ce0-4e88-8e3e-e92690567ec8",
      "device_name": "办公电脑",
      "alias": null,
      "display_name": "办公电脑",
      "platform": "macos",
      "os_version": "15.5",
      "arch": "arm64",
      "client_version": "260916.1",
      "protocol_version": 1,
      "online": true,
      "last_seen_at": 1789545600000
    }
  ]
}
```

- 包含当前用户全部 active 端点，包括自身和离线端点，排除 revoked。
- 按 machine_id 排序；上线、离线、资料变化、改名、撤销、恢复后通知当前用户所有在线连接。
- 客户端整体替换数组，不增量合并，不依赖 revision；只接受当前连接实例的回调，旧连接回调不得覆盖重连后的目录。
- 用户级状态变化和快照生成串行执行。入队的是不可变快照，不在锁外异步查询数据库后直接广播，避免旧查询结果覆盖新状态。
- 每连接最多保留一份尚未发送的目录快照，新快照覆盖待发送旧快照；允许省略中间瞬态，不允许较旧快照晚于新快照发送。
- last_seen 心跳更新不单独触发广播；广播失败不能伪造空目录，应关闭对应慢连接或按存储错误处理。
- 新进程启动后不会从数据库恢复 online=true；只有当前进程成功登记的活动连接才在线。

## 8. 业务消息

### 8.1 信封

发送请求：

```json
{
  "type": "request",
  "message_id": "6ccdf7ee-10c2-4926-86ce-8f9ca82aa2ca",
  "target": "dc9e38fe-c928-42b1-b8eb-e8ca41d712fe",
  "method": "agent.example",
  "payload": {"content": "hello"}
}
```

服务端向目标转发同一信封，额外注入由认证连接确定的 `source` 和服务端 Unix 毫秒 `routed_at`。`event` 使用同样字段，但不要求响应。

响应：

```json
{
  "type": "response",
  "message_id": "05cc070a-be53-40b2-b09b-da77d2ea002f",
  "target": "4f1207be-1ce0-4e88-8e3e-e92690567ec8",
  "reply_to": "6ccdf7ee-10c2-4926-86ce-8f9ca82aa2ca",
  "payload": {"result": "ok"}
}
```

- 每条业务消息的 message_id 为客户端新生成的 UUIDv4；所有路由 UUID 使用规范字符串。
- request/event 必须带 method，匹配 `^[a-z][a-z0-9._-]{0,127}$`，不能携带 reply_to。
- response 必须带 reply_to，不携带 method；服务端也为响应注入 source 和 routed_at。
- method 示例只用于说明信封，不构成已实现的 Agent 方法。
- 允许发给自身，但仍经过同样的限流、校验和有界队列。
- 不存在、其他用户或 revoked 目标统一返回 `target_unavailable`；同用户 active 离线目标才返回 `target_offline`。

### 8.2 投递与结果

服务端不生成成功回执，不保存 pending，不检查 response 是否对应真实历史请求，不去重 message_id。业务入队成功不等于已写入网络，更不等于 Agent 执行完成。

客户端负责 pending，默认 30 秒超时，可按方法覆盖。只有以下条件全部满足才完成请求：reply_to 对应当前连接仍在等待的请求；source 等于原 target；target 为自身；响应 message_id 合法且未处理；type 为 response。重复、迟到、未知或错误来源的响应忽略。

超时或断线统一结算为本地 `outcome_unknown`，表示可能已经执行；重新连接不能复活旧 pending。协议错误携带有效 reply_to 时结束对应 pending，但不能把网络写失败或事后错误解释为业务未执行。

桥接不会主动重试；客户端通用连接库也不重试业务消息。仅 Agent 明确确认幂等方法时，业务层才可以复用原 message_id 重试；接收端按用户、来源和 message_id 做有界去重或缓存业务结果。

单一来源到单一目标，在双方连接均连续有效时，业务消息按发送顺序进入目标队列；响应顺序、不同来源和跨重连顺序不保证。routed_at 仅供观测，不参与排序。

## 9. 单进程并发与端点状态

### 9.1 内存归属

endpoint 服务持有用户状态表，每个用户状态包含 active 端点目录、当前连接映射、用户级限流状态和串行化锁。每连接持有唯一代次、认证引用、到期时间、取消信号、发送队列和连接级限流状态。

- 同用户登记、替换、撤销、恢复、资料更新、路由检查与入队串行化；不同用户独立执行。
- 目录首次加载和必要数据库写入在用户级有超时的临界区内完成；数据库故障不能无限阻塞。
- 网络写、关闭握手和等待 goroutine 退出不持有用户锁。
- 队列入队非阻塞，写循环独立；不为每条消息启动无界 goroutine。
- 无连接、无进行中操作、限流冷却已结束的用户状态及时释放，避免历史用户永久留在内存；并发获取和释放同一用户状态必须安全。

### 9.2 替换与清理

新连接登记成功后，在同一临界区使旧代次失效并安装新代次，再在锁外关闭旧连接 `4001`。

- 旧连接不能继续作为来源发送，也不能接收新的业务入队。
- 每次路由同时校验来源是当前代次、目标是当前有效代次、双方凭据均未到已知过期时间且未标记失效，并完成入队，不在检查与入队之间释放用户锁。
- 旧连接退出时只能删除仍与自己匹配的映射，不能删除新连接或把新连接标为离线。
- 写循环在领取消息时检查失效状态和已知凭据到期时间，丢弃已失效连接尚未开始写的业务队列。
- 在替换/撤销之前已经开始网络写或交付的消息可能仍到达，桥接无法回滚；不能承诺零在途消息。

### 9.3 撤销与恢复

撤销在用户临界区内提交数据库事务（含状态变更审计），随后同步标记连接失效、更新内存目录并发布新快照，最后锁外关闭连接 `4002`。成功响应前内存失效必须完成。

恢复将 revoked 改为 active、清除 revoked_at，检查 20 个 active 限额，更新快照，但不主动建立连接。重复操作不重复制造状态变更。

失败的数据库事务不发布成功状态。提交成功后若进程崩溃，所有连接随进程退出，新进程从数据库重新加载，不需要 Redis 或补偿消息。

**撤销仅表示停用端点，不是失窃设备的登录授权撤销。** 持有有效账号凭据的客户端可以调用 restore，甚至用新 machine_id 登记。本期界面应使用“停用端点/恢复端点”并说明边界，不应宣传为“踢出设备并永久禁止访问”。真正设备级撤销需后续绑定机器与 OAuth 授权链。

## 10. 心跳、背压与资源边界

默认参数属于实现配置，不改变消息主版本；首版先采用以下值，修改前需通过容量测试。

| 参数 | 默认值 |
|---|---|
| hello 截止时间 | 5 秒 |
| 原生 Ping 周期 / Pong 截止 | 30 秒 / 10 秒 |
| 凭据复验周期 / 单次超时 | 30 秒 / 5 秒 |
| 单条应用消息大小 | 256 KiB |
| 单连接业务队列 | 最多 64 条且总计最多 2 MiB，任一先到即满 |
| 单连接协议错误队列 | 最多 16 条且总计最多 64 KiB |
| 单连接待发送快照 | 最多 1 份，按最新覆盖 |
| 单次网络写截止 | 10 秒 |
| 单端点入站速率 | 60 条/秒、1 MiB/秒；各允许 1 秒突发量 |
| 单用户入站速率 | 240 条/秒、4 MiB/秒；各允许 1 秒突发量 |
| 单用户 Upgrade 尝试 | 10 次/秒，允许 20 次突发；按已认证用户统计 |
| 全进程连接上限 | 1000，含等待 hello 的已接受连接 |

全局连接上限不等于容量承诺：满队列时仅业务队列就可能占用约 2 GiB，部署必须按内存预算下调上限，并通过压测确定实际值。认证前请求滥用由入口限流负责，不信任未配置可信代理时的任意 X-Forwarded-For。

- 业务超限拒绝当前消息并返回 `rate_limited`；连续 10 秒仍持续超限可关闭 `1008`，拒绝的消息也计入滥用观测。
- 目标业务队列满时当前消息不入队，向来源返回 `target_busy`；不阻塞其他用户，不静默丢弃。
- 错误队列也必须有界，发送方无法接收错误时关闭其连接 `1013`，不递归生成错误。
- 单次写超时或持续队列饱和 30 秒不能恢复时关闭慢连接；能发 Close 时使用 `1013`，否则直接中断传输。
- Close/Ping 优先；welcome 和初始快照先于业务；后续系统应用消息最多连续发送 8 条后让已就绪业务消息获得一次发送机会。
- 所有 request/response/event 都计入消息数和字节限流，转发后的规范化大小计入目标队列字节数。
- 原生 Ping/Pong 不是 JSON 消息；移动端被挂起后无法响应，按离线处理，恢复前台后重新同步。
- PostgreSQL 故障时新登记和管理操作失败；已连接端点在下一次复验失败后关闭，不靠旧身份缓存长期运行。

## 11. 错误与关闭码

WebSocket 协议错误与 Agent 业务响应分离：

```json
{
  "type": "error",
  "reply_to": "6ccdf7ee-10c2-4926-86ce-8f9ca82aa2ca",
  "error": {
    "code": "target_offline",
    "message": "目标端点当前离线",
    "retryable": true,
    "retry_after_ms": 1000
  }
}
```

无法安全提取合法 message_id 的错误不设置 reply_to。retry_after_ms 仅在能提供建议时出现；retryable 表示稍后重试可能成功，不授权自动业务重试。

| 错误码 | retryable | 行为 |
|---|---|---|
| `invalid_message` | false | 结构无效；握手阶段关闭，业务阶段拒绝当前消息，持续违规关闭 1008 |
| `unsupported_protocol` | false | 尽力发送错误后关闭 1002 |
| `unauthorized` | false | 尽力发送错误后关闭 4003，经 OAuth 恢复而非直接重连 |
| `endpoint_revoked` | false | hello 阶段或运行中发现撤销，关闭 4002 |
| `endpoint_limit_exceeded` | false | 拒绝登记并关闭 1008，引导停用旧端点 |
| `target_unavailable` | false | 目标不存在、其他用户或 revoked |
| `target_offline` | true | 同用户 active 端点离线 |
| `target_busy` | true | 目标队列满，当前消息未入队 |
| `rate_limited` | true | 当前消息被限流 |
| `payload_too_large` | false | 服务端注入字段后超过 256 KiB，拒绝当前消息 |
| `service_unavailable` | true | 存储暂不可用或服务正在退出，必要时关闭连接 |

原始完整消息超过 256 KiB 使用 `1009`；非法 UTF-8 使用 `1007`；二进制消息及握手协议违规使用 `1002`。错误原因不包含 payload、凭据或其他用户端点资料。

| 关闭码 | 含义 | 客户端处理 |
|---|---|---|
| `1000` | 正常关闭 | 不自动重连；主动刷新、前台恢复等由连接管理器发起新连接 |
| `1002` | 协议不兼容或握手违规 | 停止，提示升级或修复 |
| `1007` | 非法文本编码 | 停止，修复发送逻辑 |
| `1008` | 策略或持续限流违规 | 停止，解决限制后由用户重新连接 |
| `1009` | 消息过大 | 停止，修复发送逻辑 |
| `1011` | 内部错误 | 退避重连 |
| `1012` | 服务重启 | 退避重连 |
| `1013` | 暂时不可用或过载 | 退避重连 |
| `4001` | 同机器标识新连接替换 | 停止自动重连，避免互相顶替 |
| `4002` | 端点被撤销 | 停止；显式恢复后才能重新连接 |
| `4003` | OAuth 凭据失效或账号不可用 | 按第 4.4 节恢复，不用旧凭据直接重连 |

网络异常与可重连关闭码使用带随机抖动的指数退避，约 `0.5 → 1 → 2 → 4 → 8 → 最高 30 秒`；稳定在线 60 秒后重置。Upgrade `429/503` 遵循 Retry-After 并退避；`403` 来源策略失败不自动重连。异常断线可由客户端观测为 `1006`，服务端不能发送该保留关闭码。

## 12. 客户端业务边界

端点协议只保证到在线 Agent 的通道。另行定义业务协议时至少覆盖：

- 会话列表、状态查询、消息订阅、首次快照及重连恢复。
- 提交输入、停止执行、权限确认的请求/响应、业务错误和幂等策略。
- 长操作快速确认与后续事件分离，不能把 30 秒请求超时当作执行最长时限。
- 多个远程端同时控制一个会话时的冲突规则、事件序号与重复处理。
- 桌面端用户明确启用远程控制；远程来源不能绕过既有权限检查、沙箱或用户确认。
- 移动端回到前台后查询真实会话状态，不假设断线期间事件已补发。

文件由持有它的源端点保管，不上传桥接或 RustFS。首版建议沿用单文件最多 5 MiB 的 Agent 侧限制；路径权限、编码、分块、偏移、校验和及传输中止均由 Agent 方法定义。每块完整 JSON 仍受 256 KiB 限制，必须预留编码和信封开销。桥接不重组文件，因此不能宣称已在后端强制实施文件总量限制。

## 13. 安全、审计与观测

只提供传输加密，不提供端到端加密；服务器技术上可接触 payload 字节。不得宣传服务器无法读取内容。

- 日志只记录白名单元数据：用户、来源/目标机器标识、message_id、type、method、消息大小、结果、耗时。
- 不记录 token、认证引用、完整请求头、payload、文件内容；客户端和错误路径同样遵守。
- 端点登记、改名、撤销、恢复写入持久化安全审计，与业务变更使用同一事务；连接替换、认证失败和异常断线以受限结构化安全日志记录。
- 已有 audit 分类复用 security；不能直接把整个桥接信封传给通用审计参数。
- 记录当前连接数、握手失败数、消息/字节吞吐、队列占用、限流次数、关闭码和复验耗时；指标标签不得使用 user_id、machine_id、message_id 或任意 method 等高基数字段。
- 连接故障的诊断以元数据关联，不能临时开启 payload 调试日志。

## 14. 集成与停机

### 14.1 代码归属

```text
backend/internal/endpoint/
  service.go     服务生命周期与用户状态
  protocol.go    消息定义、解析与校验
  connection.go  单连接读写、队列、心跳
  handler.go     HTTP 与 Upgrade
  postgres.go    端点存储适配
  query.sql      生产 SQL
  sqlc/          生成结果
  *_test.go      协议、并发、数据库测试
```

实际拆分随实现规模调整，不预建空抽象。构造函数接收必需依赖，可选配置使用链式 WithXxx。显式 `RegisterAgent` 接入，不引入全局注册表、DI 容器或分布式路由接口。

共享集成点：

- `internal/identity`：认证结果、凭据复验及基础设施错误区分，保持已有 Agent API 行为。
- `internal/app`：构造 endpoint、路由注册、生命周期和停机协调。
- `go.mod/go.sum`：新增 coder/websocket，由集成步骤统一处理。
- `migrations`、sqlc 配置与 schema 生成：生成新迁移和查询代码，禁止手改生成产物。
- `api/agent.yaml`：HTTP 契约和 Upgrade 描述；帧协议以本文为依据并由测试固化。
- `admin/nginx/app.conf`：为精确路径 `/api/v1/endpoints/connect` 增加 HTTP/1.1、Upgrade、Connection 头透传，保持 Host、转发头和禁用缓冲；不把所有普通 API 都强制设置为 Upgrade。
- `admin/vite.config.ts`：仅所需开发代理启用 `ws: true`。
- 部署说明：单后端进程、生产 WSS、代理空闲超时大于 40 秒并留余量（建议保持现有 90 秒），不新增 Redis 服务。

### 14.2 优雅停机

Go 的 `http.Server.Shutdown` 不会代替应用管理已升级的 WebSocket，必须显式协调：

1. endpoint 进入 draining，拒绝新 Upgrade、端点变更和新的业务入队，返回适当 503；就绪检查返回不可用。
2. 将所有连接标记为停止接收，尽力发送 `1012` 并取消工作循环；未发送业务队列不重放。
3. 锁外等待读写、心跳、复验、元数据刷新循环退出，最多使用剩余应用停机预算中的 10 秒。
4. 超时强制关闭底层连接；仅清理匹配代次的内存记录，last_seen 写入尽力完成，不阻碍退出。
5. 配合 HTTP Shutdown 和现有代理等待流程，最后才释放数据库资源。

已发送操作可能继续在 Agent 运行；客户端对断线 pending 标记 outcome_unknown，重连后由 Agent 业务状态查询恢复界面。

## 15. 实现顺序与验收

### 15.1 实现顺序

1. 身份前置：提供凭据引用、到期时间、复验和错误分类，测试轮换、撤销、禁用、数据库故障。
2. 端点存储与 HTTP：迁移、sqlc、用户隔离、限额事务、资料校验、审计。
3. 单进程连接与协议：握手、代次、全量快照、业务队列、严格校验和路由。
4. 生命周期与资源保护：刷新重连、定时复验、心跳、限流、故障与停机。
5. 共享集成：路由、API 契约、Nginx/Vite、部署说明；再与原生客户端联合验收。

### 15.2 必测场景

- OAuth Bearer 可连接；Cookie-only、调用密钥、refresh token 和 URL token 不能认证。
- 同用户桌面与移动端可双向通信；跨用户猜测机器标识始终不可见，管理员也不能越界。
- hello 超时、重复握手、提前业务消息、无共同版本、非法 UTF-8、重复键和分片累计超限。
- profile 和 alias 边界；未知字段；payload 大整数无精度丢失；注入字段前后分别检查消息大小。
- 并发首次登记及 restore 不突破 20 个 active；无效 hello 不挤掉已有连接。
- 并发连接替换、撤销、恢复、改名；旧连接清理不删除新连接，旧来源不继续路由，快照不倒退。
- 初始出站顺序严格为 welcome、snapshot、业务；重连后旧回调不覆盖新目录。
- 目标离线、队列满、来源无法接收错误、消息/字节限流；一个慢用户不拖住其他用户。
- 顺序、重复 message_id、未知/错误来源 response、超时和断线；不自动重发或承诺未执行。
- token 到期、主动刷新与心跳复验并发、多模块刷新合并；4003 不形成刷新/重连风暴。
- 用户停用、token revoke 在声明的时间窗口内失效；浏览器 logout 不误撤销原生连接。
- 端点 revoke 成功后不再接受新路由，restore 不自动上线；已在途消息边界符合说明。
- PostgreSQL 不可用：新认证与管理返回 503，复验失败关闭现有连接，不误清理用户登录状态。
- 真正经 Nginx/Vite 完成 Upgrade，空闲连接跨越代理超时仍因心跳保持可用；验证生产 TLS。
- 进程正常退出和强制终止后重连，目录不出现数据库残留的假在线，pending 不重放。
- goroutine、队列、用户状态和限流器在断连后回收；日志与审计不包含 payload 或凭据。

### 15.3 验证命令与证据要求

实现后先执行 `go test ./internal/endpoint/...` 和 `go test -race ./internal/endpoint/...`；身份前置执行 `go test ./internal/identity/...`。数据库用例使用独立测试数据库，按现有项目方式配置 `MONKEYAI_TEST_DATABASE_URL`，覆盖迁移和并发限额。

集成执行项目 `make check`、相关代理配置检查与真实握手测试。单独记录纯协议测试、数据库测试、代理测试和桌面/移动联合测试；环境缺失跳过项必须说明，不能用单元测试代替真实移动后台/前台与 OAuth 轮换验收。

## 16. 实施状态与验证记录

实现分支：`feat-monkeyai-endpoint-bridge`。

- [x] 更新 main 并建立独立 worktree；未修改原工作区实现。
- [x] identity 提供内部凭据引用、过期时间与复验能力，区分认证失败和存储故障。
- [x] 新增 `000002_endpoint_create` 迁移、sqlc 查询、用户隔离的端点管理和事务审计。
- [x] 完成握手、全量目录、信封校验、双向路由、连接代次隔离和结果未知语义。
- [x] 完成队列上限、限流、心跳、复验、关闭码、资源回收和应用停机协调。
- [x] 接入 Agent 路由、OpenAPI、连接上限配置、Nginx/Vite Upgrade 与部署说明。
- [x] 通过 `make check`：sqlc 生成一致性、全量常规测试和 go vet。
- [x] 使用隔离 PostgreSQL 18.6 与 RustFS 运行全量 `go test ./... -count=1`，包括实际应用路由和所有迁移逆序回滚/重建。
- [x] 桥接真实数据库/WebSocket `-race` 测试重复三轮通过；identity 数据库竞态测试通过。
- [x] 通过仓库 Nginx `app.conf` 实际代理的 Upgrade/握手测试，以及 Vite 实际配置的 Upgrade/Authorization 透传测试。
- [ ] 桌面与移动客户端联合验收，包括账号切换、后台挂起恢复和客户端 OAuth 刷新协调。
- [ ] 生产 WSS、长时间空闲代理连接与目标部署容量压测。

实现用连接对象身份作为进程内代次，不新增无用途的 UUID 字段；代次不下发客户端。运行观测使用每分钟结构化聚合日志及连接关闭日志，不新增监控服务或业务载荷日志。

`MONKEYAI_ENDPOINT_MAX_CONNECTIONS` 可配置全进程连接数，其他队列/速率参数为当前实现默认值，修改需重新压测；不宣称所有阈值均已暴露为部署配置。

Nginx 自动测试额外要求显式设置 `MONKEYAI_TEST_NGINX_IMAGE` 并有可用 Docker，会新建并清理专属测试容器；默认测试不操作 Docker。测试数据库与 RustFS 均为隔离临时环境，未迁移实际部署数据库。
