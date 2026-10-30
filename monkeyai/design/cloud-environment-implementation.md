# 云端执行环境实施记录

状态：实施中。已完成 standalone 编排与客户端调用接口，本轮补齐本人额度查询及环境权限数据库迁移。用户已明确本仓不实现客户端；客户端页面不属于交付范围。运维治理继续实施，真实宿主与兼容镜像后续统一人工验收。

当前分支：`feat-environment-client-api`，对应 PR #1468。最初从 main 0215257c 创建工作树并带入前序源码，现已 rebase 到 origin/main cf3f8842。当前分支用于 PR 评审，尚未合入或发布；历史验证不等同本轮真实宿主验收。


## 已确认范围

- 用户在客户端选择后台预设，一键创建，不提交任意镜像或资源参数。本仓只交付客户端接口与接入契约，不实现客户端页面或 SDK。
- 后台管理 → `monkeyai-engine` → containerd／gVisor。
- 现有 `MonkeyAI/apps/runtime` 不修改，复用 standalone CLI。
- 授权由后台根据已认证创建操作和当前宿主报告完成，不增加用户确认步骤。
- 项目、用户目录和整个 runtime state-dir 持久化。
- 宿主执行驱动预留 Firecracker，供应后端预留 Kubernetes。

## 实施计划

| 阶段 | 状态 | 完成项与剩余项 |
| --- | --- | --- |
| 设计核对 | 本轮完成 | 已确认 runtime 的真实启动和状态协议，并同步修正 machine ID、普通停止授权、预设快照和状态目录语义 |
| P0 宿主准入工具 | 已完成 | 独立 Go 模块、doctor、预设协议与静态校验、单元测试、Linux 双架构构建 |
| P0 真机选型验证 | 统一留待人工验收 | 安装器已有 ARM64 Linux 接入验收；XFS 强制配额、gVisor 资源边界及 runtime 兼容性未验收 |
| P1 宿主执行层 | 本轮源码及自动检查完成，人工验收待统一进行 | containerd v2 API、gVisor、固定镜像、只读根、三类持久卷、XFS 硬配额和容量预留、父 cgroup、跨进程锁、CLI、状态核对；支持 isolated 与 public-only，真实 gVisor 网络仍待验收 |
| P1 宿主协议与联网 | 协议与公网网络源码及自动检查完成，人工验收待统一进行 | 签名目标同步、持久结果重传、新目标取消、运行状态核对已完成；CNI ptp/nftables 公网与固定 DNS 策略已实现；沙箱内固定 512 任务限额和缓存容量治理已接入，自动检查通过 |
| P2 后台集成 | 控制链路、standalone 与客户端接口源码完成 | 预设、用户配额、宿主容量、环境与操作、宿主签名同步、sqlc 和迁移已完成；环境／预设／容量／额度管理页面已完成；已增加受限自动设备授权、持久身份关联和既有中转可连接状态；真实 runtime 联调待验收 |
| P3 客户端接口与运维 | 接口完成，运维未完成 | 预设、本人额度、创建、启停、删除、状态和既有任务／终端／文件连接契约已完成；客户端实现不在本仓范围；数据清理、备份恢复、故障治理待实施 |
| P4 试运行 | 未开始 | 容量测量、回收告警、升级回滚和真实用户验收 |

## 前轮执行层验证记录

- `engine` 模块 `go test ./...`、`go test -race ./...`、`go vet ./...` 通过。
- `engine/internal/lifecycle` 使用内存驱动验证同代次重试、规格冲突、旧代次拒绝、创建成功但检查点写入失败后的认领、退出后不自动重启、停止后使用新实例及状态文件校验；不构成容器验收。
- Linux AMD64、ARM64 二进制交叉构建通过。
- Linux ARM64 Colima 原生运行 `doctor`，返回退出码 1，正确拒绝不满足条件的节点。
- 宿主信息：Ubuntu 24.04.4、内核 `6.8.0-100-generic`、containerd `2.2.1`、cgroup v2；检查时间 `2026-10-29T04:14:24Z`（北京时间 12:14:24）。
- Linux、原生 ARM64、CPU／内存／pids／io 控制器、nft、tc、现有 containerd socket 和受限目录检查通过。
- runsc、`containerd-shim-runsc-v1`、CNI bridge／host-local／loopback 不存在，数据盘为 ext4，XFS 项目配额检查失败。
- 仅临时指定现有 containerd socket 做只读可达性检查，未创建容器或修改共享服务配置。
- 未改动 `apps/runtime`，未运行后台迁移，未修改现有 runtime 的认证协议；不会把这些未实现项写成验收通过。

