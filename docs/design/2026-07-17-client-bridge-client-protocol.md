# MonkeyCode 端点桥接协议（客户端规范）

## 1. 适用范围

本文只描述原生桌面端和移动端如何接入 MonkeyCode 端点桥接服务，不包含服务端存储、集群和跨实例路由实现。

协议主版本为 `1`，WebSocket 地址为：

```text
/api/v1/endpoints/connect
```

协议提供：

- 同一用户端点发现。
- 端点间 JSON 消息单播。
- Agent 事件、请求和响应。

协议不提供：

- 纯浏览器端点。
- 跨用户通信。
- 离线消息。
- 自动重试或消息去重。
- 二进制消息或超过 5 MiB 的文件传输。
- 任务、能力等 Agent 业务模型。

一个端点对应一个 Agent。所有端点在核心协议中地位对等，不区分控制端和被控端。

## 2. 客户端常量

| 配置 | 值 |
|---|---|
| 协议主版本 | `1` |
| 生产传输 | `wss://` |
| hello 超时 | 5 秒 |
| 单帧上限 | 256 KiB |
| 单文件上限 | 5 MiB |
| 默认请求超时 | 30 秒 |
| 服务端 Ping 间隔 | 30 秒 |
| Pong 超时 | 10 秒 |
| 默认端点上限 | 20 个未撤销端点 |

生产环境必须使用 WSS。开发模式仅允许 `localhost`、`127.0.0.1` 和 `[::1]` 使用 WS。

## 3. 机器标识

### 3.1 生成

首次安装时生成一个 UUID，作为 `machine_id`：

```text
4f1207be-1ce0-4e88-8e3e-e92690567ec8
```

要求：

- 使用随机 UUID。
- 应用重启后保持不变。
- 用户退出和切换账号时保持不变。
- 卸载重装后可以生成新 UUID。
- 不使用 MAC、硬盘序列号或硬件指纹。

### 3.2 存储

移动端保存到 Keychain、Keystore 等系统安全存储。桌面端保存到操作系统凭据或安全存储，不应由页面脚本自行生成临时值。

`machine_id` 只是端点标识，不是密码或鉴权凭证。

## 4. 鉴权

WebSocket 和端点管理 HTTP 接口都复用当前 MonkeyCode 登录 Cookie。

客户端要求：

- WebSocket Upgrade 时携带现有登录 Cookie。
- 不把 Cookie 或其他登录凭据放在 URL 查询参数中。
- Cookie 失效后停止桥接连接，并进入重新登录流程。
- 不允许客户端自行声明 `user_id`。

同一用户的新端点完成登记后立即可以与其他端点通信，不需要配对确认。

## 5. HTTP 接口

| 方法 | 路径 | 用途 |
|---|---|---|
| `GET` | `/api/v1/endpoints` | 查询全部端点，包括已撤销端点 |
| `GET` | `/api/v1/endpoints/{machine_id}` | 查询一个端点 |
| `PATCH` | `/api/v1/endpoints/{machine_id}` | 修改端点别名 |
| `POST` | `/api/v1/endpoints/{machine_id}/revoke` | 撤销端点 |
| `POST` | `/api/v1/endpoints/{machine_id}/restore` | 恢复端点 |
| `GET` | `/api/v1/endpoints/connect` | WebSocket Upgrade |

撤销当前端点后，其 WebSocket 会被关闭，客户端不得自动重连。持有有效 Cookie 的客户端可以显式调用恢复接口，然后由用户触发重新连接。

端点记录不会自动删除。达到端点上限后，客户端应引导用户通过管理接口撤销不再使用的端点。

## 6. 连接状态机

建议客户端使用以下状态：

```text
idle
  ↓ connect()
connecting
  ↓ WebSocket open
handshaking
  ↓ welcome
ready
  ↓ 可恢复断线
backoff
  ↓ 重连
connecting

任意状态
  ↓ 不可恢复关闭
stopped
```

