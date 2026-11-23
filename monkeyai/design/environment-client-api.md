# 云电脑客户端接入接口

本仓交付后台、monkeyai-engine 和客户端调用接口。客户端页面、客户端 SDK 与交互实现由客户端工程负责。现有 runtime 工程保持不修改。

## 授权和接口

所有下列接口位于后台公开地址，使用客户端自己的 OAuth access token：`Authorization: Bearer <access_token>`。读接口申请 `environment:read`，写接口申请 `environment:manage`；现有 token 不自动扩权。连接任务、终端和文件还需申请 `device:connect` 及实际业务权限 `session:read session:control files:read files:write`，配置管理按需申请 `resources:manage`。环境管理权限不隐含设备连接权限。

| 方法与路径 | 用途 | 权限 |
| --- | --- | --- |
| `GET /api/v1/environments` | 本人环境列表 | `environment:read` |
| `GET /api/v1/environment-specifications` | 全局可选规格与版本，不分页 | `environment:read` |
| `GET /api/v1/system-images` | 已就绪且未下架的系统镜像 | `environment:read` |
| `GET /api/v1/environment-hosts` | 本人已授权宿主目录 | `environment:read` |
| `POST /api/v1/environments` | 按所选全局规格创建 | `environment:manage` |
| `GET /api/v1/environments/{id}` | 当前目标与最近观察结果 | `environment:read` |
| `GET /api/v1/environments/{id}/operations` | 操作记录 | `environment:read` |
| `POST /api/v1/environments/{id}/start` | 启动已确认停止的环境，新版宿主复用原容器 | `environment:manage` |
| `POST /api/v1/environments/{id}/stop` | 停止，保留数据和 runtime 授权 | `environment:manage` |
| `GET /api/v1/environments/{id}/runtime` | 当前／最新 runtime 版本与更新能力 | `environment:read` |
| `POST /api/v1/environments/{id}/runtime/upgrade` | 停止后更新独立 runtime，保留原容器与身份 | `environment:manage` |
| `DELETE /api/v1/environments/{id}` | 删除运行实例，保留数据，撤销 runtime 授权 | `environment:manage` |

列表使用 `page`、`page_size`，响应为 `{items,page,page_size}`，每页最多 100 条，没有 total。所有环境接口不缓存。完整字段与错误响应见 [agent.yaml](../backend/api/agent.yaml)。接口只访问认证用户自己的环境，其他用户的环境 ID 返回 404；不接受调用方指定用户、宿主路径或底层执行参数。

## 创建与重试

先调用 `GET /api/v1/environment-specifications` 获取完整规格目录。接口需要 `environment:read`，不分页、不缓存：

```json
{
  "revision": 3,
  "items": [
    {"id":"11111111-1111-4111-8111-111111111111","version":2,"cpu_millis":2000,"memory_bytes":4294967296}
  ]
}
```

示例 ID 仅用于说明；实际请求必须使用接口返回的 ID 和版本。CPU 以毫核计（1000 为 1 核），内存以整数字节计；管理端显示 GB，按 1024³ 字节换算。空列表表示管理员尚未配置或已清空规格，应禁用新建入口并提示联系管理员，不能自动选取宿主旧规格或内置默认值。

用户选择后调用 `POST /api/v1/environments`：

创建弹窗同时读取系统镜像列表，按 display_name 展示、按 id 提交，优先选择 is_default=true；无默认且只有一项时自动选择，多项时由用户选择，空列表禁用新建。示例中的 image_id 须替换为接口返回的真实 ID。旧客户端省略 image_id 时沿用服务端默认镜像。固定宿主架构不匹配或镜像被移除时，不静默改用默认值。镜像选择参与幂等校验；重选需更换 request_key。

```json
{
  "name": "项目 A",
  "image_id": "85e8e030-e0d3-4e1a-b294-0ff3f690d81e",
  "specification_id": "11111111-1111-4111-8111-111111111111",
  "specification_version": 2,
  "request_key": "create-project-a-1"
}
```

返回 HTTP 202 和 `{environment,operation}`。可选 `host_id` 用于固定已授权宿主；不允许提交 CPU、内存、镜像或其他底层参数。服务端在创建事务中校验规格是否存在、是否删除以及版本是否一致，以该规格的 CPU／内存核验余额和计算费用。缺少有效规格返回 `400 invalid_request`；旧客户端必须接入选择规格的新流程，服务端不会静默选择第一项。