## 真实宿主验收前置条件

需要可管理的 Linux AMD64 宿主、cgroup v2、固定版本 containerd／runsc／shim、网络工具与 CNI，以及已准备的 XFS 项目配额数据目录。首先运行 doctor，再验证：

1. 指定预设的 OCI 镜像和 runtime／任务引擎发行包校验。
2. runsc 主体及辅助进程的 cgroup 归属、CPU／内存硬上限和 OOM 行为。
3. 沙箱内 fork／clone 限制；不能使用宿主 `pids.max` 或未验证的 `ulimit -u` 代替。
4. 磁盘字节及 inode 硬配额、临时文件预算、用户间和管理网络隔离。
5. 真实 standalone 登录、远程发布、终端、文件、停止后同目录再次启动。

普通 Docker 正常运行不能替代上述证据。预检不会安装运行时、格式化用户磁盘或接管已有工作负载。

## 无 runtime 修改的契约修正

- `login --device-code` 自己生成 machine ID；后台创建环境时 machine ID 留空，不能先生成另一个 ID。
- `authorize` 事件只有公开设备码及验证链接。engine 应在同一实例中调用现有 `status --state-dir`，取得 machine ID 和公钥；禁止读取／上报 `installation.key` 中的秘密。
- 后台自动批准时同时匹配当前用户、创建操作、宿主、实例、待审批设备请求、machine ID、公钥及固定 scopes；不提供通用“按 user_code 批准任意设备”的宿主 API。
- 设备请求由后台按 user_code 定位，用户归属从环境记录取得。运行时本地 `ready` 不表示已连接：必须等待后台已有设备证明和双通道完成。
- 普通停止保留 standalone 授权和 state-dir；通过环境状态阻止签发新 ticket、撤销已有连接并终止实例。删除、用户停用和显式设备撤销才撤销执行授权族。
- 重启不会换成实例级 runtime token；实例唯一性由后台分配、engine 本地锁与原有安装锁共同保证。实例级凭据属于未来协议升级，不宣称当前已有。
- 用户显式撤销后不自动重新批准。再次明确启动若要求恢复，后台必须将这次动作与恢复授权关联，遵循既有登记版本检查。

该记录用于防止旧设计中的 `cloud_managed` bootstrap、预生成 machine ID 或每次停止撤销 token 被误实现。每轮交付更新计划状态，并区分源码完成、预检通过与真实运行验收。

## 下一步

1. 完成数据清理、备份恢复与宿主故障治理等运维代码。
2. 统一人工验收真实兼容镜像、Linux 宿主、XFS、gVisor、网络与接口闭环；客户端工程依据接入契约自行实现。
3. 保持 runtime 工程不修改，Firecracker 和 Kubernetes 仍为后续扩展。

## 2026-10-29 本地执行层

- `environment apply --file` 和 `environment inspect --id` 从已安装宿主配置确定数据目录，仅连接专用 containerd socket。规范化规格不接受宿主路径、底层参数或任意挂载。
- 固定镜像引用及摘要、原生架构、下载／解压预算；只读 snapshot view、UID/GID 1000、空 capabilities、no-new-privileges、有界临时目录。
- 项目、用户、runtime 三卷分配独立 project ID，先保存绑定再设置配额，读取内核硬限额核对；重建不替换持久目录，拒绝跨环境绑定、缩容和未知数据目录。保留卷持续占用本地容量预留。
- 父 cgroup 限制 CPU、内存、swap 和宿主进程数。核对官方固定版本源码发现 `shim_cgroup` 配置未实际移动进程，故在用户程序开始前收拢并核对 shim、沙箱和已有辅助进程归属。
- `host_tasks` 明确只表示宿主辅助线程／进程上限，不复用预设中的 `sandbox_tasks`；本地执行规格拒绝后者。当前没有声称沙箱内用户进程硬限制已实现。
- 生命周期保留代次、实例指纹和回收标记；同代次幂等、旧代次拒绝、失败不自动执行、退出确认后回收。每环境跨进程排他；实例删除不删除持久卷。
- 本轮只提供无外网 isolated 模式，其他网络策略拒绝。心跳 `workload_enabled=false` 和检查 `workload_verified=false` 保持不变。
- 新增自动测试覆盖 OCI 权限与资源、镜像大小预算、持久文件及项目 ID 保持、配额失败重试、损坏映射与符号链接拒绝、规范化规格及跨进程锁。执行层说明和人工验收清单见 `engine/ENVIRONMENT.md`。
- 最终 `go test -race ./...`、本机和 Linux AMD64 `go vet ./...`、Linux AMD64／ARM64 交叉构建、Python 四项打包依赖测试、`git diff --check` 均通过。没有启动 Linux VM、创建真实容器、修改实际配额或运行后台迁移；自动检查不替代后续人工验收。

