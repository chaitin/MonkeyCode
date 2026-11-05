# 云电脑客户端接入接口

本仓交付后台、monkeyai-engine 和客户端调用接口。客户端页面、客户端 SDK 与交互实现由客户端工程负责。现有 runtime 工程保持不修改。

## 授权和接口

所有下列接口位于后台公开地址，使用客户端自己的 OAuth access token：`Authorization: Bearer <access_token>`。读接口申请 `environment:read`，写接口申请 `environment:manage`；现有 token 不自动扩权。连接任务、终端和文件还需申请 `device:connect` 及实际业务权限 `session:read session:control files:read files:write`，配置管理按需申请 `resources:manage`。环境管理权限不隐含设备连接权限。

| 方法与路径 | 用途 | 权限 |
| --- | --- | --- |
| `GET /api/v1/environments` | 本人环境列表 | `environment:read` |
| `POST /api/v1/environments` | 使用后台默认规格创建 | `environment:manage` |
| `GET /api/v1/environments/{id}` | 当前目标与最近观察结果 | `environment:read` |
| `GET /api/v1/environments/{id}/operations` | 操作记录 | `environment:read` |
| `POST /api/v1/environments/{id}/start` | 启动已确认停止的环境 | `environment:manage` |
| `POST /api/v1/environments/{id}/stop` | 停止，保留数据和 runtime 授权 | `environment:manage` |
| `DELETE /api/v1/environments/{id}` | 删除运行实例，保留数据，撤销 runtime 授权 | `environment:manage` |

列表使用 `page`、`page_size`，响应为 `{items,page,page_size}`，每页最多 100 条，没有 total。所有环境接口不缓存。完整字段与错误响应见 [agent.yaml](../backend/api/agent.yaml)。接口只访问认证用户自己的环境，其他用户的环境 ID 返回 404；不接受调用方指定用户、宿主路径或底层执行参数。

## 创建与重试

直接调用创建接口，不需要查询预设或额度：

```json
{"name":"项目 A","request_key":"create-project-a-1"}
```

返回 HTTP 202 和 `{environment,operation}`。镜像、架构、网络、CPU 和内存使用管理员配置的默认环境规格，创建时保存规格快照；客户端不能传 preset_id 或覆盖规格。后台按宿主最新心跳上报的完整 CPU 容量执行平滑加权轮询，例如 4 核与 8 核按 1:2 分配；离线、预检失败、能力不匹配或容量不足的宿主跳过。轮询状态与资源预留在同一事务提交，多后台实例共享且重启后保留。创建请求由后台调度；无需把宿主信息或 standalone 设备码交给用户批准。

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

## 服务端容量控制

客户端不再提供预设列表与本人额度查询接口。后台继续执行默认或个人配额、宿主容量核验；管理员在宿主管理中配置统一环境规格与配额。创建与启动时在事务内核验，不依赖客户端预先查询。

停止和删除收到当前代次确认后才释放 CPU、内存及运行数量预留；持久目录继续保留，暂不管理磁盘额度。当前无数据 purge 接口，不能提示删除环境即清理持久数据。

## 错误与恢复

| 错误 | 接入处理 |
| --- | --- |
| `401 invalid_token` | 沿现有 OAuth 流程刷新或重新登录 |
| `403 permission_denied` | 检查原客户端授权是否包含所需 scope |
| `409 idempotency_conflict` | 核对保存的请求，不用同一键提交其他参数 |
| `409 generation_conflict` | 重新查询环境与操作记录 |
| `409 quota_exceeded` | 停止不再使用的环境以释放计算额度，或联系管理员调整配额 |
| `409 configuration_unavailable` | 联系管理员配置或启用默认环境规格 |
| `409 capacity_unavailable`、`host_unavailable` | 当前宿主容量或可用性不足，不能换宿主创建空数据目录 |
| `409 environment_must_stop` | 等待当前实例停止确认后再启动 |
| `409 environment_deleted` | 环境已进入删除流程，不能恢复运行 |
| `503 runtime_unavailable` | 后台未启用环境所需的中转能力 |

停止或删除可替代尚未完成的目标，旧操作变为 superseded。失败不自动重做；先停止或删除并确认清理。删除失败可以最新代次和新键重试删除。宿主失联时保持原宿主绑定，不自动迁移或重复启动。真实宿主、兼容镜像、终端和文件的人工联调仍按统一验收清单执行。

## 当前磁盘语义

持久目录保留，但暂不实施容量、inode 配额或磁盘镜像管理。预设的 `storage` 与卷的 `bytes`／`inodes` 保留为旧协议兼容字段，可省略；后台新建规格将其归零，不用于硬限制。`storage_bytes` 不参与用户额度或宿主调度判断。客户端不应展示磁盘额度。删除后的目录仍保留，但不计算磁盘额度占用。

新增迁移 `000039_environment_directory_storage` 允许普通目录预设的存储字段为零。升级时先应用迁移再更新后台和 engine；旧 engine 不支持省略磁盘限额的规格，应在恢复调度前更新。若存在零容量的新预设，迁移回滚会拒绝执行，避免伪造磁盘限额。

## 管理端快速配置

在「云环境 → 宿主管理 → 配置环境」统一配置共享环境预设与默认用户配额；宿主容量自动使用最新心跳上报的 CPU 和内存总量，在列表中通过“开启”开关控制是否接收新环境。已有个人配额继续优先；共享预设更新生成新版本、停用旧共享预设，既有环境保留创建时规格。保存配置本身不会创建环境，客户端直接调用创建接口，使用后台当前默认规格。宿主在线、预检通过且容量充足后才能调度。

管理端 `GET/PUT /api/admin/v1/environment-hosts/{id}/setup` 读取／原子保存配置；PUT 携带 GET 返回的 revision。并发修改返回 409，需重新加载；相同内容的请求重试不会重复创建预设。

## 发布要求

更新后台时应用幂等迁移 `000042_environment_scheduling`，保存宿主的加权轮询状态。已创建环境保留原规格和宿主绑定，重试旧创建记录仍能返回原结果；首次创建需要已配置并启用默认环境规格。本次接口与调度变更无需更新 engine 或 runtime。
