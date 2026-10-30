# 宿主环境执行层

已提供 containerd/gVisor 执行层、XFS 持久卷、后台预设与配额调度、签名目标同步和 engine 执行循环。已接入隔离网络和受限公网出站策略；已接入 standalone 登录与启动，详见 [运行时编排](RUNTIME.md)；客户端页面尚未接入。按照当前实施安排，源码先完成，真实宿主统一人工验收。

## 使用入口

安装器生成的 `/etc/monkeyai-engine/config.json` 决定数据目录。执行层只连接专用 `/run/monkeyai-engine/containerd.sock`，不接受任意 socket、运行时名称、宿主路径、挂载参数或宿主命令。

```bash
sudo /opt/monkeyai-engine/current/bin/monkeyai-engine environment apply --file environment.json
sudo /opt/monkeyai-engine/current/bin/monkeyai-engine environment inspect --id env-demo
```

[规格示例](examples/environment.json)中的镜像和摘要是占位值，人工验收时替换成真实的、匹配宿主架构的镜像。镜像必须有持续运行的 Entrypoint/Cmd，允许 UID/GID 1000 访问；宿主不会执行镜像内安装脚本或覆盖其启动命令。

`apply` 同步返回本地检查点；失败同时输出当前状态和错误。`inspect` 分别返回保存的状态和 containerd 实际状态，`workload_verified` 保持 false。`running` 只代表观察到容器进程运行，不代表 runtime 已登录、后台已连接或隔离验收通过。

## 生命周期与恢复

| 操作 | 规格变化 | 行为 |
| --- | --- | --- |
| 创建 | 新环境、新实例，generation=1，running | 准备镜像和持久卷，创建只读快照及容器，启动进程 |
| 重试 | 同一 generation、相同规格 | 认领已存在且标签与规格指纹匹配的实例 |
| 停止 | generation 加一，stopped，其余不变 | SIGTERM，20 秒后必要时 SIGKILL，确认退出后删除任务、容器、快照和空 cgroup |
| 再次启动／重建 | 已停止，generation 加一，新的 instance_id，running | 复用原有卷，从指定镜像重新创建系统目录 |
| 删除 | generation 加一，deleted，其余不变 | 回收运行实例，保存环境墓碑和持久卷 |

旧代次和同代次不同规格均拒绝。进程自行退出、启动失败或发现已运行实例消失时，不自动再次执行镜像命令；先以更高代次停止、清理，再显式启动新实例。被回收的实例 ID 保留标记，不能再次使用。

每环境使用跨进程文件锁。`serve` 每 3 秒通过签名 exchange 同步目标，先写本地日志，再异步执行；每宿主同时只执行一个环境任务。更高代次目标会取消正在执行的旧任务，等待返回后再清理。结果先落盘，再上报，收到后台确认后才标记已确认；断网或重启可重传。运行中实例每 30 秒检查，退出或检查失败报告 failed，不自动重新执行镜像。失败后通过新的停止／删除目标清理，再显式启动。独立 CLI 与守护进程共用环境锁，避免并发修改。

无法确定归属、状态损坏、实例仍运行、挂载回收失败、cgroup 仍含进程时，保留失败状态以便重试，不报告回收成功。实例回收不删除持久目录，不执行全局 prune。持久数据 purge 与保留期限属于后续运维功能；镜像缓存 GC 已接入。

## 存储与资源

| 资源 | 实现 |
| --- | --- |
| 项目目录 | `/workspace`，独立持久卷 |
| 用户目录 | `/home/monkey`，HOME 固定指向此处 |
| runtime 数据 | `/var/lib/monkeyai`，独立持久卷，编排以其 state 子目录传给现有 standalone state-dir |
| 系统根目录 | containerd overlayfs 只读 view，禁止运行中修改系统 |
| CPU | 实例父 cgroup 的 `cpu.max` |
| 内存 | 实例父 cgroup 的 `memory.max`，swap=0，包含辅助进程与临时文件 |
| 宿主线程／进程 | `host_tasks` → 父 cgroup `pids.max` |
| 沙箱内任务 | 固定 512，含线程，OCI `RLIMIT_NPROC` 的软／硬值均为 512 |
| 临时目录 | `/tmp` 使用预算的一半，`/run`、`/dev/shm` 各四分之一，均为有界 tmpfs |
| 持久卷字节及 inode | XFS project quota，设置后通过 quotactl_fd 读取硬限额核对 |

