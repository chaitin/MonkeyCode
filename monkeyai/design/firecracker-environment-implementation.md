# Firecracker 云环境实施记录

状态：已开始实施，当前完成平台探测与安全选型基础；Firecracker真实运行和统一安装器自动安装尚未交付。设计见[完整方案](firecracker-environment-design.md)，决策见[讨论记录](environment-engines-billing-discussion.md)。

## 工作基线

- 保留此前设计文档并提交，沿用同一工作树；分支由 `docs-firecracker-image-conversion` 改为 `feat-firecracker-environments`，已同步 `origin/main`。
- 当前代码只修改 MonkeyCode 的 `monkeyai/engine`。本轮不修改 Pro 主线工作区、gitlink、数据库或已部署环境。
- 本机是 macOS arm64、Go 1.27.1；没有把本机验证当作Linux KVM／gVisor真机验收。

## 第一阶段：平台探测与选型基础

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

## 后续阶段与阻断项

- [x] 平台探测、候选优先级、失败分类、保留旧引擎及CLI接入。
- [ ] 固定Firecracker／内核／启动和管理组件发行，受限自检进程与真实启动验证。
- [ ] OCI安全转换、模板缓存与双盘、Firecracker驱动和vsock管理服务。
- [ ] runtime身份／连接／更新及资源和网络隔离。
- [ ] 中心服务版本化能力、环境规格、增量迁移和状态协议。
- [ ] 磁盘超卖准入、本地保护锁定、保留数据与销毁流程。
- [ ] Pro安装器自动选择安装、发行包、默认配置保存、修复升级及回滚。
- [ ] 双架构Linux真机、在线／离线安装和完整工作负载验收。

磁盘默认容量、超卖／保护参数和平台保护性暂停的计费政策仍待冻结；这些不阻止当前安全基础代码，但阻止相应功能正式上线。本轮没有真实部署、数据库迁移、用户环境停机或计费变更。
