# Firecracker 云环境实施记录

状态：代码已接通双驱动生命周期、中心调度、本地保护／暂停免计费及统一安装器主流程，正在完成回归和组件构建。真实KVM启动、完整用户工作负载及在线／离线全流程安装尚未验收；未发布、未部署。设计见[完整方案](firecracker-environment-design.md)，决策见[讨论记录](environment-engines-billing-discussion.md)。

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
- `vmdisk`：reflink优先及稀疏复制、独立双盘、先写创建意图、持久磁盘占用、停止确认后释放、保留和独立销毁；逻辑／物理容量和在途inode预算持久化，容量与保护循环已经接入服务代码。
- `firecracker`：有界Unix API、强制Writeback/Sync与限速、实例与启动身份校验；持久实例状态、保护锁定和单写占用；systemd/jailer宿主执行器及独立网络接口。当前未替换既有生产gVisor驱动。
- `guest`及`cmd/monkeyai-guest`：vsock握手、仅宿主CID连接、有限管理RPC，普通用户status/login/serve与关机请求；数据盘和启动标识检查；独立runtime升级通过临时根目录释放内嵌引擎并核对摘要，维护启动不登录或运行用户runtime；停止时复用宿主记录查询版本。
- `vmnet`：网络地址登记、私有namespace/TAP/veth、专用nftables出口隔离和固定例外；已在本地Linux完成真实namespace／TAP／veth／路由／nftables创建、核验和回收，以及两种策略的nft语法检查；完整流量攻击验收和准备中断后的完整自动恢复仍待补齐。
- `selftest`及CLI：固定驱动真实自检入口、最小PID1测试程序、受限gVisor版本执行、microVM+vsock测试及清理确认。无KVM时不谎报就绪，尚未验证真实KVM启动。
- 组件锁定Firecracker v1.18.0、Linux 6.1.167、umoci v0.5.1、e2fsprogs 1.47.2；`buildvm.py`提供独立Linux构建机原生构建流程，`packagevm.py`提供静态ELF／SHA校验和确定性归档。当前ARM64开发包对应代码提交`cf94f92d`，位于工作空间`.artifacts/firecracker-cf94f92d-arm64/package/`，归档SHA256为`8664154778c929dc1e01181440b1485467cce2d4553e1d16baecf8a6ca9a8bf4`，已通过Pro installer对实际归档的完整解包、逐文件摘要和静态ELF／架构校验。此前65cff420版本的开发产物保留用于追溯。AMD64开发包也已构建完成，位于`.artifacts/firecracker-cf94f92d-amd64/package/`，归档SHA256为`0e68d7085b28890b316b7c8beb330d283cd149ed541428750f523dade65f5553`。它使用macOS上的静态Go交叉编译产物及ARM64 Linux上的AMD64 GCC交叉工具链构建，未运行模拟架构中的Go/GCC；已通过Pro安装器对实际归档的完整校验。两个包都是本地开发产物，没有发布。
- Pro：新增VM清单、独立归档下载／SHA／静态ELF校验；在线／离线engine分发和资源包支持可选firecracker.tgz；发行脚本纳入其摘要和源码指纹。`Run`已接通平台选择、固定包准备、真实自检记录、驱动配置和服务保存；Firecracker服务不依赖Docker，升级保留驱动和旧组件路径。旧版无VM清单的发行继续走历史gVisor路径。
- 中心服务enginehost：按可信发行清单提供可选firecracker.tgz，拒绝缺失、未声明和符号链接归档。中心调度和环境创建支持协议4的Firecracker规格，冻结组件清单摘要与双盘容量；普通停止／恢复保持实例ID，gVisor继续按原协议执行。

真实工具验证：在隔离Linux ARM64容器中执行了mke2fs/debugfs生成与复制验证，以及OCI白化删除／覆盖→umoci→ext4→缓存复用的端到端测试。先验证系统umoci 0.4.7，再用锁定源码构建的静态umoci 0.5.1重新验证通过；过程中修正了测试OCI manifest错误序列化的manifests:null。测试容器已清理，没有发布镜像或组件。

当前Colima/Linux没有/dev/kvm。用户已选择先完成代码和打包，真实KVM、jailer、网络及工作负载验收保留未完成，不部署。

用户另行确认：平台磁盘压力导致保护暂停期间免计算费，显式恢复并重新可用后恢复计费。该规则已经接入代码，增量迁移为 `000047_environment_protection`，通过sqlc生成查询，没有改写000040或手改生成文件。迁移仅在测试数据库应用，未应用到线上。

