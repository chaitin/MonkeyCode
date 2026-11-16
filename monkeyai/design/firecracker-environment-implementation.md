# Firecracker 云环境实施记录

状态：正在分阶段实施。平台探测、OCI转换与双盘存储已完成基础实现和验证；Firecracker宿主执行器、vsock管理服务、自检及分发代码已加入，尚未接通云环境主控制链路。统一安装器自动选型主流程、暂停免计账务和真实KVM验收仍未完成。设计见[完整方案](firecracker-environment-design.md)，决策见[讨论记录](environment-engines-billing-discussion.md)。

## 工作基线

- 保留此前设计文档并提交，沿用同一工作树；分支由 `docs-firecracker-image-conversion` 改为 `feat-firecracker-environments`，已同步 `origin/main`。
- 代码分别位于MonkeyCode的原worktree及MonkeyCodePro的配套worktree；每仓各沿用一个实施工作树，均为feat-firecracker-environments分支，不修改两个主线工作区、gitlink或已部署环境。
- 本机是 macOS arm64、Go 1.27.1；没有把本机验证当作Linux KVM／gVisor真机验收。

## 第一阶段：平台探测与选型基础

本节保留首阶段交付口径；当前组件选型和新增代码以第二阶段及后续清单为准。

### 已实现

- 新增 `engine/internal/hostprobe`，区分 `supported`、`unsupported`、`error`，先校验Linux／架构／cgroup共用条件，再按Firecracker优先顺序探测。
- Linux amd64／arm64实际使用KVM ioctl核对API与基础扩展，创建临时VM／vCPU并关闭句柄；不执行KVM_RUN。检测TUN/TAP基础能力，不创建接口。
- gVisor基础探测验证systrap所需SECCOMP_RET_TRAP、pidfd及当前ARM64发行的4KiB页要求；这不是完整runsc／Docker就绪验证。
- 只有明确平台不支持时才回退；取消、资源不足、未知I/O错误、描述符设置／清理失败不回退。能力满足时也不宣称Firecracker发行兼容或工作负载已验证。
- 通过 `monkeyai-engine probe` 输出版本化的 `platform_only` JSON。`candidate_driver` 只是候选，不包含 `prerequisites_met`、已选默认引擎或新环境协议等可误用为调度许可的字段。
- 支持安装器将已有驱动显式传入 `--current-driver`，保留原绑定；冲突的强制驱动参数拒绝。默认架构取当前平台，不默认AMD64。
- `control.Config`识别 `default_driver`；历史缺省及显式gVisor继续可用，Firecracker尚未接入时服务／本地环境操作／远程升级均明确拒绝，防止忽略新字段而走旧Docker路径。
- CLI、选择逻辑、KVM模拟及错误清理回归已补充；新增需要显式 `MONKEYAI_KVM_TEST=1` 的Linux真实KVM集成测试入口。

### 没有声称完成的能力

- 未安装Firecracker／jailer、未选定内核版本、未执行受限测试虚拟机启动；`readiness_verified`与`workload_verified`始终为false。
- 未改动中心服务心跳／调度协议，也未允许 `lifecycle.Spec` 接受Firecracker环境；生产仍只运行原gVisor驱动。
- 未接入Pro installer执行候选安装、完整自检、默认选择落盘或升级迁移。该阶段提供后续安装器调用的候选探测契约，不代表“一条命令自动安装”已交付。
- 原生内核调用仅在步骤边界响应context；进程级硬超时、残留回收和完整组件自检需要后续安装器的受限独立进程监管。

## 本阶段验证

已执行：

```text
GOWORK=off go test ./...
GOWORK=off go test -race ./...
GOWORK=off go vet ./...
GOWORK=off GOOS=linux GOARCH=amd64 go build ./cmd/monkeyai-engine
GOWORK=off GOOS=linux GOARCH=arm64 go build ./cmd/monkeyai-engine
GOWORK=off GOOS=linux GOARCH=amd64 go vet ./...
GOWORK=off GOOS=linux GOARCH=arm64 go vet ./...
```

KVM测试逻辑及CLI在本机通过，Linux两架构测试二进制可交叉编译；实际CLI在macOS正确输出Linux不支持、无候选和非零退出码。基于模拟的测试覆盖KVM可用、缺失／无权限、API／能力缺失、VM／vCPU创建失败、清理失败、取消、错误结果拒绝和已有引擎不切换。

