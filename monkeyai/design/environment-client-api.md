# 云电脑客户端接入接口

本仓交付后台、monkeyai-engine 和客户端调用接口。客户端页面、客户端 SDK 与交互实现由客户端工程负责。现有 runtime 工程保持不修改。

## 授权和接口

所有下列接口位于后台公开地址，使用客户端自己的 OAuth access token：`Authorization: Bearer <access_token>`。读接口申请 `environment:read`，写接口申请 `environment:manage`；现有 token 不自动扩权。连接任务、终端和文件还需申请 `device:connect` 及实际业务权限 `session:read session:control files:read files:write`，配置管理按需申请 `resources:manage`。环境管理权限不隐含设备连接权限。

| 方法与路径 | 用途 | 权限 |
| --- | --- | --- |
| `GET /api/v1/environment-presets` | 启用预设及固定资源规格 | `environment:read` |
| `GET /api/v1/environment-quota` | 本人额度、预留占用和剩余额度 | `environment:read` |
| `GET /api/v1/environments` | 本人环境列表 | `environment:read` |
| `POST /api/v1/environments` | 从预设创建 | `environment:manage` |
| `GET /api/v1/environments/{id}` | 当前目标与最近观察结果 | `environment:read` |
| `GET /api/v1/environments/{id}/operations` | 操作记录 | `environment:read` |
| `POST /api/v1/environments/{id}/start` | 启动已确认停止的环境 | `environment:manage` |
| `POST /api/v1/environments/{id}/stop` | 停止，保留数据和 runtime 授权 | `environment:manage` |
| `DELETE /api/v1/environments/{id}` | 删除运行实例，保留数据，撤销 runtime 授权 | `environment:manage` |

列表使用 `page`、`page_size`，响应为 `{items,page,page_size}`，每页最多 100 条，没有 total。所有环境接口不缓存。完整字段与错误响应见 [agent.yaml](../backend/api/agent.yaml)。接口只访问认证用户自己的环境，其他用户的环境 ID 返回 404；不接受调用方指定用户、宿主路径或底层执行参数。

## 创建与重试

读取启用预设和额度后，调用创建接口：

```json
{"preset_id":"预设 UUID","name":"项目 A","request_key":"create-project-a-1"}
```

返回 HTTP 202 和 `{environment,operation}`。镜像、架构、网络、CPU、内存和持久卷大小均来自管理员预设快照，客户端不能覆盖。创建请求由后台调度；无需把宿主信息或 standalone 设备码交给用户批准。

创建请求发送前保存 request_key；丢失响应或请求超时后使用完全相同的键和参数重试。键按用户隔离，相同请求返回同一环境与操作，同键不同参数返回 `409 idempotency_conflict`。保留该键直到获得确定结果。202 只表示目标已受理。

启停和删除的 JSON 请求体为：

```json
{"generation":1,"request_key":"stop-project-a-1"}
```

generation 使用最近读取的环境目标代次。新的主动操作使用新键；网络重试保持原键、原代次与原参数。成功修改后 generation 加一。`generation_conflict` 表示其他操作已经推进目标，应重新查询后决定下一步。DELETE 同样需要请求体。

## 等待状态与连接

轮询 `GET /api/v1/environments/{id}`，建议间隔约 3 秒，网络错误时退避。读取失败不视为环境已停止或已删除。

| 字段 | 判断依据 |
| --- | --- |
| `desired`、`generation` | 后台当前目标与目标代次 |
| `phase`、`observed_generation` | 最近宿主报告；只有代次相等才对应当前目标 |
| `stale` | 最近报告缺失或超过 90 秒 |
| `machine_id` | 持久 runtime 设备身份，绑定前为 null |
| `runtime_ready`、`connectable` | 当前实例身份核对、当前代次运行观察和中转双通道均就绪 |
| `compute_reserved` | 计算额度是否仍被占用 |
| `storage_retained` | 数据仍保留，当前固定为 true |

