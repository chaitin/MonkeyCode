# 环境控制链路

本轮实现后台 → monkeyai-engine → containerd/gVisor 的目标同步与执行。客户端可通过 API 选择预设创建环境，客户端页面由客户端工程实现，本仓仅交付接口；standalone 接入见 [运行时编排](../engine/RUNTIME.md)。`running` 表示容器进程运行，不能据此展示“可连接”。网络支持无外网的 `isolated` 和显式配置的 `public-only`；公网调度要求宿主报告网络能力，详见 [网络说明](../engine/NETWORK.md)。不支持容器内 Docker／Compose。

## 管理页面

后台“云环境”导航包含：

- 环境管理：分页列表、详情与操作记录、停止和删除；删除失败支持重试，停止和删除先确认后提交。
- 环境预设：创建固定镜像和资源配置、启用和停用。规格保存后不可变，不提供修改已有预设的入口。
- 宿主管理：生成安装命令、查看预检及撤销身份；页面显示宿主 UUID，与容量配置对应。
- 宿主容量：配置可调度容量和开关，单独展示通信状态；通信正常不表示预检或最终隔离验收通过。
- 环境额度：通过用户搜索选择账户，读取系统默认值或用户覆盖值并保存。

客户端通过自己的授权发起创建；后台仅提供全局观察与停止／删除管理。页面不把容器 running 状态展示为可连接。

## 接入顺序

1. 部署迁移 000035、000036、000037、000038 和后端；安装器发行包必须包含本轮支持 exchange 的 engine。安装步骤见 [INSTALL.md](../engine/INSTALL.md)。
2. 管理员生成安装命令，在 Linux 宿主安装并启动服务。engine 每约 15 秒上报预检，每约 3 秒同步目标；宿主无需开放入站控制端口。
3. 使用管理员接口 `PUT /api/admin/v1/environment-hosts/{host_id}` 设置可调度容量，并显式启用。宿主默认关闭；容量不自动取整机总量，管理员需留出系统、缓存和其他开销。
4. 管理员创建镜像与资源预设。镜像固定 SHA-256、匹配原生架构，并提供适合 UID/GID 1000 的长驻 Entrypoint/Cmd。
5. 客户端 OAuth 授权显式申请 `environment:read environment:manage`，分别用于读取与修改。现有 token 不自动获得权限，runtime 的固定 scope 集合不接受这两个 scope。
6. 调用创建 API，保存 environment.id 和 operation.id。轮询详情时同时检查 `generation`、`observed_generation`、`desired` 和 `phase`；状态达到目标且观察代次一致才算收敛。

以下 JSON 为接口请求体示例，不包含真实镜像摘要或凭据。

宿主容量设置：

```json
{
  "enabled": true,
  "cpu_millis": 16000,
  "memory_bytes": 34359738368,
  "storage_bytes": 536870912000,
  "max_environments": 20
}
```

`POST /api/admin/v1/environment-presets`：

```json
{
  "name": "开发环境 2C4G",
  "configuration": {
    "architecture": "amd64",
    "image": "registry.example.com/monkeyai/dev@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "network_policy": "isolated",
    "resource": {
      "cpu_millis": 2000,
      "memory_bytes": 4294967296,
      "host_tasks": 1024,
      "temporary_bytes": 536870912
    },
    "storage": {
      "workspace_bytes": 21474836480,
      "home_bytes": 10737418240,
      "runtime_bytes": 2147483648,
      "inodes": 100000
    }
  }
}
```

预设配置不可修改，只能启停。规格改变时创建新预设，已创建环境继续使用原快照。`host_tasks` 只限制宿主进程／线程，不等同于沙箱内进程硬上限。

`POST /api/v1/environments`：

```json
{"preset_id":"<预设 UUID>","name":"项目 A","request_key":"create-project-a-1"}
```

返回 HTTP 202 和 `{environment, operation}`。客户端不能传镜像、任意资源、宿主路径或命令。创建幂等键在用户范围内唯一；相同键和参数重试返回同一环境与操作，不同参数返回 `idempotency_conflict`。

`POST /api/v1/environments/{id}/stop`、`POST /api/v1/environments/{id}/start` 和 `DELETE /api/v1/environments/{id}` 都要求 JSON 请求体：

```json
{"generation":1,"request_key":"stop-project-a-1"}
```

generation 是当前读取到的目标代次。成功修改后代次加一；同一请求丢失响应时沿用原幂等键重试，不要为网络重试生成新键。新的主动操作使用新键与最新代次。停止、删除可替代未完成目标，旧操作记为 superseded。失败不自动重做；先用新代次停止或删除，确认清理后再启动。删除失败可继续提交新一代删除，但不能复活已进入删除流程的环境。