## 第三阶段：控制链路与保护账务

- `vmhost`接入host／lifecycle／standalone执行器分派，拒绝把新驱动交给Docker。CPU毫核转为整数vCPU，并用宿主cgroup保留原精确配额；宿主指标带启动ID，跨启动不相减。
- OCI转换由单独systemd服务执行，使用临时根目录、动态用户、只读系统目录、独立网络、有限能力、CPU／内存／进程数和超时限制。真实受限转换在Colima/Linux上通过。清理结果不确定时保留转换暂存区、磁盘占用和预算；登记转换unit，重启后只有确认服务退出及所属cgroup为空才自动回收暂存区并重试，活动或归属未知的进程不会被接管。确认完成后不在缓存保留沙箱副本。
- 存储保护循环独立于心跳和命令同步每秒检查，warning阻止新分配，critical持久写入保护事件与代次后暂停，暂停失败则停止。空间恢复不会自动解除实例锁定或启动用户进程。
- 保护事件包含固定事件ID、实例、代次和发生时间；worker持久保存并协商protection_protocol，旧协议不发送新字段。中心状态使用protected，禁止旧running覆盖；保护时断开runtime连接并拒绝继续接入。
- 暂停关闭收费时段，报告重放不推进实际观测时间；显式停止／更高代次重新可用后开启新时段。实际PostgreSQL测试覆盖延迟上报、重复事件、内容冲突、停止期间免计和恢复后重新计费，并保持旧gVisor计费测试通过。
- 模板缓存回收与磁盘准备共用跨进程锁；从磁盘登记核对引用，保留、准备中、登记不一致或未知条目都会阻止删除。只清理无引用模板，实际物理占用以块数核对；critical先暂停活动写入者再尝试回收，空间恢复仍不自动启动。
- 管理端增加存储保护状态、筛选、免计费及恢复步骤说明；前端类型检查、相关ESLint及全部前端测试通过。
- 普通环境删除保留双盘与逻辑预算。新增本地 `environment retained` 列举，以及 `environment destroy-disks --id <ID> --confirm-environment <同一ID>` 独立销毁入口；没有执行真实用户数据销毁。
- Linux隔离容器中的真实官方runtime单文件准备、内嵌引擎校验、原子激活和重复安装已通过。该验证不能替代vsock上的真实虚拟机升级验收。

## 安装与构建示例

对应架构Linux构建机运行；或在ARM64 Linux构建机显式使用`--arch amd64 --cross-prefix x86_64-linux-gnu-`及AMD64静态uuid/blkid/libc开发库交叉编译。

```sh
python3 scripts/buildvm.py --arch arm64 --output /artifacts/components-arm64 --cache /artifacts/cache --jobs 2
python3 scripts/packagevm.py --arch arm64 --components /artifacts/components-arm64 --output /artifacts/package-arm64
```

构建机需要Go工具链、make、gcc、pkg-config、bison、flex、bc、objcopy及静态uuid／blkid／libc开发库。可用 `--go-components <目录>` 导入静态Go交叉编译产物，`go-components.json`必须包含architecture、当前cmd/internal/go.mod/go.sum的source_sha256、锁文件umoci_sum和三个Go程序的SHA；源码、架构或文件内容不匹配会拒绝。该选项只用于中央构建，不在Runner编译依赖。

在中央构建机使用`packagevm.py --manifest <同输出目录的manifest.json>`可把VM描述合并进尚未发布的engine父清单。Pro构建脚本设置`ENGINE_VM_COMPONENTS_DIR=<根目录>`后按`<根目录>/amd64`与`arm64`读取components.json和组件，校验实际文件并把VM组件摘要纳入发行版本指纹，自动合并父清单，再交给既有在线／离线归档分发；不需要手改JSON。

首次安装保存对应组件的真实自检记录；同版本修复和升级会复核记录及固定摘要，保留内核／组件与驱动，不在已有虚拟机旁另起可能争用地址的自检虚拟机。缺失或不匹配的记录明确拒绝，需要人工核对活动实例后处理。

安装器默认值为系统盘20GiB、数据盘100GiB、逻辑池16TiB；物理空间critical/warning/recovery为2/4/8GiB，inode为1万/5万/10万，转换限16GiB/100万文件。通过 `--vm-config` JSON可调整容量、地址池、DNS、保护水位和限速；固定发行组件和中心服务例外由安装器生成。所有发行清单、内核及组件引用均需固定摘要，自检不通过不会改选其他驱动。