状态要求：

- `connecting`：等待 WebSocket Upgrade。
- `handshaking`：只能发送 `hello`。
- `ready`：可以处理目录快照和 Agent 消息。
- `backoff`：等待自动重连。
- `stopped`：必须等待登录、恢复端点或用户操作。

客户端应为每次本地连接尝试分配递增序号，忽略旧 WebSocket 的延迟回调，避免旧连接触发重复重连。

## 7. 握手

### 7.1 流程

```text
客户端                      服务端
  │                           │
  │ WebSocket Upgrade+Cookie │
  ├──────────────────────────>│
  │ 101 Switching Protocols  │
  │<──────────────────────────┤
  │ hello                     │
  ├──────────────────────────>│
  │ welcome                   │
  │<──────────────────────────┤
  │ directory.snapshot        │
  │<──────────────────────────┤
  │                           │
  │    进入 ready 状态         │
```

WebSocket 打开后，客户端必须在 5 秒内发送 `hello`。收到 `welcome` 前不能发送 Agent 消息。

### 7.2 hello

```json
{
  "type": "hello",
  "protocol_versions": [1],
  "machine_id": "4f1207be-1ce0-4e88-8e3e-e92690567ec8",
  "profile": {
    "device_name": "Yoko 的 MacBook Pro",
    "platform": "macos",
    "os_version": "15.5",
    "arch": "arm64",
    "client_version": "260717.1"
  }
}
```

`platform` 可取：

```text
macos
windows
linux
ios
android
```

`device_name` 是系统设备名。用户设置的 `alias` 由服务端保存，客户端不能通过 `hello` 覆盖。

### 7.3 welcome

```json
{
  "type": "welcome",
  "protocol_version": 1,
  "server_time": 1784280000000,
  "heartbeat": {
    "interval_ms": 30000,
    "timeout_ms": 10000
  },
  "limits": {
    "max_frame_bytes": 262144,
    "max_endpoints": 20
  }
}
```

客户端必须使用服务端选择的 `protocol_version` 和返回的限制值。没有共同协议版本时，服务端使用关闭码 `1002`。

## 8. 端点目录

### 8.1 全量替换

服务端只发送完整目录快照，不发送 revision 或增量事件。

以下变化都会触发新快照：

- 端点上线或离线。
- 端点资料变化。
- 端点被撤销或恢复。

客户端收到快照后必须整体替换本地数组：

```ts
endpoints = snapshot.endpoints
```

客户端不得：

- 按事件做增量合并。
- 依赖快照之间的版本号。
- 保留新快照中已经不存在的端点。

### 8.2 directory.snapshot

```json
{
  "type": "directory.snapshot",
  "endpoints": [
    {
      "machine_id": "4f1207be-1ce0-4e88-8e3e-e92690567ec8",
      "device_name": "Yoko 的 MacBook Pro",
      "alias": "办公电脑",
      "display_name": "办公电脑",
      "platform": "macos",
      "os_version": "15.5",
      "arch": "arm64",
      "client_version": "260717.1",
      "protocol_version": 1,
      "online": true,
      "last_seen_at": 1784280000000
    }
  ]
}
```

快照规则：

- 只包含未撤销端点。
- 包含当前端点自身。
- 离线端点仍然保留在快照中。
- `display_name` 已按 `alias ?? device_name` 计算。

## 9. Agent 消息

### 9.1 通用规则

- 每帧是一个 UTF-8 JSON 对象。
- `payload` 必须是 JSON 对象。
- `message_id` 使用客户端生成的 UUIDv4。
- 业务消息只能单播，必须指定 `target`。
- `method` 由 Agent 定义。
- 客户端不能发送 `source` 或 `routed_at`。

`method` 必须匹配：

```regex
^[a-z][a-z0-9._-]{0,127}$
```

### 9.2 event

事件不要求目标返回响应：

