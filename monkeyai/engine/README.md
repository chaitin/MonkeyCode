# monkeyai-engine

云端执行环境的宿主管理程序。安装／升级由统一 installer 执行；engine 负责签名预检上报，以及本地 Docker/gVisor 生命周期驱动、普通目录持久存储与资源限制。已接入后台调度、客户端创建接口和 standalone 编排，真实工作负载统一留待人工验收。安装和发行见[安装说明](INSTALL.md)，本地操作入口和实现边界见[环境执行层](ENVIRONMENT.md)。

## 构建与检查

需要 Go 1.27：

```bash
make check
make build
make linux
```

`bin/monkeyai-engine` 使用当前平台，`make linux` 生成 Linux AMD64 和 ARM64 二进制。ARM64 用于原生开发验证，不代表 AMD64 生产基线已经验收。

## 宿主预检

```bash
sudo ./bin/monkeyai-engine doctor \
  --architecture amd64 \
  --data-dir /var/lib/monkeyai-engine \
  --docker-socket /var/run/docker.sock
```

输出单个 JSON 报告，检查 Linux、架构、cgroup v2 控制器、Docker API、runsc runtime、nftables、IPv4 转发、Unix socket、数据目录，不检查文件系统项目配额。

预检只读取状态，不创建目录、不安装软件、不格式化磁盘、不改变配额，不连接后台。每个外部程序有超时和输出上限；总期限 45 秒。

退出码：

- `0`：检查的前置条件满足。
- `1`：前置条件未满足或检查失败，具体结果见 JSON。
- `2`：参数错误。

`prerequisites_met` 只表示前置条件，`workload_verified` 当前始终为 `false`。控制器存在不等于额度已落实到沙箱。节点实际执行能力还需验证资源创建、网络策略、持久化、gVisor 进程限制以及真实 runtime。

数据目录要求是已经准备好的、非符号链接的受限目录。持久数据使用普通目录，不实施容量或 inode 配额，也不要求 XFS／ext4 配额或独立镜像。CPU、内存、进程数及临时 tmpfs 限制继续生效，详见[安装说明](INSTALL.md#持久目录)。

## 执行引擎平台探测

自动选型的第一阶段已提供独立命令，不改变现有 `doctor` 或生产调度语义：

```bash
sudo ./bin/monkeyai-engine probe --driver auto
sudo ./bin/monkeyai-engine probe --driver auto --current-driver gvisor
```

`--architecture` 默认取当前架构，可显式指定 `amd64`／`arm64`。修复／升级的调用方必须把已保存引擎传入 `--current-driver`，命令不会读取或改写生产安装配置。`--driver=firecracker|gvisor` 只控制探测范围，不执行驱动切换。

- 共用检查 Linux、架构及 cgroup v2 控制器；失败时不探测其他驱动。
- 自动模式先检查 Firecracker：实际访问 KVM、核对 API／基础扩展、创建临时 VM／vCPU，并反向关闭句柄；检查 TUN/TAP 设备基础能力。不执行 `KVM_RUN`、不启动用户虚拟机、不改网络或磁盘。
- 仅明确不支持时尝试 gVisor：检查 systrap 所需 seccomp 动作、当前发行要求的 pidfd 和 ARM64 页大小。不安装软件或启动 Docker。
- I/O、资源耗尽、未知错误、取消或临时资源清理失败均拒绝自动回退。已有驱动不可用时保留绑定，不换成另一驱动。
- 报告为 `scope=platform_only`，返回 `candidate_driver`，`readiness_verified` 和 `workload_verified` 均为 false；不得将其替代 `doctor`、保存为安装成功或用于放行调度。

退出码 `0` 仅表示找到值得继续准备组件的候选；`1` 表示无候选或探测失败；`2` 表示参数错误。探测在步骤之间响应取消，原生内核调用仍需由后续安装器的独立受限自检进程提供进程级超时监管。

当前仍只执行 gVisor。若生产配置显式写入尚未实现的 `default_driver=firecracker`，服务、本地环境入口和远程升级拒绝按 gVisor 处理。完整自检、组件安装、Firecracker 生命周期、镜像转换和自动选型落盘均待后续实施，见[实施记录](../design/firecracker-environment-implementation.md)。

## 预设校验

```bash
./bin/monkeyai-engine validate-preset --file /path/to/preset.json
```

预设协议版本 `version=1`，`revision` 表示管理员发布的不可变修订。字段如下：

| 字段 | 要求 |
| --- | --- |
| `id`、`revision`、`name` | 预设标识、正整数修订和显示名称 |
| `image` | 完整仓库路径及固定 `@sha256:` 摘要 |
| `architecture`、`driver` | `amd64/arm64`，首期只接受 `gvisor` |
| `network_policy` | 宿主管理维护的策略标识，不允许传入任意规则 |
| `runtime`、`task_engine` | 包含 `path/version/sha256`，路径在只读发行目录 `/opt/monkeyai/` 内 |
| `resources` | 下列所有数值必须显式提供，不使用隐式无限额默认值 |

资源字段为 `cpu_millis`、`memory_bytes`、`workspace_bytes`、`home_bytes`、`runtime_bytes`、`volume_inodes`、`temporary_bytes`、`sandbox_tasks`。其中持久目录容量与 inode 字段仅兼容旧预设，可省略，不作为磁盘限额；临时目录预算包含在环境总内存内。

拒绝重复 JSON 字段、大小写别名、未知字段、尾随 JSON、浮动镜像、无校验和发行包、隔离降级、路径穿越、负数、超范围资源和无界任务数。文件上限 64 KiB。

静态校验不拉取镜像、不校验发行包的实际字节，也不检查网络策略是否已安装。`image_verified` 和 `workload_verified` 在结果中明确为 `false`；实际启动前必须由驱动完成对应验证，不能凭静态校验成功接收用户任务。

## 本地生命周期协调器

`internal/lifecycle` 已接入命令入口与宿主目标同步，提供驱动边界 `Prepare/Create/Start/Stop/Inspect/Remove`。状态采用原子 JSON 文件保存；同代次规格冲突和旧代次会被拒绝，启动失败代次不会自动重启。启动、停止和删除依赖驱动查询确认；停止只清理实例资源，持久卷由独立存储层管理，停止和实例删除均保留数据。

单元测试通过内存驱动验证生命周期及创建后检查点写入失败的恢复。已接入跨进程锁、调度代次、取消旧目标、完整持久卷、签名宿主协议与网络协调。`running` 只指驱动观测，不表示 runtime 或中转可连接。

已提供 Docker/gVisor 驱动；真实 Linux 宿主的镜像摘要、cgroup、网络隔离和持久目录权限仍需统一验收。公网配置见 [网络说明](NETWORK.md)。

## 状态与后续

本分支的实施状态见[云环境实施记录](../design/cloud-environment-implementation.md)，安装器历史见[安装实施计划](../design/engine-installer-plan.md)。`apps/runtime` 保持不修改，已通过现有 standalone CLI 接入登录、状态读取和启动，详见 [运行时编排](RUNTIME.md)。

宿主运维可运行 `monkeyai-engine cache inspect`／`cache gc` 核对镜像缓存，配置和回收边界见 [缓存治理](CACHE.md)。沙箱固定 512 个任务（含线程），与宿主 host_tasks 资源分开。