环境详情的 phase 是最近观察结果，修改 desired 不会伪造观察结果。例如 desired=stopped、phase=running、observed_generation<generation 表示正在等待停止。操作成功只记录该次完成事件；容器之后退出，环境可变为 failed，历史成功操作仍保留。

## 调度与额度

后台先核对用户额度，再选同架构、已启用、预检通过、protocol=1 且心跳和同步均在 90 秒内的宿主。候选按 ID 顺序选择第一个容量满足者，首期不做复杂负载均衡。预留、目标修改和报告在单个全局事务锁下串行处理，适合第一期规模；扩展前需按用户和宿主拆锁并压测。

用户默认额度为 3 个未删除环境、2 个计算预留、8 CPU、16 GiB 内存和 100 GiB 持久存储。管理员可用 `GET/PUT /api/admin/v1/environment-quotas/{user_id}` 覆盖。用户及宿主额度不能设为低于已预留用量。停止、失败、删除中的计算资源在确认回收前持续占用预留；只有收到当前实例和代次的 stopped/deleted 才释放。项目、用户与 runtime 三卷在停止、删除后继续占用存储预留，尚无 purge／配额释放接口。

环境绑定初次分配的宿主，重启复用三卷并生成新实例 ID。原宿主失联时不重新调度，以免创建空目录或出现双实例。停用宿主调度只禁止新建和重新启动，已有实例继续运行。用户停用后，下一次宿主同步生成停止目标；未来接入 runtime 后还需联动撤销设备访问。

## 同步与恢复

`POST /api/host/v1/exchange` 使用已登记 Ed25519 公钥验证签名，签名绑定后台地址、宿主、用途、一次性 challenge 与原始 payload 摘要。挑战与心跳共用，engine 按顺序请求。完整字段见 [host.yaml](../backend/api/host.yaml)。

每轮最多提交 16 个结果、获取 16 个目标。目标按环境 ID 使用 cursor 分页，一轮结束返回空 cursor；只有确认完成删除的环境才停止下发。后台在同一事务内处理结果和目标，跨宿主报告拒绝，旧代次结果确认后忽略，当前代次结果必须与 desired 一致或为 failed。签名挑战消费后同步失败需重新取挑战，执行结果保留到 acknowledged 返回。

engine 在 `/var/lib/monkeyai-engine/control/commands` 保存每环境目标和结果，目录权限 0700，文件 0600。先落盘再执行，结果落盘后上报；后台暂时不可达时重传。每宿主同时执行一个异步任务；新代次取消旧任务，等待结束后处理新目标。运行实例约每 30 秒检查；检查失败或退出记录 failed，不自动重启。旧代次不能覆盖已保存新代次，同代次修改规格拒绝。日志上限 10000 条，删除墓碑尚不自动回收。

engine 停止或失去认证后不再执行新命令，已有容器不会因此自动停止。正常撤销宿主应先停止所有环境并确认；离线的强制停止需要宿主或基础设施运维手段。本轮没有失联租约强制终止能力。

## 当前边界及验收

- 宿主执行支持 gVisor，Firecracker 留在执行驱动边界；Kubernetes 后续作为后台供应实现接入。
- 已有宿主安装管理、预设、容量、额度和环境管理页面。后台不代替用户创建或启动环境，用户创建仍由客户端 API 发起。
- 已接入 public-only、standalone 自动授权与运行启动，以及中转可连接状态；客户端页面不属于本仓范围。原 runtime 工程保持不修改。
- `workload_verified=false` 是尚未完成真机验收的标记。安装心跳 `workload_enabled=false` 也不能代替管理员调度开关。
- 沙箱内固定任务上限和镜像缓存 GC 已有源码；数据 purge／备份恢复和失联隔离仍需后续完成。
- 已有自动测试覆盖事务容量、权限、幂等、防重放、过期报告、取消和恢复；真实 Linux 宿主、XFS、gVisor 与客户端流程按 [实施记录](cloud-environment-implementation.md) 后续统一人工验收。

发布顺序为数据库 → 后端 → engine → 新客户端。回滚前停止并确认所有实例；迁移 000036 的 down 会删除控制记录但不会清理宿主容器或持久卷，不能用数据库回滚代替工作负载回收。首期协议只接受版本 1，不声称支持跨版本滚动兼容。

客户端完整接入流程与本人额度查询见 [客户端接口](environment-client-api.md)。迁移 000038 允许环境权限写入授权族约束，必须先于客户端申请新权限部署。