```json
{
  "type": "event",
  "message_id": "6ccdf7ee-10c2-4926-86ce-8f9ca82aa2ca",
  "target": "dc9e38fe-c928-42b1-b8eb-e8ca41d712fe",
  "method": "agent.notice",
  "payload": {
    "content": "hello"
  }
}
```

### 9.3 request

请求要求目标 Agent 返回 `response`：

```json
{
  "type": "request",
  "message_id": "6ccdf7ee-10c2-4926-86ce-8f9ca82aa2ca",
  "target": "dc9e38fe-c928-42b1-b8eb-e8ca41d712fe",
  "method": "agent.example",
  "payload": {
    "content": "hello"
  }
}
```

### 9.4 服务端转发的消息

服务端注入可信的 `source` 和 `routed_at`：

```json
{
  "type": "request",
  "message_id": "6ccdf7ee-10c2-4926-86ce-8f9ca82aa2ca",
  "source": "4f1207be-1ce0-4e88-8e3e-e92690567ec8",
  "target": "dc9e38fe-c928-42b1-b8eb-e8ca41d712fe",
  "method": "agent.example",
  "routed_at": 1784280000000,
  "payload": {
    "content": "hello"
  }
}
```

客户端只能信任服务端转发消息中的 `source`。`routed_at` 是 Unix 毫秒时间，只用于观测，不能用于消息排序。

### 9.5 response

目标 Agent 使用新的 UUIDv4 作为响应 `message_id`，并通过 `reply_to` 引用请求：

```json
{
  "type": "response",
  "message_id": "05cc070a-be53-40b2-b09b-da77d2ea002f",
  "target": "4f1207be-1ce0-4e88-8e3e-e92690567ec8",
  "reply_to": "6ccdf7ee-10c2-4926-86ce-8f9ca82aa2ca",
  "payload": {
    "result": "ok"
  }
}
```

响应不携带 `method`。

## 10. 请求状态

桥接服务不维护请求状态。客户端必须维护：

```ts
interface PendingRequest {
  messageId: string
  target: string
  deadline: number
  resolve: (payload: Record<string, unknown>) => void
  reject: (error: Error) => void
}
```

发送请求时：

1. 生成 UUIDv4。
2. 保存 `message_id`、目标端点和截止时间。
3. 发送请求。
4. 等待 `response`、协议错误、断线或本地超时。

只有以下条件全部满足时才能完成 pending：

- `reply_to` 对应仍在等待的请求。
- `source` 等于原请求的目标端点。
- `target` 等于当前端点。
- 响应 `message_id` 是合法且未处理的 UUIDv4。
- `type` 为 `response`。

重复、迟到、来源不匹配或未知 `reply_to` 的响应必须忽略。

默认请求超时为 30 秒，调用方可以按方法覆盖。超时或连接中断时返回本地状态：

```text
outcome_unknown
```

`outcome_unknown` 表示无法判断目标是否已经执行，不能当作“未执行”处理。

## 11. 重试与去重

客户端库不得自动重试 Agent 消息。

如果 Agent 明确确认某个方法幂等，可以自行重试，并复用原 `message_id`。桥接服务可能重复投递相同消息，接收端 Agent 负责去重或返回缓存结果。

非幂等请求不得自动重试。

核心协议不定义取消消息。客户端可以停止本地等待；真正的取消操作由 Agent 定义普通方法。

## 12. 顺序保证

在双方连接均未中断期间，同一发送端点发往同一目标端点的业务消息按发送顺序到达目标发送队列。

客户端不能假设：

- 不同发送方的消息存在全局顺序。
- 断线重连后顺序连续。
- 响应顺序与请求顺序一致。
- UUIDv4 可以排序。

需要更强顺序时，Agent 在 `payload` 中自行定义 `seq`。

## 13. 协议错误

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

`reply_to` 可以为空。`retry_after_ms` 只在服务端能提供建议时出现。