数据目录要求专用 XFS、project quota 的 Accounting/Enforcement 均开启。安装器不会格式化磁盘。数据盘由一个 engine 管理，项目 ID 从 10000 开始分配，已占用 ID 拒绝覆盖。卷映射在外部副作用前原子保存；失败重试沿用原项目 ID。拒绝卷跨环境绑定、改变用途、缩容、缺失卷伪装成新卷及符号链接。

容量预留包含停止和删除后保留的卷。总配额不超过文件系统容量减安全余量，新增预留还核对可用空间；安全余量取数据盘 10% 与 1 GiB 的较大值。三卷硬限额同时消耗各自配额，与后台用户额度、管理员配置的宿主可调度容量分别核对。后台仅在当前代次停止或删除确认后释放计算预留；保留卷持续占用存储额度，失败不释放预留。

固定 gVisor shim 的 `shim_cgroup` 字段没有实际移动进程，因此在用户程序启动前核对 shim 可执行文件，将 shim 和已有子进程纳入实例父限额组，并检查沙箱及辅助进程归属。沙箱任务上限独立固定为 512，含线程，使用 OCI RLIMIT_NPROC 的相同软／硬值；不复用 host_tasks，也暂不接受调用方传入 sandbox_tasks。固定版本 release-20261026.0 的内核任务创建路径执行用户计数校验，UID 1000、空 capabilities 和 no-new-privileges 保证任务无法提高硬限额或取得初始用户命名空间的绕过特权。每个环境独占一个 gVisor 沙箱，计数不与其他环境共享。

启动和运行核对检查已保存 OCI 规格的身份与限额。升级前先停止旧实例；缺少新限制的旧 OCI 实例不会自动获得限额，运行检查会尝试终止并上报失败，须完成停止清理后显式创建新实例。后续加入 exec／standalone 编排时也必须保持相同身份、任务限额和权限约束。

## 隔离和镜像准备

支持 `network_policy=isolated` 和 `public-only`，默认 isolated。公网模式通过每实例 CNI ptp、固定 DNS、nftables 拒绝私网和宿主访问，只开放管理员指定 TCP 出站端口；宿主需显式配置并报告网络能力。详见 [网络说明](NETWORK.md)，未知策略拒绝。

固定 UID/GID 1000，清空 capabilities，no-new-privileges，受限设备和 proc/sys，只允许三种固定持久挂载目标，不接受镜像 VOLUME 自动挂载。Firecracker 可作为新的宿主驱动实现相同生命周期接口；Kubernetes 应在后台增加供应实现，不伪装成宿主驱动。

镜像通过 containerd API 拉取与解包，只接受仓库引用＋固定 SHA-256，原生 Linux 架构匹配。单次镜像准备最长 15 分钟、最多两个下载并发、单对象最多 1 GiB、总压缩数据最多 4 GiB、层数最多 128、解压数据最多 16 GiB、归档文件最多 100 万。首次解包前扫描归档预算，解包仍由 containerd 执行。只读根使用 snapshot view，不创建无配额可写系统层。

镜像缓存已加入总预算、磁盘／inode 余量准入及受保护引用的 LRU 回收，详见 [缓存治理](CACHE.md)。

## 后台接入

安装的 systemd 服务通过 `serve` 同时上报心跳并同步目标，宿主无需入站控制端口。宿主默认禁止调度，管理员另行设置容量并启用；调度还要求预检通过、架构匹配、协议为 1，心跳与同步均在 90 秒内。安装心跳的 `workload_enabled=false` 保留为尚未完成整体能力验收的标记，不能将其当作调度开关；环境响应的 `workload_verified=false` 同样不代表容器运行状态。

后台与宿主离线时，已运行实例继续运行，停止／删除目标等恢复通信后执行；不会自动在其他宿主启动相同持久目录。签名身份撤销会停止命令循环，但不会自动清理已运行容器。需先停止并确认环境再撤销宿主；失联节点的强制隔离需要外部运维措施。协议与操作示例见 [控制链路说明](../design/environment-control.md)。

## 后续人工验收

- 创建后在三个目录写入文件，停止和新实例重建后检查内容和权限。
- CPU、内存、swap、辅助进程实际归属与超限行为；验证 512 沙箱任务下的压力、并发创建与跨环境隔离。
- 项目、用户和 runtime 卷的容量／inode 硬限额、扩容、配额失败重试和磁盘满。
- isolated 无外联；public-only 公网端口与固定 DNS 可达，私网、宿主、元数据、跨实例和非允许端口不可达；只读根及普通用户权限。
- engine／containerd／宿主重启、创建中断、退出后不自动执行、重复及过期命令、回收失败重试。
- AMD64 与 ARM64 分别原生验收；完成 runtime 编排后再做客户端闭环。
