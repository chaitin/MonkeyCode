# monkeyai-engine 一条命令安装

分支：`feat-engine-installer`，基于 main `8be22a22` 创建独立 worktree。

## 范围与进度

| 工作 | 状态 |
| --- | --- |
| 参考 MonkeyCodePro monkeyai 安装器 | 已完成：沿用完整引导脚本下载、固定发行版本、SHA-256 校验、专用目录和失败退出 |
| engine 基础代码 | 从现有 `feat-cloud-environments` 工作树复制源码，原工作树不变；不带构建产物 |
| 后台宿主注册与命令 | 已实现：管理员生成命令、分页列表、撤销、30 分钟凭据、公钥绑定和签名挑战 |
| engine 安装与服务 | 已实现：发行组件校验、独立 containerd、runsc、shim、CNI、systemd、持久身份、预检心跳 |
| 管理页面 | 已完成构建与浏览器验证：生成／复制、失败、过期、报告、撤销和窄屏 |
| 验证 | 常规后端全量测试、vet、sqlc、engine 竞态测试、Linux 双架构构建、前端 262 项测试、构建与新页面 ESLint 通过 |
| 固定依赖与双架构发行物 | 已完成：官方 containerd static v2.4.2、CNI v1.9.1、gVisor release-20261026.0；固定摘要、来源记录和 13 项完整组件 |
| Linux 完整安装验收 | ARM64 独立 Ubuntu 24.04／systemd VM 全流程通过；AMD64 已完成真实依赖打包和摘要校验，尚未原生安装验收 |
| 生产发布 | 未执行；本地生成 v0.1.0-test.5 双架构候选包，不作为已发布版本 |

## 安装流程

管理员进入「系统设置 → 宿主管理 → 添加宿主机」，填写名称、架构和专用数据目录。
后台校验自身 HTTPS 地址和对应发行目录已准备，创建待接入记录，返回完整命令和 30 分钟到期时间。
命令只展示一次；令牌只以 SHA-256 摘要存入数据库，审计沿用未知字段默认脱敏。

命令完整下载无凭据引导脚本，再通过 sudo 执行。脚本检查 Linux、root、架构和 systemd，下载并校验 engine 二进制。engine 校验安装命令固定的 manifest 摘要，按清单下载所有组件并分别校验 SHA-256。安装器不使用浮动 latest。

安装器生成 Ed25519 私钥，使用接入令牌、公钥和签名向后台注册。后台一次绑定公钥；同公钥在令牌有效期内允许幂等重试，其他公钥拒绝。成功后保存 host ID，后续同配置安装重试保留身份。不同后台、版本或数据目录拒绝隐式覆盖，不将首次安装伪装为升级流程。

systemd 管理独立 `monkeyai-containerd` 和 `monkeyai-engine`。engine 主动 HTTPS 出站，每次获取 60 秒单次挑战并签名提交预检报告。后台收到签名报告后更新在线时间；90 秒无报告显示未连接。每个宿主只存一个挑战，注册和挑战消费均通过条件更新保证原子性。

本阶段的心跳用于安装接入和预检。后续云电脑调度的 WSS、短期宿主 token、分配代次及环境协议仍在云环境实施范围内。不得将当前 `online` 或 `prerequisites_met` 当作可调度执行能力，响应始终 `workload_enabled=false`。

## 文件与资源

| 路径 | 用途 |
| --- | --- |
| `/opt/monkeyai-engine/releases/<version>` | 固定版本 engine/containerd/runsc/shim/CNI |
| `/opt/monkeyai-engine/current` | 当前版本原子链接 |
| `/etc/monkeyai-engine/config.json` | 后台地址、宿主 ID、架构、版本和数据目录；不保存接入令牌 |
| `/etc/monkeyai-engine/containerd.toml` | 专用 containerd 配置 |
| `/var/lib/monkeyai-engine/control/identity.key` | 权限 0600 的宿主私钥种子 |
| `/var/lib/monkeyai-engine/containerd` | 专用 containerd 数据 |
| `/run/monkeyai-engine/containerd.sock` | 权限受限运行目录内的独立 socket |

不接管系统 Docker/containerd，不修改其配置，不格式化或清理磁盘。首次安装缺少 nftables、iproute2、xfsprogs、util-linux 时，Debian/Ubuntu 自动使用 apt-get 安装；其他发行版需预装这些工具。数据目录若未具备 XFS 项目配额，仍可注册并上报未通过项，但不能用于运行云电脑。