## 2026-10-29 后台环境控制与宿主同步

- 新增迁移 000036、environment 业务模块及 sqlc 查询。创建只能选择管理员预设，配置冻结；创建和每代操作支持幂等键，状态更新绑定宿主、环境、实例和代次。
- 首期采用单个数据库事务锁串行化预留和报告，避免用户与宿主配额交叉超卖；宿主默认关闭调度，启用后仍核对架构、预检、协议及在线时间。持久卷固定宿主，离线不自动迁移。
- 新增独立 environment:read/manage scopes，不扩大现有 token 默认权限；runtime token 不能请求环境管理权限。新增 API 尚未接入客户端授权与界面。
- engine 使用签名 challenge/exchange 协议，执行日志先落盘、结果确认后标记；新目标取消旧任务，重启恢复未确认结果，退出不自动重启。删除失败可通过新代次重试清理。
- 更新 admin／agent／host OpenAPI 和 [操作说明](environment-control.md)。当前仅 isolated 网络；running 只表示进程运行，workload_verified 仍为 false。
- 自动验证：后端全量 Go 测试与 vet、sqlc 一致性；隔离 PostgreSQL 上的 environment／enginehost race 测试覆盖幂等、跨用户容量、宿主准入、过期报告、删除重试、用户停用及签名防重放；engine race 测试通过。后端与 engine 协议示例校验、本地日志损坏校验均通过。
- 未运行生产迁移，未修改 runtime，真实宿主与客户端流程继续留待统一人工验收。
- 收尾验证：独立 PostgreSQL 上迁移升级与重复执行测试通过；engine 本机／Linux AMD64 vet、Linux AMD64／ARM64 交叉构建、Python 四项打包测试通过；三份 OpenAPI 3.1 文档及引用、重复字段检查通过，原有接口语义保持一致；git diff --check 通过。
- 本轮独立 PostgreSQL 测试容器已清理；当前代码保留在 feat-environment-control 工作树，尚未提交或发布。

## 2026-10-29 后台管理页面

- 本轮按流程 pull main 后新建 feat-environment-admin 工作树，沿用此前未提交代码，未修改原工作树。
- 新增“云环境”导航：环境管理、环境预设、宿主管理、宿主容量、环境额度。延续现有组件、样式和权限保护，中英文文案已接入，其他语言沿用既有回退。
- 环境列表与详情、操作记录定时刷新并跳过后台标签页轮询；目标代次尚未观察时显示等待状态。停止／删除使用固定请求幂等键，网络错误可原样重试；版本冲突后关闭确认入口并刷新列表。删除失败可重新提交清理。
- 预设使用固定摘要镜像、显式架构和资源表单，保存后只可启停；容量与用户额度以 CPU、MiB、GiB 展示，换算保留毫核与字节精度。用户额度复用现有用户搜索，不加载全部用户。
- 更新宿主身份撤销提示：撤销不自动停止已有容器，需要先完成停止确认。宿主 UUID 可用于容量页面核对。
- 新增仅绑定本机的模拟 API 服务 `pnpm dev:environments`，用于在无生产凭据、无真实宿主的情况下检查界面。该服务不参与生产构建或真实验收。
- 验证：前端构建、266 项测试、修改文件 ESLint、TypeScript 与格式检查通过。自动浏览器检查覆盖分页、观察与目标代次、响应丢失后的幂等重试、版本冲突禁用提交、预设校验／创建／启停、容量错误与重试、用户搜索与额度校验保存、列表错误／空状态／恢复、英文与完整预设配置，以及 390px 窄屏表单和详情。窄屏弹窗宽度 358px、两侧各 16px，页面与弹窗均无横向溢出。
- 本轮未更改 backend／engine 执行逻辑，未运行生产迁移，runtime 工程未修改；客户端一键创建、联网和 standalone 授权仍待实现，真实宿主人工验收继续保留。
- 收尾：新增详情展示后已重新构建并通过修改文件 ESLint；本轮自动检查不替代真实后端／宿主验收。当前代码位于 feat-environment-admin 工作树，尚未提交或发布。
- 本地模拟 API 服务与自动检查浏览器空间已关闭。深色截图捕获于主题切换过渡中，不作为对比度验收依据；该项继续留待统一人工验收。