现有依赖隔离Docker环境的集成测试按原条件跳过；新增真实KVM测试未运行。交叉编译和模拟通过不能代替真实KVM、jailer、网络、磁盘、runtime和安装器验收。

## 第二阶段：转换、双盘与宿主组件（进行中）

已实现：

- `vmimage`：固定摘要的中心服务Registry直读，不依赖Docker；OCI索引／平台清单／层SHA及DiffID校验，解压预算和特殊归档限制；固定摘要umoci解包、启动组件注入、ext4生成、只读模板缓存和原子发布。
- `vmdisk`：reflink优先及稀疏复制、独立双盘、先写创建意图、持久磁盘占用、停止确认后释放、保留和独立销毁；逻辑／物理容量预留及压力滞回规则。容量与保护循环尚未接入生产。
- `firecracker`：有界Unix API、强制Writeback/Sync与限速、实例与启动身份校验；持久实例状态、保护锁定和单写占用；systemd/jailer宿主执行器及独立网络接口。当前未替换既有生产gVisor驱动。
- `guest`及`cmd/monkeyai-guest`：vsock握手、仅宿主CID连接、有限管理RPC，普通用户status/login/serve与关机请求；数据盘和启动标识检查；bootstrap与systemd服务材料。独立runtime升级尚未实现。
- `vmnet`：网络地址登记、私有namespace/TAP/veth、专用nftables出口隔离和固定例外；尚未运行真实网络隔离验收，准备中断后的完整自动恢复仍待补齐。
- `selftest`及CLI：固定驱动真实自检入口、最小PID1测试程序、受限gVisor版本执行、microVM+vsock测试及清理确认。无KVM时不谎报就绪，尚未验证真实KVM启动。
- 组件锁定Firecracker v1.18.0、Linux 6.1.167、umoci v0.5.1、e2fsprogs 1.47.2；`buildvm.py`提供独立Linux构建机原生构建流程，`packagevm.py`提供静态ELF／SHA校验和确定性归档。完整内核／静态mke2fs构建尚未执行，不能声称已有完整发行包。
- Pro：新增VM清单、独立归档下载／SHA／静态ELF校验；在线／离线engine分发和资源包支持可选firecracker.tgz；发行脚本纳入其摘要和源码指纹。`Run`的自动选型主流程尚未调用新探测／准备函数。
- 中心服务enginehost：按可信发行清单提供可选firecracker.tgz，拒绝缺失、未声明和符号链接归档。环境调度、保护事件和账务协议尚未扩展。

真实工具验证：在隔离Linux ARM64容器中执行了mke2fs/debugfs生成与复制验证，以及OCI白化删除／覆盖→umoci→ext4→缓存复用的端到端测试。先验证系统umoci 0.4.7，再用锁定源码构建的静态umoci 0.5.1重新验证通过；过程中修正了测试OCI manifest错误序列化的manifests:null。测试容器已清理，没有发布镜像或组件。

当前Colima/Linux没有/dev/kvm。用户已选择先完成代码和打包，真实KVM、jailer、网络及工作负载验收保留未完成，不部署。

用户另行确认：平台磁盘压力导致保护暂停期间免计算费，显式恢复并重新可用后恢复计费。该决策已记录，账务代码仍待接入，不能写成已实施。

## 后续阶段与阻断项

- [x] 平台探测、候选优先级、失败分类、保留旧引擎及CLI接入。
- [ ] 固定Firecracker／内核／启动和管理组件发行，受限自检进程与真实启动验证。
- [x] OCI校验／转换、模板缓存与双盘基础，并完成真实ARM64工具转换验收。
- [ ] Firecracker执行器与vsock管理服务接入既有环境生命周期和云端控制链路。
- [ ] runtime身份／连接／更新及资源和网络隔离。
- [ ] 中心服务版本化能力、环境规格、增量迁移和状态协议。
- [ ] 磁盘超卖准入、本地保护锁定、保留数据与销毁流程。
- [ ] Pro安装器自动选择安装、发行包、默认配置保存、修复升级及回滚。
- [ ] 双架构Linux真机、在线／离线安装和完整工作负载验收。

磁盘默认容量和超卖／保护参数仍待按实际支持矩阵冻结；暂停期间免计政策已确认，但保护事件与幂等时段结算尚未实现。本轮没有真实部署、数据库迁移、用户环境停机或计费变更。
