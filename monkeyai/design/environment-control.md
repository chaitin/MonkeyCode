# 环境控制链路

本轮实现后台 → monkeyai-engine → containerd/gVisor 的目标同步与执行。客户端通过 API 选择全局规格创建环境，客户端页面由客户端工程实现，本仓仅交付接口；standalone 接入见 [运行时编排](../engine/RUNTIME.md)。`running` 表示容器进程运行，不能据此展示“可连接”。网络支持无外网的 `isolated` 和显式配置的 `public-only`；公网调度要求宿主报告网络能力，详见 [网络说明](../engine/NETWORK.md)。不支持容器内 Docker／Compose。

## 管理页面

- 云电脑管理：分页列表、详情与操作记录、停止和删除；删除失败支持重试。
- 宿主管理：生成安装命令、查看预检、配置授权范围、设置新建调度开关与撤销身份。
- 全局「管理规格」：编辑所有宿主通用的 CPU／内存可选列表，支持新增、修改、删除与整表版本冲突保护。
- 费用设置：统一配置 CPU／内存小时单价；宿主不再分别保存资源规格或价格。

客户端以自己的授权发起创建；后台仅提供全局观察与停止／删除管理。页面不把容器 running 状态等同于可连接。

## 接入顺序

1. 备份数据库并停止旧后端，应用至迁移 `000050_remove_environment_host_limit`，再部署配套后端和管理端。迁移新增全局规格表并删除旧个人配额及宿主数量上限结构，不重写已有环境。
2. 准备服务端镜像与 runtime，在 Linux 宿主安装并启动 engine。宿主无需开放入站控制端口，具体步骤见 [INSTALL.md](../engine/INSTALL.md)。
3. 在宿主配置保存授权范围，启用新建调度。CPU／内存容量来自硬件报告，仅供展示，不用于禁止超卖。
4. 在全局「管理规格」保存允许用户创建的 CPU／内存组合。初始提供 1 核 2 GB 规格，历史宿主资源不自动发布；没有规格时不能新建。
5. 客户端 OAuth 授权申请 `environment:read environment:manage`，读取目录、让用户选规格后提交创建。原 token 不自动获得这些权限，runtime 的固定 scope 集合不接受它们。
6. 保存 environment.id 与 operation.id，轮询时检查 generation、observed_generation、desired 和 phase。只有目标代次与观察代次一致才算收敛，可连接性另查 connectable。

## 管理接口

宿主调度 `PUT /api/admin/v1/environment-hosts/{host_id}`：

```json
{"enabled":true}
```

宿主设置 `PUT /api/admin/v1/environment-hosts/{host_id}/setup`：

```json
{"grants":[]}
```

grants 为空表示不允许任何用户新建或再次启动；省略则保留原范围。不设置宿主或用户环境数量上限，已有环境不受影响。

全局规格使用 `GET/PUT /api/admin/v1/environment-specifications`。GET 返回 `{revision,items}`，PUT 提交读取时的 revision 和完整 items。新增项传新 UUID、version=0、cpu_millis 和 memory_bytes；已有项携带原 ID 与当前 version。删除通过省略该项完成，删除后的 ID 不可复用。最多 100 项，不允许重复资源组合。空数组关闭新建，null 或缺失列表无效。

整表 revision 防止管理员相互覆盖；CPU／内存修改推进条目 version，重排不改变条目版本。更新目录和新建环境使用同一事务锁，避免新建读到部分修改。修改和删除均不重写旧实例快照。完整参数和错误见 [客户端接口](environment-client-api.md)。

## 创建与生命周期

客户端先调用 `GET /api/v1/environment-specifications`，再调用 `POST /api/v1/environments`。以下 ID 仅为示例，必须替换为目录中实际返回的 ID：

```json
{"name":"项目 A","specification_id":"11111111-1111-4111-8111-111111111111","specification_version":1,"request_key":"create-project-a-1"}
```

可选 host_id 固定已授权宿主。客户端不能传任意资源、镜像、宿主路径或命令。缺少规格返回400，删除／不存在返回 specification_unavailable，版本变化返回 specification_changed。客户端需刷新目录并让用户重新选择，不静默切换规格。

返回 HTTP 202 和 `{environment,operation}`。幂等键按用户唯一，绑定名称、所选规格及其版本和宿主选择；相同键与原参数重试返回同一结果，即使规格后来改变或删除。不同参数返回 idempotency_conflict，不重复调度或扣款。

启停与删除仍使用当前 generation 和 request_key：

```json
{"generation":1,"request_key":"stop-project-a-1"}
```