镜像取自 server 已准备的发行／导入清单，按架构匹配并固定摘要，网络固定公网出站。服务端只在已授权且配置就绪的宿主中比较现有环境数，选择数量较少者。CPU／内存允许超卖，不按物理剩余资源拒绝创建；宿主旧 resource 不再影响可用性。离线、预检失败、镜像／runtime 未准备时跳过对应宿主。规格校验、宿主选择、环境创建、首小时预扣和操作幂等受同一事务锁保护，支持多后台实例共享。

创建时保存实际资源、镜像摘要和 runtime 版本快照；CPU／内存存于环境记录，隐藏资源参数保存在执行配置中。管理员后续编辑或删除全局规格不会修改已有实例、其计费资源或再次启动使用的资源。重启仍需满足原宿主在线、授权、状态与余额等条件，不会重新读取当前规格。

创建请求发送前保存 request_key；丢失响应或请求超时后使用完全相同的键和参数重试。键按用户隔离，相同请求返回同一环境与操作，同键不同参数返回 `409 idempotency_conflict`。幂等参数包含规格 ID、规格版本和宿主选择。已成功请求即使规格后来修改或删除，原键与原参数重试仍返回原结果，不重复创建或扣款。遇到 specification_changed 或 specification_unavailable 时刷新列表，让用户重新选择，不擅自用新规格继续；重新选择后以新幂等键提交。保留原请求直到获得确定结果。202 只表示目标已受理。

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

ticket 有效期 15 分钟；按响应 expires_in 提前串行续期，携带原 connection_id，权限只能收窄。停止、删除、撤销或离线可使访问提前失效，不能依赖票据尚未到期继续访问。访问失败后重新查询环境；重新启动沿用 machine_id；支持 environment_protocol=2 的宿主保留同一容器和 instance_id，操作 generation 继续推进，runtime 服务重新启动并核对身份。旧协议宿主保留原重建行为。连接凭据须重新申请。ticket 只保存在内存，不记录到日志或长期保存。

## 宿主选择与授权范围

`GET /api/v1/environment-hosts`需要environment:read，返回当前用户已获授权且已配置的宿主目录，授权过滤先于分页。字段包括id、name、architecture、全局billing、available和可选reason，不再返回resource，不包含宿主私有报告或网络地址。available不承诺最终准入／余额，创建时仍以事务核验结果为准。

创建可增加可选host_id，明确使用某个已授权宿主。省略则保持自动调度；规格来自全局目录，不限制宿主或用户环境数量，价格来自全局费用设置；同一幂等键改变host_id会冲突。用户不能指定任意资源或镜像覆盖。用户、分组及全员范围与项目现有授权一致，分组覆盖下级。

撤回授权只禁止新的创建与再次启动，不打断既有运行或连接。Owner仍可查询、停止和删除自己的环境，停止后必须重新获该宿主授权才能启动。身份停用／删除或宿主身份撤销仍按原安全策略处理，不与宿主可用范围撤回混同。

## 服务端容量控制

客户端使用新的全局规格目录；旧预设与本人独立额度查询接口不恢复。后台不限制宿主或用户环境数量，不限制CPU／内存分配总和或同时运行数。环境数量仅用于监控与自动调度负载均衡。状态、授权和余额等检查继续执行。

持久目录继续保留，暂不管理磁盘额度。当前无数据purge接口，不能提示删除环境即清理持久数据。

## 错误与恢复