撤销只失效后台宿主身份与命令，保留记录和宿主数据，不等于远程卸载。身份或配置损坏时停止而不是自动重新注册。

## 下一步

生产发布前补齐 AMD64 原生 Linux 安装验收，将已审核发行目录只读挂载到后台并配置固定版本；XFS 配额强制执行、gVisor 工作负载和资源隔离随环境驱动验收。然后继续环境驱动与后台调度，不修改 `apps/runtime`。

## 本轮验证记录

- 独立 PostgreSQL 18 测试库验证宿主命令生成、同公钥重试、其他公钥拒绝、过期拒绝、挑战并发单次消费、撤销及匿名管理访问拒绝。
- engine 测试覆盖签名消息、私钥持久化与权限、发行清单篡改、架构不匹配、缺少组件及下载校验失败后不执行文件。
- 打包脚本使用测试 ELF 验证发行目录生成、全部摘要和禁止覆盖；测试包不作为可发布依赖。
- `go test ./...`（后台常规全量，不启用外部集成依赖）、`go vet ./...`、`make sqlc-check` 通过；engine `go test -race ./...`、vet 与 Linux amd64/arm64 交叉构建通过。
- 管理端 `pnpm test` 262 项通过，构建和修改页面 ESLint 通过；构建保留既有 CSS 兼容性及 chunk 大小提示。
- 浏览器使用本地测试 API，验证命令复制、缺少发行物错误、过期后隐藏命令并禁用复制、预检报告和撤销；不代表生产后台联调或 Linux 安装完成。
- 曾尝试给全部后台测试启用数据库，已有业务集成测试缺少 S3 配置，且并发迁移触发测试库共享内存不足，随后停止该轮。没有将这轮记为通过；新增模块单独启用数据库和竞态检测的测试通过。
- 未修改 runtime，未部署线上后台，未接管当前机器的默认容器运行时，未发布生产发行包。

## 2026-10-29 发行与 Linux 验收

- 新增 `dependencies.lock.json` 和下载脚本：锁定官方资产 SHA-256，只提取白名单普通文件，拒绝链接、重复成员、错误架构、损坏缓存和覆盖已有目录；来源记录随发行包保存。
- 新版 gVisor 的六个辅助程序必须放在 runsc 相邻 `gvisor-bin/` 目录，已补齐下载、发行白名单和安装映射；13 项组件包含 engine、containerd、runsc、shim、三个 CNI 和六个辅助程序。
- containerd 使用 v3 配置、独立 socket 和 systemd notify 就绪通知；禁用当前不使用的 CRI 插件。
- 修复重复安装上报失败后既有 engine 一直停止的问题，失败时恢复原先运行中的服务。
- 真实 shim 仅支持 `-v`，已修复 `--version` 造成的预检误报并补充回归覆盖。
- 新增显式启用的 `TestLinuxInstallation`，使用真实 HTTPS 服务、临时 CA、独立 PostgreSQL schema 和固定 Colima profile，管理接口只在进程内调用。
- 最终 ARM64 验收通过（47.84 秒）：后台生成命令、首次安装、同命令重试保持私钥／host ID／0600 权限、503 故障后恢复既有服务、服务重启、VM 重启恢复心跳、原有 containerd 共存、非 XFS 正确标为未通过、其余预检全部通过、撤销后认证失败且后台不再显示在线。首次完整安装还验证了缺少 xfsprogs 时的 apt 依赖安装。
- Colima 启动脚本会主动停止其原有 containerd；测试在整机重启后恢复该测试基线，检查原有二进制／配置摘要不变以及两个独立服务和 socket。该处理属于测试环境，不加入安装器。
- 两种架构均已生成 `engine/dist/releases/v0.1.0-test.5/<arch>/`，每个文件摘要及来源锁文件摘要校验通过；AMD64 未通过 ARM 模拟冒充原生验收。
- 后端常规全量测试、vet、sqlc-check、宿主模块独立数据库竞态测试通过；engine 全量竞态测试、vet、双架构构建通过；Python 四项测试覆盖完整提取、来源记录、损坏缓存、恶意归档成员和错误架构。
- 测试用 engine 服务、身份、目录、CA 与数据库 schema 已清理；独立测试 VM 停机，默认 Colima 保持运行。保留最终候选发行包供后续审核与复验。