| 错误码 | 客户端处理 |
|---|---|
| `invalid_message` | 修复消息结构，不自动重试 |
| `unsupported_protocol` | 提示升级客户端 |
| `unauthorized` | 停止连接并重新登录 |
| `endpoint_revoked` | 停止连接，引导恢复端点 |
| `endpoint_limit_exceeded` | 引导用户撤销旧端点 |
| `target_unavailable` | 刷新 UI，不自动重试 |
| `target_offline` | 提示目标离线 |
| `target_busy` | 提示目标繁忙 |
| `stale_route` | 等待新目录快照，不自动重试业务请求 |
| `rate_limited` | 遵守 `retry_after_ms`，但不自动重试非幂等请求 |
| `payload_too_large` | 减小 JSON 或文件分块 |
| `service_unavailable` | 进入连接退避或提示服务不可用 |

`retryable=true` 只表示稍后重试可能成功，不代表客户端可以自动重试业务请求。

协议错误携带 `reply_to` 时，客户端应结束对应 pending；业务执行结果仍只能由 Agent `response` 表达。

## 14. 帧大小与本地文件

客户端发送前应按 UTF-8 字节数检查完整 JSON 帧，不能只计算字符串字符数。

限制：

- 原始入站帧最大 256 KiB。
- 服务端注入字段后的转发帧也必须小于 256 KiB。
- 不发送 WebSocket 二进制帧。
- 不依赖 WebSocket 消息压缩。
- 单个文件最大 5 MiB。

文件始终保留在持有它的源端点本地，不上传 OSS 或桥接服务。其他端点查看文件时，文件内容通过 Agent 自定义消息传输。

核心协议不定义：

- 文件方法名。
- 请求与响应结构。
- 分块和编码方式。
- 偏移与顺序。
- 完整性校验。
- 路径权限。
- Agent 业务错误。

Agent 自定义的每条文件消息仍必须使用 JSON 对象载荷并遵守 256 KiB 单帧上限。单个文件超过 5 MiB 时必须由 Agent 拒绝，具体错误结构由 Agent 定义。

## 15. 心跳

服务端使用 WebSocket 原生 Ping/Pong：

- 每 30 秒发送 Ping。
- 10 秒内未收到 Pong 时关闭连接。

Electron、React Native 的底层 WebSocket 实现会自动回复 Pong。JS 代码：

- 不需要发送 JSON `ping`。
- 不需要构造原生 Pong。
- 不应把业务消息当作心跳。

移动应用进入后台并被系统挂起后，连接可能被服务端判定离线，这是预期行为。

## 16. 关闭码

| 关闭码 | 含义 | 客户端行为 |
|---|---|---|
| `1000` | 正常关闭 | 停止自动重连 |
| `1002` | 协议或版本不兼容 | 停止并提示升级 |
| `1008` | 鉴权或策略违规 | 停止自动重连 |
| `1009` | 消息超过 256 KiB | 停止并修复发送逻辑 |
| `1011` | 服务内部错误 | 自动退避重连 |
| `1012` | 服务重启 | 自动退避重连 |
| `1013` | 服务过载 | 自动退避重连 |
| `4001` | 被同机器标识的新连接替换 | 停止自动重连 |
| `4002` | 端点被撤销 | 停止，引导恢复 |
| `4003` | 登录会话失效 | 停止并重新登录 |

收到 `4001` 后绝不能自动重连，否则两个使用相同机器标识的客户端会互相替换，形成重连风暴。

## 17. 自动重连

仅网络中断和 `1011`、`1012`、`1013` 自动重连。

建议延迟并加入随机抖动：

```text
约 0.5s → 1s → 2s → 4s → 8s → 最大 30s
```

连续稳定在线 60 秒后重置退避计数。

重连成功后：