## 2026-10-29 公网网络

- 已按流程 pull main，新建 feat-engine-network 工作树，带入前序未提交代码；runtime 工程未修改。
- 新增 public-only：每实例独立 netns、CNI ptp/host-local、IPv4 源地址约束、固定 DNS、指定公网 TCP 端口、元数据／宿主／私网默认拒绝与管理员固定服务例外。规则只操作带归属证据的实例表，不修改全局防火墙。
- 网络计划、inode、CNI 连接、不可变配置快照和阶段持久化；创建／启动前核对，停止确认后清理。失败不返回可用附件，回收失败不释放实例，运行中核对失败尝试终止实例。
- 新增宿主 network_policies 能力上报；后台创建和重新启动均核对公网能力，旧 engine 仍只承载 isolated。CNI ptp 已纳入固定依赖、打包、安装与后台发行白名单。后台预设增加网络选择，默认 isolated，详情按实际策略展示。
- 自动检查通过：engine race 全量测试、本机与 Linux AMD64 vet、Linux AMD64／ARM64 交叉构建，Python 4 项依赖测试；backend 全量测试／vet／sqlc 1.30 一致性，独立 PostgreSQL 的 environment／enginehost race 测试；admin 构建、266 项测试与修改文件 ESLint；三份 OpenAPI 3.1 校验及 git diff --check。
- 独立 Linux ARM64 可销毁测试容器使用固定 CNI v1.9.1 和 nftables 1.0.6，真实验证网络创建、重复核对、原子规则刷新及清理。模拟公网的实际 TCP／UDP 包测试覆盖允许端口、指定 DNS、其他 DNS／853 拒绝、普通 UDP 拒绝、固定私网服务例外、其他私网／元数据拒绝、宿主主动入站拒绝、跨实例拒绝与源地址伪造拒绝；不依赖互联网，也不修改共享宿主规则。
- 核对并修正 nft 1.0.x JSON 遗漏表 comment 的兼容问题，改为严格文本头部核对归属；CNI ADD 前先核对转发已经由管理员启用和地址池无冲突，避免插件静默替管理员开启网络。
- 本轮未做浏览器验收，新增选项已通过前端构建与静态检查。真实 gVisor、XFS、IPv6／ARP、断网／重启故障与客户端端到端验收仍统一留待人工执行，workload_verified=false。

- 本轮独立网络测试容器与 PostgreSQL 测试容器已删除。代码保留于 feat-engine-network 工作树，尚未提交或发布。


## 2026-10-29 沙箱任务与镜像缓存

