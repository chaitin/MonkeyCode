# 宿主安装与发行

后台入口为「云环境 → 宿主管理」。生成命令后在所选架构的 Linux 宿主执行即可。需要 root、systemd、cgroup v2、curl、SHA-256 工具和 HTTPS 后台地址。支持 amd64、arm64；系统依赖由宿主预装。

## 一条命令接入

点击「宿主管理 → 添加宿主机」直接复制命令，无需填写名称、架构或目录。后台生成带 30 分钟凭据的脚本 URL：

```bash
sudo bash -c "$(curl -kfsSL 'https://server.example/api/host/v1/install.sh?token=短期凭据' || echo 'exit 1')"
```

脚本自动识别 amd64／arm64；engine 注册时上报 hostname，使用默认数据目录 `/var/lib/monkeyai-engine/data`。全部组件从该 server 的 `/api/host/v1/releases/<version>/<arch>/<file>` 下载，不访问 OSS、GitHub 或系统软件源。脚本包含固定版本和摘要，校验统一 installer 后执行 `installer monkeyai-engine install`，installer 负责组件下载、注册和服务安装。首次注册绑定公钥和架构，重试保留身份。

## server 自带安装资源

MonkeyCodePro 的 server 打包默认从 `https://release.monkeycode-ai.com/public/monkeyai/engine/latest.json` 解析 engine 版本，也可通过 `ENGINE_VERSION` 指定测试版本，不触发 engine 构建或发布。在线 server 包保存 engine 下载清单，installer 在安装／升级时从固定 OSS 地址按需下载包含双架构资源的 `resources.tgz`，显示整体进度并在校验摘要后解压；本地同版本且摘要匹配时不下载。离线 server 包直接携带完整资源。安装器将资源校验后安装到 `<安装目录>/engine-releases/<version>/`，只读挂载给后台并配置固定版本。engine 宿主自身不区分在线／离线安装，仍只访问 server。

手动部署后台时，需要挂载完整发行目录并配置：

```dotenv
MONKEYAI_PUBLIC_URL=https://server.example
MONKEYAI_ENGINE_RELEASE_DIR=/opt/engine-releases
MONKEYAI_ENGINE_VERSION=v1.0.0
```

该目录必须包含 `<version>/amd64/` 和 `<version>/arm64/` 两套 manifest 与全部组件。固定版本禁止覆盖；engine 单独构建和发布，server 在打包时固定引用版本；server 升级而 engine 未变时保持引用并复用。升级 server 时保留旧资源目录，未过期旧命令仍使用原版本。

`dependencies.lock.json` 保留 Docker 29.4.3 与 gVisor 的官方来源与摘要，并通过 `dependency_version` 固定依赖包版本。版本采用 `vYYMMDDNN`，当前为 `v26110302`，独立于 engine 版本，仅在依赖变化时递增。普通打包优先复用已校验的本地归档缓存；缓存缺失时，从 `https://release.monkeycode-ai.com/public/monkeyai/engine/dependencies/<依赖版本>/<架构>/dependencies.tgz` 下载一个包，其中包含该架构的全部官方原始归档。解包后逐份校验锁定 SHA-256，再提取并校验 ELF。镜像缺失或失败直接退出，不回退 GitHub。可用 `ENGINE_DEPENDENCY_URL` 指定采用相同目录结构的内网 HTTPS 镜像。

首次准备或升级依赖后，在 MonkeyCodePro 执行 `make monkeyai-engine-dependencies` 生成并同步双架构依赖包：优先读取缓存，只有缓存缺失时访问官方上游；同版本同内容跳过上传，不覆盖不同内容，不修改 engine 的 latest。本地原始归档仍按摘要缓存，跨 engine 版本复用。

打包入口为 MonkeyCodePro 的 `make monkeyai-engine-package ENGINE_VERSION=<固定版本> ARCH=all ENGINE_PUBLISH=true`。server 使用 `make monkeyai-package MONKEYAI_VERSION=<server版本>` 引用 latest 指向的已有发行物；`ENGINE_VERSION=<测试版本>` 可覆盖默认选择。

## 宿主前置条件

宿主预装 Linux、systemd、cgroup v2、curl、sha256sum、nftables、iptables、iproute2、util-linux 和 CA 证书。缺少通用工具时脚本明确报错，不自动安装系统软件。接入成功后若预检未通过，安装器直接列出失败检查项和原因，也可在后台宿主管理查看；安装成功不代表预检已通过。后台生成的安装命令使用 `curl -k`，并将 `--insecure` 传给统一 installer；组件下载、注册和后续心跳跳过 server 证书校验，以兼容 IP 地址和自签名证书。该设置保存在宿主配置的 `insecure` 字段，HTTPS 与组件 SHA-256 校验保留。手动运行 installer 时默认校验证书。