- 重新发送 `hello`。
- 等待新的 `welcome`。
- 使用新的 `directory.snapshot` 整体替换端点列表。
- 不自动重发断线前的 Agent 请求。
- 将断线时尚未完成的请求标记为 `outcome_unknown`。

## 18. 推荐 TypeScript 类型

```ts
type JsonObject = Record<string, unknown>

interface Hello {
  type: "hello"
  protocol_versions: number[]
  machine_id: string
  profile: {
    device_name: string
    platform: "macos" | "windows" | "linux" | "ios" | "android"
    os_version: string
    arch: string
    client_version: string
  }
}

interface Welcome {
  type: "welcome"
  protocol_version: number
  server_time: number
  heartbeat: {
    interval_ms: number
    timeout_ms: number
  }
  limits: {
    max_frame_bytes: number
    max_endpoints: number
  }
}

interface EndpointView {
  machine_id: string
  device_name: string
  alias: string | null
  display_name: string
  platform: "macos" | "windows" | "linux" | "ios" | "android"
  os_version: string
  arch: string
  client_version: string
  protocol_version: number
  online: boolean
  last_seen_at: number | null
}

interface DirectorySnapshot {
  type: "directory.snapshot"
  endpoints: EndpointView[]
}

interface OutboundEvent {
  type: "event"
  message_id: string
  target: string
  method: string
  payload: JsonObject
}

interface OutboundRequest {
  type: "request"
  message_id: string
  target: string
  method: string
  payload: JsonObject
}

interface OutboundResponse {
  type: "response"
  message_id: string
  target: string
  reply_to: string
  payload: JsonObject
}

type InboundAgentMessage =
  | (OutboundEvent & { source: string; routed_at: number })
  | (OutboundRequest & { source: string; routed_at: number })
  | (OutboundResponse & { source: string; routed_at: number })

interface ProtocolError {
  type: "error"
  reply_to?: string | null
  error: {
    code: string
    message: string
    retryable: boolean
    retry_after_ms?: number
  }
}

type InboundMessage =
  | Welcome
  | DirectorySnapshot
  | InboundAgentMessage
  | ProtocolError
```

## 19. 客户端分发顺序

收到文本帧后建议按以下顺序处理：

1. 检查帧类型必须是文本。
2. 解析 JSON。
3. 检查顶层对象和 `type`。
4. 根据连接状态限制允许的消息类型。
5. `directory.snapshot`：整体替换目录。
6. `response`：严格匹配 pending。
7. `error`：匹配 pending 或交给连接层处理。
8. `request/event`：验证 `source/target/message_id` 后交给 Agent。
9. 未知系统消息只记录不含载荷的告警。

客户端日志不得记录完整 `payload`。可以记录：

```text
source
target
message_id
type
method
payload_size
处理结果
```

## 20. 客户端验收清单

- 首次安装生成并安全保存机器标识。
- 登录后能携带 Cookie 建立 WSS。
- WebSocket 打开后 5 秒内发送 `hello`。
- 收到 `welcome` 前不发送 Agent 消息。
- 每次收到目录快照都整体替换数组。
- 发送消息前生成 UUIDv4 并检查 UTF-8 帧大小。
- 不发送 `source`、`routed_at` 或二进制帧。
- 文件保留在源端点，通过 Agent 自定义消息传输。
- 文件总大小超过 5 MiB 时拒绝传输。
- 请求默认 30 秒超时，并严格校验响应来源。
- 断线时不重发 pending 请求。
- 不自动重试非幂等消息。
- 不把 `retryable=true` 当作自动重试授权。
- 正确处理全部关闭码，尤其是 `4001`、`4002`、`4003`。
- 自动重连使用带抖动的指数退避。
- 重连后重新握手并使用全量快照替换目录。
- 不在日志中输出业务载荷。

## 21. 完整设计

服务端架构、安全边界和多副本路由设计见 [MonkeyCode 端点桥接协议](./2026-07-17-client-bridge-protocol.md)。