- 本轮 pull main 到 0215257c，新建 feat-engine-limits 工作树，带入前序改动并处理客户端设备清单与环境管理的集成冲突；保留 main 的设备列表接口、页面和多语言内容。代码尚未提交，runtime 工程未修改。
- 接入沙箱内固定 512 任务上限（含线程），OCI RLIMIT_NPROC 软硬值一致，与 host_tasks 分离。核对固定 gVisor release-20261026.0 的任务创建计数和初始用户命名空间权限判断；启动和运行核对拒绝缺少限额的旧 OCI 实例，停止／删除仍可清理。
- 新增镜像缓存配置、实际分配空间测量、磁盘／inode 预留和受管闲置镜像 LRU 回收；保护 containerd 容器与尚未清理的本地环境引用，归属不明或日志损坏时中止。只使用专用 containerd API，不删除共享内容目录或持久卷。
- 冷准备预留 25 GiB／1,100,000 inode，完整解包镜像复用只要求基础余量；新增 cache inspect／gc 命令，配置说明见 engine/CACHE.md。容量准入不冒充文件系统硬配额，真实磁盘竞争与超限仍需运维验收。
- 自动检查通过：engine 全量 race 测试、本机及 Linux AMD64 vet、Linux AMD64／ARM64 构建、Python 4 项依赖测试；backend 全量测试／vet／sqlc 1.30 一致性；admin 构建、267 项测试和合并文件 ESLint；三份 OpenAPI 校验、main 新增设备接口语义保持检查和 git diff --check。
- 独立 Linux ARM64 容器运行经摘要核对的 gVisor release-20261026.0 和 containerd v2.4.2。真实 fork／pthread 探测将阈值降低为 64，分别在 63 个子任务后得到 EAGAIN，提高硬限额返回 EPERM，子进程退出后可再次 fork；512 的生产软硬配置及独立身份由 OCI 测试核对。这不构成 512 任务负载或 CPU／内存边界验收。
- 同一可销毁容器内，通过真实 containerd 内容与镜像 API 验证闲置镜像删除、现有容器／失败待清理环境／未知归属保护，以及共享内容未被破坏；Linux 磁盘扫描、符号链接不跟随和取消测试通过。未运行真实容量压满或完整镜像冷准备压力测试。
- 完整 XFS、资源压力、IPv6／ARP、宿主重启和客户端验收继续统一留待人工执行，workload_verified=false。

- 本轮独立 Linux 测试容器已删除。代码保留在 feat-engine-limits 工作树，未提交或发布；下一步接入 standalone 编排。


## 2026-10-29 standalone 编排与环境授权

- 新建 feat-environment-runtime 工作树，基于 main 0215257c 带入前序源码，runtime 工程未修改。
- 新增环境运行时身份迁移 000037；关联固定 machine ID、公钥、当前实例和代次。自动批准只通过已签名的宿主 exchange 处理，核对当前启动操作、固定权限、宿主及用户状态；首次必须有匹配设备申请，旧身份或已撤销设备不自动恢复。
- 托管规格冻结后台 origin、server ID、用户 ID，调度及重新启动要求 runtime_protocol=1 和 public-only。实例使用固定 tini 入口，CLI exec 沿用非 root、空 capabilities、任务限额、环境变量白名单及父 cgroup。
- runtime 使用持久卷内 state 子目录，兼容现有父目录维护锁；设备码及 CLI 输出只保留在有界内存。登录完成后核对身份，serve 使用固定 exec ID 与 NullIO，engine 重启后只认领现有进程；退出不自动执行。
- 普通停止禁止新访问、关闭中转并撤销旧连接票据，保留 standalone 授权；暂时停止以可重试错误处理，不误发永久设备撤销事件。删除在事务内撤销 runtime 授权族及 token。新实例复核持久身份前不恢复访问。
- 环境 API 增加 machine_id、runtime_ready、connectable、stale；创建操作等待设备证明及中转双通道在线后完成，不能把容器 running 或本地 ready 当作可连接。
- 详细契约见 engine/RUNTIME.md。客户端页面、真实镜像及完整 Linux runtime／gVisor 联调仍未验收，不改变 workload_verified=false，也未运行生产迁移或发布发行包。
- 自动验证通过：backend 全量 Go 测试；独立 PostgreSQL 18 上 environment／enginehost 全量竞态测试、identity 的 Cloud／Device 授权与 relay 连接／目录相关竞态测试；engine 全量竞态测试；backend／engine vet、本机及 Linux AMD64 检查、Linux AMD64／ARM64 构建；固定 sqlc 1.30 生成一致性；三份 OpenAPI 3.1、引用及重复字段校验和 git diff --check。系统 sqlc 为 1.26，Go 模块缓存的 wazero 文件缺失；已改用临时目录的官方 sqlc 1.30 二进制完成生成与一致性校验，没有手工编辑生成文件。
- 独立 PostgreSQL 测试容器与其测试卷已删除。当前代码保留于 feat-environment-runtime 工作树，未提交、未合入 main、未发布；下一步接入客户端一键创建和连接。


## 2026-10-29 客户端接口交付范围