隔离网络只需宿主能访问内网 server；云电脑预设镜像需放入内网仓库。持久数据使用默认普通目录，安装器不格式化磁盘。

```bash
systemctl status monkeyai-engine docker
journalctl -u monkeyai-engine -u docker --since '-10 min'
```

## 持久目录

数据目录默认是 `/var/lib/monkeyai-engine/data`。项目、用户目录和 runtime 状态保存在普通目录中，停止／重建容器时保留。无需配置 XFS／ext4 项目配额、quota 内核模块或独立磁盘镜像，也无需安装 xfsprogs。

当前不限制每台云电脑的持久目录容量或 inode 数，不为其预分配磁盘空间。CPU、内存、宿主进程数和临时 tmpfs 限制继续生效；宿主总磁盘空间由管理员维护。镜像缓存的空间检查和回收仍独立生效。

engine 检查数据目录路径和权限，卷目录使用工作负载 UID/GID 1000、0700 权限；保留环境与卷绑定，拒绝符号链接、跨环境复用或映射丢失后接管已有目录。安装器不会格式化磁盘或修改挂载配置。

如果旧版已生成带 project ID 的卷映射，新版不会清除配额或修改已有数据，启动会提示先迁移到普通目录；该迁移需要单独安排。仅安装接入、尚未创建卷的宿主不受影响。

## 失败恢复与撤销

- 下载／校验失败时不执行该文件，清理暂存下载；已创建的身份和配置保留。
- 注册响应丢失时使用同一私钥重试；不要删除 `identity.key`。同一公钥可在令牌有效期内重试。
- 已保存 host ID 后再次运行同版本、同配置命令修复服务安装，保留现有身份；不会切换到命令对应的另一台待接入记录。多余待接入记录可在后台删除。
- 修复安装暂停既有 engine 以避免心跳挑战竞争；若上报失败，会尝试恢复原先运行中的服务，并返回安装错误。
- 跨版本使用下方升级命令。升级保留既有后台、架构、TLS 策略、宿主身份与数据目录，不允许借升级切换这些设置。
- 后台撤销后，服务无法继续认证，记录显示已撤销。撤销不停止可能存在的用户工作负载，不删除数据，也不卸载系统软件。
- 后台「删除宿主」从列表移除记录，同时撤销接入、停用调度。有关联云环境时须先删除环境并等待 engine 确认清理完成；停止环境或仅发送删除请求不足以删除宿主。历史关联与持久数据保留，不自动卸载 engine。
- 如仅需停用管理服务，执行 `sudo systemctl disable --now monkeyai-engine`；Docker 与持久数据独立保留。

## 可复现 Linux 验收

常规测试不会操作宿主。macOS 开发机可创建独立 Colima VM，使用单独的 PostgreSQL 测试库运行 opt-in 集成测试：

```bash
colima start engine-installer-test --cpu 2 --memory 3 --disk 20 \
  --runtime containerd --activate=false --mount none --ssh-config=false --downloader curl
cd monkeyai/backend
MONKEYAI_TEST_LINUX_INSTALL=1 \
MONKEYAI_TEST_DATABASE_URL='postgres://USER:PASSWORD@127.0.0.1:PORT/TEST_DB?sslmode=disable' \
MONKEYAI_TEST_RELEASE_DIR="$(cd ../engine/dist/releases && pwd)" \
MONKEYAI_TEST_RELEASE_VERSION=v1.0.0 \
  go test -v -count=1 -timeout=20m ./internal/enginehost -run '^TestLinuxInstallation$'
```

测试只接受固定的 `engine-installer-test` profile，要求其尚未安装 engine 或 Docker。它创建临时数据库 schema、HTTPS 服务与测试 CA，在 VM 内执行后台生成的完整命令，验证重复安装、身份和权限、故障恢复、服务与整机重启、既有 containerd 共存、普通目录预检和撤销。测试会重启该 VM；Colima 启动脚本主动停止其 containerd，因此整机重启后由测试恢复原有 containerd，再核对文件摘要及并存状态。结束时清理测试 schema、engine 文件和测试 CA，保留宿主预装的系统依赖。网络上只开放宿主 API，管理调用在测试进程内完成。

验收结果与待验证范围记录在[实施计划](../design/engine-installer-plan.md)。安装验收不代表云电脑工作负载、资源隔离或生产发布完成。

## 可选公网出站

Docker 配置 bridge 网络及转发，engine 自动识别 DNS 并维护公网访问规则，无需手动创建 network.json。具体边界见 [网络说明](NETWORK.md)。已发布旧版本不得覆盖，切换需要生成新的固定版本及清单。

## 宿主信息与资源监测