| 错误 | 接入处理 |
| --- | --- |
| `401 invalid_token` | 沿现有 OAuth 流程刷新或重新登录 |
| `403 permission_denied` | 检查原客户端授权是否包含所需 scope |
| `403 host_access_denied` | 未获选定宿主的新建／启动授权，联系管理员调整范围；已有运行不因此中断 |
| `402 insufficient_credits` | 积分不足以预付一小时，不能创建或启动收费环境；停止、删除及历史查询仍允许 |
| `400 invalid_request` | 缺少合法规格 ID／版本、字段无效或提交了任意资源覆盖 |
| `409 specification_changed` | 所选规格已修改；刷新列表，让用户重新选择并以新键提交 |
| `409 specification_unavailable` | 所选规格已删除或不存在；刷新列表，不自动替换规格 |
| `409 idempotency_conflict` | 核对保存的请求，不用同一键提交其他参数 |
| `409 generation_conflict` | 重新查询环境与操作记录 |
| `409 configuration_unavailable` | 联系管理员检查默认镜像／runtime 是否准备就绪 |
| `409 capacity_unavailable`、`host_unavailable` | 当前宿主容量或可用性不足，不能换宿主创建空数据目录 |
| `409 environment_must_stop` | 等待当前实例停止确认后再启动 |
| `409 environment_deleted` | 环境已进入删除流程，不能恢复运行 |
| `503 runtime_unavailable` | 后台未启用环境所需的中转能力 |

停止或删除可替代尚未完成的目标，旧操作变为 superseded。失败不自动重做；先停止或删除并确认清理。删除失败可以最新代次和新键重试删除。宿主离线且已有待执行的删除请求时，后台自动将环境从使用列表移除，无需再次提交。管理端可在“已删除”筛选中通过 archived_at 区分仍待清理的记录。原操作保持 pending，宿主重连后继续执行；成功后写入 deleted_at，失败则重新显示，允许重试。宿主失联时保持原宿主绑定，不自动迁移或重复启动。真实宿主、兼容镜像、终端和文件的人工联调仍按统一验收清单执行。

## 环境计费查询

本仓不实现客户端页面或通知。云电脑按全局单价计费，不受系统计费开关控制，零单价不扣积分；CPU 默认每核每小时100积分，内存默认每GB每小时50积分（GB=1024³字节）。管理员可在全局费用设置调整单价，按实例快照中的 CPU／内存整小时预付，启动前扣一小时、到期续扣。提前停止不退款，同一环境在已付费小时内重启不重复扣费；调价从下一次续费生效。存储暂不收费，模型与工具另计；当前仅支持本地积分。

客户端本人列表／详情可返回 `billing`：`state`、`hourly_credits`、`settled_credits`、`settled_seconds` 及可选 `prepaid_until`、`stop_reason`、`budget`。管理端列表／详情不再附带此计费扩展。创建／操作响应可不含此扩展，需再次查询。积分为最多六位小数的十进制字符串，不能用浮点数推导实际扣款。

- `state`为 free／waiting／running／stopped／unknown。free 表示 CPU 和内存单价均为零，不清除历史账务。这些值表示计费状态，不替代环境phase／generation或connectable。
- `hourly_credits`是当前配置下该环境实际规格的每小时价格；已停止时仅为再次运行的价格参考，不表示仍在扣费。累计已结算时长和积分来自持久账务。
- `budget` 按同一用户全部仍在运行目标且处于已付费小时内的环境汇总，不受当前分页或宿主筛选限制。包含账户余额、合计小时费率、环境数、距离最近付费到期的秒数和 `low_balance`；余额不足以给这些环境续付一小时即标记低余额，无有效付费小时则剩余时间为 null。
- `billing_stop_reason=insufficient_credits` 表示余额不足以续付下一小时而发起停止，尚需看代次和实际 phase 判断是否已停；持久数据保留。新增预付不能透支，已付费小时不因其他消费而被撤销。billing_unavailable 表示服务端因计费不可用发起停止。
- 既有按秒历史记录只结算已确认部分，不重算断线空档。已购买小时不因提前停止、失败或失联而退款；不能把失败或失联当作已确认停止或删除。状态查询不代表已向用户送达通知。

## 当前磁盘语义

持久目录保留，但不实施容量、inode 配额或磁盘镜像管理。卷规格中的bytes／inodes为0，不用于硬限制；数据库与额度接口不保存磁盘额度字段。删除后的目录仍按环境数据保留策略处理。

数据库模型按未上线的新系统定义，不提供旧预设或存储额度结构的兼容回填。

## 管理端快速配置

在「云电脑 → 宿主机 → 管理规格」配置全局 CPU／内存组合。弹窗从服务端加载，提交成功后持久保存；网络失败保留草稿，版本冲突时提示重新加载，不自动覆盖他人修改。在宿主「配置环境」中仅保存授权范围，CPU／内存配置已移除。全局价格在「费用设置」维护，镜像由 server 按架构准备。