网络重试保持原键、原代次和原参数；新的主动操作使用新键与最新代次。停止、删除可以替代未完成目标。删除失败可继续发起新代次删除，但不能复活已进入删除流程的环境。

## 调度、快照与计费

调度筛选已授权、启用新建、在线且预检、协议、网络、默认镜像／runtime 满足要求的宿主；优先选择现有环境数最少者。心跳与同步须在 90 秒内。不限制宿主或用户环境数量，不以物理 CPU／内存余量准入，允许资源超卖。宿主旧 resource 不再参与候选筛选。

个人配额管理接口及宿主数量上限已移除。环境数量仅用于监控与自动调度负载均衡；已有实例再次启动仍检查授权、宿主状态和余额。

环境保存所选 CPU／内存及隐藏执行限制的快照。host_tasks=1024，temporary_bytes 为 min(512 MiB, 内存一半向下按4096字节对齐)。镜像固定摘要并按架构选择。重启从实例快照恢复，不查询全局规格，删除或修改规格不会改变已有环境的资源及计费资源。

收费使用全局单价和实例实际资源，启动前预扣一小时，到期续扣；余额不足停止，数据保留。提前停止不退款，已付费小时内重启不重复收费。调价仅影响下一次购买小时，规格目录编辑不影响旧实例资源。

实例绑定原宿主，不自动迁移。持久容器重启复用原 instance_id 与三卷；原宿主不可用时不能通过新建空目录替代。停用新建调度仅阻止新建，不停止已有实例；撤回宿主授权会阻止再次启动，但不打断既有运行。

## 同步与恢复

`POST /api/host/v1/exchange` 使用已登记 Ed25519 公钥验证签名，签名绑定后台地址、宿主、用途、一次性 challenge 与原始 payload 摘要。挑战与心跳共用，engine 按顺序请求。完整字段见 [host.yaml](../backend/api/host.yaml)。

每轮最多提交 16 个结果、获取 16 个目标。目标按环境 ID 使用 cursor 分页，一轮结束返回空 cursor；只有确认完成删除的环境才停止下发。后台在同一事务内处理结果和目标，跨宿主报告拒绝，旧代次结果确认后忽略，当前代次结果必须与 desired 一致或为 failed。签名挑战消费后同步失败需重新取挑战，执行结果保留到 acknowledged 返回。

engine 在 `/var/lib/monkeyai-engine/control/commands` 保存每环境目标和结果，目录权限 0700，文件 0600。先落盘再执行，结果落盘后上报；后台暂时不可达时重传。每宿主同时执行一个异步任务；新代次取消旧任务，等待结束后处理新目标。运行实例约每 30 秒检查；检查失败或退出记录 failed，不自动重启。旧代次不能覆盖已保存新代次，同代次修改规格拒绝。日志上限 10000 条，删除墓碑尚不自动回收。

engine 停止或失去认证后不再执行新命令，已有容器不会因此自动停止。正常撤销宿主应先停止所有环境并确认；离线的强制停止需要宿主或基础设施运维手段。本轮没有失联租约强制终止能力。

## 当前边界及验收

- 宿主执行支持 gVisor，Firecracker 留在执行驱动边界；Kubernetes 后续作为后台供应实现接入。
- 已有宿主安装管理、全局规格、授权和环境管理页面。后台不代替用户创建或启动环境，用户创建仍由客户端 API 发起。
- 已接入 public-only、standalone 自动授权与运行启动，以及中转可连接状态；客户端页面不属于本仓范围。原 runtime 工程保持不修改。
- `workload_verified=false` 是尚未完成真机验收的标记。安装心跳 `workload_enabled=false` 也不能代替管理员调度开关。
- 沙箱内固定任务上限和镜像缓存 GC 已有源码；数据 purge／备份恢复和失联隔离仍需后续完成。
- 已有自动测试覆盖事务容量、权限、幂等、防重放、过期报告、取消和恢复；真实 Linux 宿主、XFS、gVisor 与客户端流程按 [实施记录](cloud-environment-implementation.md) 后续统一人工验收。

全局规格发布顺序为数据库迁移50 → 后端与管理端 → 客户端接口适配；本变更不修改客户端应用代码。规格迁移 down 会删除目录，回滚前先停新版服务并备份，不能把全局规格自动转换回宿主预设。迁移40的 down 会删除控制记录但不会清理宿主容器或持久卷，不能用数据库回滚代替工作负载回收。

客户端完整接入流程、规格选择与错误恢复见 [客户端接口](environment-client-api.md)。迁移 000040_cloud_environments 允许环境权限写入授权族约束，必须先于客户端申请新权限部署。