`phase=running` 只代表容器进程运行。连接必须等到 `connectable=true` 且 machine_id 非空；历史创建操作的 `succeeded` 不保证环境现在仍可连接。`workload_verified=false` 表示真实宿主隔离验收仍未完成，与在线状态分开处理。

连接使用现有 `POST /api/v1/endpoints/{machine_id}/connections`，请求示例：

```json
{
  "scopes":["session:read","session:control","files:read","files:write"],
  "supported_protocols":{"acp":[1],"runtime_api":[1]}
}
```

使用返回的 `http_base`、ticket 和协商协议访问任务与文件代理，不自行拼接宿主地址。HTTP 代理使用 ticket Bearer；ACP WebSocket 使用 `monkeyai.v1`、`monkeyai.token.<ticket>`；终端 WebSocket 使用 `monkeyai.terminal.v1`、`monkeyai.token.<ticket>`。终端路径为 `/api/v1/endpoints/{machine_id}/proxy/terminal`，要求 `session:control`。远程终端与会话的业务协议保持现有约定，详见 [远程执行协议](remote-runtime-protocol.md)、[终端契约](remote-terminal-backend.md)。

ticket 有效期 15 分钟；按响应 expires_in 提前串行续期，携带原 connection_id，权限只能收窄。停止、删除、撤销或离线可使访问提前失效，不能依赖票据尚未到期继续访问。访问失败后重新查询环境；重新启动沿用 machine_id，但新实例重新核对身份，连接凭据须重新申请。ticket 只保存在内存，不记录到日志或长期保存。

## 额度语义

`GET /api/v1/environment-quota` 返回相同结构的 limits、usage、remaining：

```json
{
  "limits":{"environments":3,"running":2,"cpu_millis":8000,"memory_bytes":17179869184,"storage_bytes":107374182400},
  "usage":{"environments":1,"running":1,"cpu_millis":2000,"memory_bytes":4294967296,"storage_bytes":34359738368},
  "remaining":{"environments":2,"running":1,"cpu_millis":6000,"memory_bytes":12884901888,"storage_bytes":73014444032}
}
```

limits 使用管理员覆盖值或系统默认值；usage 表示预留，不是实时使用率。environments 统计尚未进入删除流程的环境；running 包含尚未回收的创建中、停止中和失败实例。停止与删除收到当前代次确认后才释放 CPU、内存及 running；已删除环境保留的目录继续占用存储。remaining 各项为 `max(0, limits-usage)`。接口使用同一数据库快照，不支持指定其他用户。

查询额度不预留资源，也不返回宿主可用容量；最终创建和启动仍以后台事务核验为准。当前无数据 purge 接口，不能提示删除环境即释放磁盘额度。

## 错误与恢复

| 错误 | 接入处理 |
| --- | --- |
| `401 invalid_token` | 沿现有 OAuth 流程刷新或重新登录 |
| `403 permission_denied` | 检查原客户端授权是否包含所需 scope |
| `409 idempotency_conflict` | 核对保存的请求，不用同一键提交其他参数 |
| `409 generation_conflict` | 重新查询环境与操作记录 |
| `409 quota_exceeded` | 查询本人额度，停止环境可释放计算；保留目录仍占存储 |
| `409 capacity_unavailable`、`host_unavailable` | 当前宿主容量或可用性不足，不能换宿主创建空数据目录 |
| `409 environment_must_stop` | 等待当前实例停止确认后再启动 |
| `409 environment_deleted` | 环境已进入删除流程，不能恢复运行 |
| `503 runtime_unavailable` | 后台未启用环境所需的中转能力 |

停止或删除可替代尚未完成的目标，旧操作变为 superseded。失败不自动重做；先停止或删除并确认清理。删除失败可以最新代次和新键重试删除。宿主失联时保持原宿主绑定，不自动迁移或重复启动。真实宿主、兼容镜像、终端和文件的人工联调仍按统一验收清单执行。