## 完整本地发行目录

完整双架构发行版本 `engine-03eadd05c9c44aa72cdce30172c85365` 已生成在 `.artifacts/firecracker-full-release/releases/engine-03eadd05c9c44aa72cdce30172c85365/`，包含原Docker/gVisor依赖、engine、installer及两架构VM包。`resources.tgz`大小346376123字节，SHA256为`0b7235e8791b3150ed2c5eac593e03417f0e034b6131fc5ed874dfc04eeed87c`，38项归档集合与摘要全部通过，固定版本根索引已生成。Pro对真实目录的复制、各架构基础宿主包生成和完整复核也通过。

上述过程只执行本地构建和检查，`ENGINE_PUBLISH=false`；没有上传、目标宿主安装或部署。ARM64新开发镜像已本地构建为`monkeyai-environment:firecracker-dev-f227b878-arm64`，镜像ID为`sha256:5069ede392f8ce15e4455e0ab65df89c568364fc459ab67cc98578180adfa00a`。已检查init、mount、普通用户sudo、no-new-privileges阻止sudo，以及此新镜像中的真实runtime临时根目录准备／幂等激活。没有切换中心默认镜像，AMD64新开发镜像与KVM／完整安装验收仍是发布前置项。

## 2026-11-17：修复jailer重复实例参数

目标AMD64宿主首次安装的真实自检报告显示平台探测通过，但`Firecracker API启动超时`。检查锁定Firecracker v1.18.0的jailer实现确认：jailer的`exec_command`会自动向VMM注入`--id`，原SystemHost启动参数又额外传入`--id`，导致VMM参数解析立即失败。

在Linux环境使用同一锁定版本的真实Firecracker与jailer复现：原参数输出`DuplicateArgument("id")`并以153退出；删除额外参数后，实际Unix API的`GET /`返回200，实例状态为`Not started`。该验证未启动虚拟机、不依赖KVM，不能替代真实KVM、虚拟机内启动和vsock握手验收。

修复只向jailer传入实例ID。VMM stderr改由journal保留，自检stdout也写journal；普通环境控制台仍不写入日志。等待API期间检查systemd服务状态，服务提前退出时直接返回退出状态和本次启动的有界journal尾部，不再空等10秒。安装器现已能呈现自检失败报告；遇到后续错误可直接看到该阶段详情。

需要生成新的固定engine发行才能在目标宿主生效，不覆盖已发布的`v26111701`。这次问题位于宿主engine的启动参数，已有OSS Firecracker工具包无需为此修改。

## 宿主驱动和新建环境磁盘规格

宿主详情摘要展示上报驱动，品牌名为Firecracker／gVisor；兼容已知历史gVisor协议，未上报或未知驱动不推测。宿主规格接口返回`driver`以及Firecracker的`disks.system_bytes`、`disks.data_bytes`，表单用GiB输入，验证64 MiB～16 TiB和4 KiB对齐。省略磁盘字段保留现有设置，首次沿用宿主上报的默认值；gVisor拒绝磁盘字段。

磁盘设置和计算资源一起保存到现有宿主规格JSON文档，不新增数据库列或迁移。调度仅将所选磁盘值写入新环境的VirtualMachine快照，执行协议中的计算资源仍只有原四个字段。修改宿主规格不会扩缩已有磁盘。CPU／内存计费和存储暂时免费规则不变。

已验证数据库保存、回显、旧客户端省略字段、gVisor拒绝与已有实例快照保留；前端类型检查、lint、构建和相关测试通过；浏览器验证驱动摘要、双盘默认值／非法输入／保存回显／gVisor隐藏和390px布局。

## 受限umask下的首次镜像转换权限修复

真实AMD64宿主的首次环境启动失败停在镜像隔离转换：转换服务退出`200/CHDIR`，尚未创建VMM。定位到daemon固定`UMask=0077`使新建sandbox目录和输入程序收紧为0700；DynamicUser在进入RootDirectory和exec之前不能使用程序启动后才获得的能力。目标机独立临时目录的version诊断复现200；仅改根目录后进一步复现203/EXEC。

修复在私有暂存父目录中显式设置隔离目录0755，三个隔离工具使用独立副本并设置0555，不通过chmod硬链接改变已安装程序；WorkingDirectory明确为隔离根。输入文件和私有父目录仍受保护，DynamicUser／私网／能力集合／只写output和tmp的限制保留。相同umask也会把内核副本0444收紧为0400，现显式设置0444供独立VMM用户读取。