- 用户明确只实现客户端调用接口，客户端页面与 SDK 移出本仓待办；前文历史记录中的“客户端待实现”不再表示本仓缺口。接入契约见 [客户端接口](environment-client-api.md)。
- 新增本人额度接口 GET /api/v1/environment-quota，要求 environment:read；同一只读快照返回 limits／usage／remaining，使用既有预留口径，保留目录继续占存储。
- 修复环境 scope 尚未进入数据库授权约束的缺口，新增迁移 000038。回滚撤销相关授权族与 token，并过期未完成请求和授权码；重新升级不恢复旧凭据，其他授权不受影响。
- 接入文档覆盖权限申请、预设、异步创建、目标代次、幂等恢复、既有中转连接与额度语义。没有新增客户端界面或修改 runtime。
- 验证通过：backend 常规全量 go test ./...、go vet ./...；独立 PostgreSQL 18 上 environment 全量及 runtime 定向竞态测试、真实 OAuth 鉴权的客户端 API 测试、环境权限授权／刷新与回滚再升级测试；真实 migrate 升级／重复执行／回滚重建测试；sqlc 1.30 生成一致性；三份 OpenAPI 3.1、重复字段与引用校验；git diff --check。没有重新运行未修改的前端或 engine 验证，不把跳过外部依赖的常规全量测试当作完整真机验收。
- 临时 PostgreSQL 测试容器及匿名卷已删除。当前源码位于 feat-environment-client-api 工作树，未提交、未合入 main、未发布；真实 Linux／gVisor／XFS／镜像联调继续统一人工验收，workload_verified=false。


## 工作树归并

- 按用户要求将云电脑功能的 10 个阶段工作树归并为 feat-environment-client-api，后续以此工作树继续开发；其余 9 个云电脑工作树删除。主工作树与视频诊断工作树保留。
- 核对所有旧工作树的已提交基线、未提交文件和忽略目录。补回早期领域词汇与 README 云环境入口；旧版侧栏重复入口、000034_environment_management 迁移和 lock_linux.go 已由当前实现替代，不重复引入。
- 安装器生成的 engine/dist 已迁移到本工作树，逐文件 SHA-256 校验一致；v0.1.0-test.5 为历史测试发行物，不代表当前源码的正式发行包。
- 旧工作树与归并前当前工作树的 921 份源码文件、差异补丁及状态清单已保存到主仓 .git/worktree-backups，并完成快照摘要校验。依赖、前端构建和临时二进制等可重建产物随旧工作树清理。
- 本轮归并不改变业务逻辑，git diff --check 通过；之前自动验证结论与人工验收边界保持不变。当前源码仍未提交、合入或发布。


## PR 交付

- 云电脑源码与管理界面、宿主安装及执行引擎、客户端 API 和迁移 000035～000038 统一从 feat-environment-client-api 提交评审。客户端与 runtime 工程保持不修改。
- 提交前确认 main 仍为 0215257c；整理管理端 OpenAPI 排版，逐字段确认所有已有接口语义保持一致，并同步设计、README 和实际实施状态。
- 本轮验证通过：backend make check（含全量 Go 测试、vet、sqlc 一致性）；engine 全量竞态测试、vet、Python 四项打包测试、Linux AMD64／ARM64 构建；admin 冻结依赖安装、全量测试、生产构建与修改源码 ESLint；三份 OpenAPI 3.1、重复字段校验；git diff --check。构建保留既有兼容性及 chunk 大小提示。
- PostgreSQL 权限／容量／迁移等验证沿用前轮独立数据库记录，本轮未重新启动真实宿主验收。正式镜像发布、数据 purge、备份恢复、失联隔离、升级回滚及专项告警继续作为后续工作；本 PR 不代表这些能力或人工验收完成。


## PR 分支同步

- 按用户要求 fetch origin 后 rebase 到 origin/main cf3f8842，纳入主线新增的 4 个提交，过程无冲突。
- git range-diff 确认原功能补丁与 rebase 后一致；本轮仅另行更新实施记录，不改变云电脑业务逻辑。
- backend make check（全量 Go 测试、go vet、sqlc/schema 一致性）及 git diff --check 通过；使用带明确旧提交校验的 force-with-lease 更新原 PR 分支。人工验收和后续运维待办保持不变。