管理端 `GET/PUT /api/admin/v1/environment-specifications` 读取／原子替换完整目录：

```json
{
  "revision": 3,
  "items": [
    {"id":"11111111-1111-4111-8111-111111111111","version":2,"cpu_millis":4000,"memory_bytes":8589934592},
    {"id":"22222222-2222-4222-8222-222222222222","version":0,"cpu_millis":2000,"memory_bytes":4294967296}
  ]
}
```

`revision` 是读取时的整表版本；新增项使用新的小写 UUID 和 `version:0`，已有项保留其 ID／当前版本。每次成功保存递增 revision；修改 CPU／内存递增条目 version，仅重排不变。省略已有项表示软删除；删除后的 ID 不可复用。最多 100 项，禁止重复 ID 或重复 CPU／内存组合，CPU 范围 100–256000 毫核，内存范围 268435456–1099511627776 字节。列表允许为空，不接受缺失或 null。冲突返回 `409 specifications_conflict`，整次事务回滚，必须重新加载后再编辑。

隐藏执行限制由服务端生成：host_tasks=1024，temporary_bytes 为 min(512 MiB, 内存一半向下按 4096 字节对齐)。它们随环境资源快照保存，不接受客户端自定义。

宿主 `GET/PUT /api/admin/v1/environment-hosts/{id}/setup` 保存 `{grants}`。不再接受或返回 resource；响应 billing 仅供读取，全局价格不能在此写入。宿主配置仍为最后有效提交覆盖；省略 grants 保留原授权。不设置数量上限，不删除或停止已有环境。个人配额接口已移除，宿主目录不再返回 quota。迁移50删除个人配额表及默认每用户数量字段；迁移51删除 hosts.max_environments，既有环境不受影响。

统一40直接创建八表：hosts、host_environment_configs、host_upgrades、environments、environment_runtimes、environment_operations、environment_quotas、environment_billing_periods；1～39不改。迁移51后的hosts含创建者user_id、enabled和首次activated_at，配置、升级历史与runtime独立存储。环境spec不重复存ID／实例／代次／目标／CPU／内存，按列组装下发；创建幂等放在operations，价格按内容快照判断变化。删除environment_defaults和compute_reserved，控制使用按schema区分的事务级advisory lock。重放保持配置、授权和账务，开放或已收费时段、财务历史、待完成宿主／runtime更新及未确认删除环境阻止回退。旧开发数据库不能靠up、force或重放补齐差异，需要独立的数据保留迁移方案。

宿主接入使用服务端签名短期凭证，host创建者取当前登录用户；重发撤销原待接入记录并产生新ID。心跳／交换用v2签名及/time取得的服务端时间，严格推进业务报告时间；重复或旧报告被拒绝，不能延长计费区间。不新增认证表或JSON状态，原宿主私钥及已运行环境保持。

默认镜像由installer一次性导入后持久保存在data/environment-images的Registry目录及元数据中，backend重启不依赖OCI输入。新环境镜像名示例为`server.example/environments/monkeyai-environment:runtime-26.1105.2-v26110501`，不使用hash路径或@sha256展示；内部摘要独立固定，旧摘要仓库及已有环境快照继续兼容。

环境列表和详情显示宿主最近实际上报的`runtime_version`，未知显示“未确认”，不从镜像名称、预设或server最新发行推断。

## 管理端宿主环境数与下钻

宿主列表 `GET /api/admin/v1/engine-hosts` 每项返回 `environment_count`，统计该宿主尚未确认删除的环境，包含停止、失败及删除中的环境；已撤销或离线的宿主仍按服务端记录计数。计数与默认 `status=active` 的环境列表一致，不从宿主心跳估算。

点击宿主的环境数进入 `/admin/environments/instances?host_id=<uuid>&host_name=<name>`。管理端环境列表支持可选 `host_id`，按宿主筛选后再执行状态筛选、资源排序和分页；不存在的宿主返回空列表，无效或重复的UUID返回400。页面显示当前宿主，可清除该筛选，且刷新、排序、分页及详情操作保留宿主条件。客户端本人环境接口的权限和范围保持原有约束。

## 独立 runtime 更新

先查询 `GET /api/v1/environments/{id}/runtime`，读取 `current_version`、`latest_version`、`update_available`、`can_update`、`reason` 与可选的 `operation`。当前版本来自宿主报告，未知为空；资源未准备或宿主不支持时不会声称可更新。