Linux原生ARM64在`umask 077`下使用真实systemd隔离执行通过OCI解包、whiteout、bootstrap、ext4生成及缓存复用验收，工具副本和内核读取权限回归也通过；未将该转换验证当作真实KVM工作负载验收。目标宿主运行文件与原环境未修改，需要新的engine发行才能生效。

## 真实宿主完整启动验收与后续修复

目标AMD64宿主已实际验证完整链路，最终独立实例`4157fde8-af6b-df3d-fc49-c18033cd0c1c`、实例标识`b8a8aad7-3a5f-1e56-a715-6d37ab9e98f5`通过KVM冷启动、vsock、guest、runtime 26.1114.1准备和版本核对；停止后再次冷启动，原实例及双盘复用通过，测试耗时38.86秒。该独立测试未进行用户登录授权（authorized=false），不把它描述为已验证客户端连接；测试实例按流程停止回收。原失败环境及中心默认镜像没有被改写。

本轮真实镜像还暴露并修复以下问题：

- 锁定umoci只接受OCI媒体类型。上游Docker v2清单先完成原始摘要、平台与DiffID校验，然后仅在私有副本中生成OCI清单；配置和层内容不变，模板身份仍绑定原始架构manifest摘要。
- DynamicUser强制RestrictSUIDSGID，阻止恢复镜像内chage等文件的SUID/SGID。使用独立oneshot服务保留每任务动态UID租约，可信启动器在受限服务内降权后再执行解包程序；子进程仅保留文件元数据能力。无网络、只读根、NoNewPrivileges与输出/input不可执行约束保留。主写入cgroup确认退出后才释放身份，恢复逻辑同样遵守顺序。没有改用共享固定用户。
- 原默认Docker镜像缺/sbin/init。基于同一原始镜像补齐systemd-sysv、sudo、mount及util-linux，独立兼容镜像摘要为`sha256:8656892d90bd1dc8b6f8ff1822f32f19221ec9100546e263e85295ed65ed285b`，没有替换中心默认镜像。干净转换模板SHA256为`d9ce4b1bbfb3f5cbea35225d872fe38e74faf15eba98651d3a687368687c873f`，无strace等诊断注入。
- VM的/run挂载带nodev，原runtime准备逻辑在其中mknod创建/dev/null不可用，导致Go安装器无法启动账户查询进程而报service_account_unavailable。改为绑定VM现有/dev/null，显式设置临时目录、账户库和释放程序权限；只有固定安装子进程使用umask022，guest服务仍为0077。runtime安装错误以有界详情通过绑定身份的RPC返回。

新增Docker/OCI真实解包、SUID/SGID与所有权、动态身份回收顺序、完整真实镜像转换及KVM启动复用测试。Pro发行会从当前源码重编译生产guest，固定第三方工具和最小自检程序继续复用OSS锁定依赖；guest更新进入新归档身份。升级为新环境选择新默认bundle，同时保留旧bundle及现有环境磁盘引用；只有最小自检程序、VMM、jailer、内核和mkfs摘要完全相同才沿用原硬件自检凭据和原时间，并记录等价来源，底层启动组件变化则要求重新真实自检。

## 后续阶段与阻断项

- [x] 平台探测、候选优先级、失败分类、保留旧引擎及CLI接入。
- [ ] 固定Firecracker／内核／启动和管理组件发行，受限自检进程与真实启动验证。
- [x] OCI校验／转换、模板缓存与双盘基础，并完成真实ARM64工具转换验收。
- [x] Firecracker执行器与vsock管理服务接入既有环境生命周期和云端控制链路。
- [x] runtime身份／连接／更新、宿主资源采样及网络策略代码。
- [x] 中心服务版本化能力、环境规格、增量迁移和状态协议。
- [x] 磁盘超卖准入、本地保护锁定、保留数据与独立销毁流程。
- [x] Pro安装器自动选择、默认配置保存、修复升级及回滚的代码与单元回归。
- [ ] 双架构Linux真机、在线／离线安装和完整工作负载验收。

默认容量和保护参数已给出可覆盖的实现值，正式支持矩阵仍需结合真实机器冻结。未完成AMD64开发镜像、KVM／jailer／工作负载／端到端安装验收和中断残留的完整自动修复前，不能宣称生产可用。没有发布、部署、线上数据库迁移、用户环境停机或真实账务操作。