engine 约每 15 秒通过已有签名心跳上报 hostname、Linux 发行版、内核、架构、CPU 型号与逻辑核数，以及整机 CPU／内存和数据盘使用情况。CPU 使用率按相邻采样的 `/proc/stat` 差值计算，首次采样或计数回退时省略；内存已用量为 MemTotal 减 MemAvailable；数据盘通过 statfs 读取配置数据目录所在文件系统的总量、已用量和可用量，不扫描目录，也不设置磁盘配额。可用磁盘空间扣除文件系统保留块，因此已用与可用之和可能小于总量。

采集失败的指标不伪造为零，也不影响预检结果。管理端保留离线宿主最后一次报告并标注；旧版 engine 未上报新字段时显示“未上报”。部署新版 server 和 engine 后自动生效，不需要数据库迁移。

操作系统名称从 `/etc/os-release`（缺失时读取 `/usr/lib/os-release`）提取发行版和 `VERSION_ID`，例如 Ubuntu 24.04、CentOS 7；仅有 `PRETTY_NAME` 时回退使用该值。旧版只上报 `linux` 时显示“未上报”，需更新 engine。宿主删除需要应用 `000040_engine_host_deletion` 幂等迁移。

## Docker 安装与旧版切换

宿主没有 Docker 时，安装器使用 server 提供的静态组件安装 docker.service。已有可用 Docker 时保留 daemon.json 的其他配置，只增加 monkeyai-runsc runtime，以 SIGHUP 热加载，不重启已有容器、不修改默认 runtime。自定义 daemon 配置路径、rootless、userns-remap 或不可用的旧 Docker 会明确提示处理，不覆盖。

旧 containerd 环境不能自动转换。安装器拒绝存在旧实例控制记录的宿主；先使用旧版本停止、删除环境并等待清理，持久目录保留。Docker engine 版本之间使用统一 installer 原地升级，不需要卸载或重新注册。不要删除数据目录或使用 Docker 全局 prune；Docker 可能承载其他业务，卸载 engine 时不卸载 Docker。

新发行组件有变化，需要先发布依赖 v26110302 和新的 engine 版本，再更新 server。server 兼容旧／新组件清单，旧资源目录保留，固定版本不得覆盖。

## Docker engine 升级

安装与升级由 MonkeyCodePro 的同一个 `installer` 程序负责。engine 二进制只提供运行、预检和环境管理功能，不包含安装／升级命令。发行包为每个架构携带 `installer`，并将其摘要纳入 manifest；server 原样分发，不需要宿主访问 OSS。

先将含新版 engine 资源的 server 安装包部署完成，再在宿主执行：

```bash
sudo bash -c "$(curl -kfsSL 'https://server.example/api/host/v1/upgrade.sh' || echo 'exit 1')"
```

管理员接口 `GET /api/admin/v1/engine-upgrade` 返回 `version` 与锁定版本的 `command`（URL 包含 `?version=<固定版本>`）。接口不创建待接入宿主，不签发注册令牌；升级继续使用本机已有私钥和宿主 ID。手动指定旧发行版本可用于有意回退，但该版本必须包含支持升级的 installer。

流程：

1. 引导脚本下载并校验 installer，用独立的 `monkeyai-engine-upgrade.service` 运行升级。
2. installer 使用与 Docker 安装相同的下载器，显示组件进度，下载并校验完整目标发行目录；已有同版本文件全部校验通过时复用。
3. 验证目标 engine 可执行、版本正确且预检通过。Docker/gVisor 的组件摘要必须与当前发行一致；本操作不升级 Docker daemon 或改变运行中的沙箱依赖。
4. 写入恢复记录，停止 engine 管理服务，原子切换 current 和版本配置，启动新服务。宿主 ID、私钥、额外配置字段、命令记录和持久目录均保留。
5. 新进程预检通过且后台接受签名心跳后，installer 核对 PID、版本、宿主 ID 和时间，移除升级闸门，恢复任务同步。后台宿主列表随签名心跳更新 engine 版本。

下载或预检失败时旧服务继续运行；切换或健康检查失败时恢复旧链接、原始配置和原服务状态，并尝试纠正后台版本。若回滚未完成（例如后台不可用），保留恢复记录，重跑升级命令先恢复旧版本，再重试升级。断电或进程被强制终止也通过重跑命令恢复；不要手工删除 `control/upgrade.json`。

同版本执行不会重启服务或重新注册。升级只短暂停止管理进程，不重启 Docker、不重建已有容器；进行中的创建、登录、停止等任务可能被取消并需要重试，建议等待管理操作完成后升级。旧发行目录保留供回滚，不自动清理。

```bash
journalctl -u monkeyai-engine-upgrade -u monkeyai-engine --since '-10 min'
/opt/monkeyai-engine/current/bin/monkeyai-engine version
```

代码与故障注入测试覆盖成功切换、启动失败、心跳超时、回滚失败重试和中断恢复；真实宿主的 systemd 升级及回滚仍需统一人工验收。