第一版要求环境已停止且宿主确认当前代次。客户端按「停止 → 等待确认 → 更新 → 等待结果 → 启动」调用，不会后台终止运行中的任务。更新请求示例：

```json
{"generation":2,"request_key":"runtime-update-project-a-1"}
```

省略 version 时锁定 server 当前配置的最新版本；显式 `version` 只能选择 server 已有发行版本，可用于停止后的回退。客户端不能传下载地址。返回 202 和既有 `{environment,operation}`，`operation.kind=runtime_upgrade`、`target_version` 标明固定目标。按新的 generation 轮询 runtime 或操作记录，直到 succeeded/failed；HTTP 超时保持同一键和参数重试。

更新不重建容器，不改变项目文件、系统可写层或 runtime 设备身份。引擎校验文件 SHA-256、长度、ELF 架构和匹配的 ohmyagent 后原子切换独立版本目录；下载失败保留旧版本，失败后以当前代次和新键重试。普通停止可替代待更新目标，已安装版本仍保留。成功后再显式启动环境。

错误包括 `environment_must_stop`、`runtime_update_unsupported`、`runtime_update_unavailable`、`runtime_already_current`、`runtime_downgrade_requires_version`，以及既有幂等／代次冲突。运行状态为 failed 且 reason=runtime_upgrade_failed 表示更新失败，不代表项目目录或容器被删除。

## Docker 持久化与 server 镜像

新宿主报告 environment_protocol=2 时，停止只 stop 容器，后续启动复用原实例；新容器根文件系统可写，但仍以 UID 1000、无 capabilities 和 no-new-privileges 运行。已有只读容器保持其配置。删除才 rm 容器，系统可写层会删除，三个持久目录按原策略保留；`storage_retained=true` 只表示持久目录仍在，不表示已删除容器的系统层仍保留。`/tmp`、`/run` 和进程内存不持久化。

server 准备完整的双架构镜像，宿主仅从 server 的标准只读 Registry 拉取固定摘要，本地已有即复用。管理员可用 `POST /api/admin/v1/environment-images/sync` 同步来源、`GET /api/admin/v1/environment-images` 查询状态。来源未就绪时创建失败，不让宿主临时回源公网。镜像更新只影响新建／显式重建的环境，正常启停不会替换已有系统。

## 全局规格发布与迁移

部署顺序：先应用 `000049_environment_specifications`，再部署后端与管理端，最后让客户端按新接口选择规格。此变更不修改客户端应用代码。

迁移新增独立规格表与目录版本表，初始目录包含 1 核 2 GB 规格，不会把历史宿主 CPU／内存组合自动公开为全局可选规格。历史宿主 resource 列暂留以保留原数据，但新配置、宿主目录与调度不再使用它；已有环境资源及账务数据不迁移、不重写。管理员删除默认规格后不会自动补回。

新建请求必须携带规格 ID 与版本，旧客户端无规格的新建将返回400；历史已成功创建请求的原参数重放仍走原幂等记录。旧环境的启动、停止、删除不要求存在对应全局规格。回滚迁移会删除规格目录，不能在仍运行新版服务时执行；旧版按宿主预设创建的逻辑也无法自动理解新版宿主配置，回滚前需单独评估。

## 运行时发布要求

本轮需迁移 `000040_cloud_environments`、新版 engine 与配套 server 安装器。server 打包自动从官方 x64／arm64 的 release.json 固定同版本及修订，在线安装缓存官方原始程序，离线包携带相同原始文件；不再单独构建或二次发布 runtime。先更新 server 并准备镜像／runtime 文件，再升级宿主至 runtime_update_protocol=2。宿主在本架构无网络、无用户数据挂载的临时 gVisor 容器中校验内嵌信息，复用匹配的 OhMyAgent，缺失时自动释放；用户容器保持停止及原 ID，准备失败不切换原版本。旧四文件资源包及协议1仍兼容。宿主接入、调度、监控和 runtime 更新结构统一归入40；主线39直接升级到40。本PR未上线，不兼容旧11表开发结构；旧测试数据库须先备份并重建云环境结构，不能只修改版本号或force，详见[迁移说明](../backend/migrations/README.md)。
