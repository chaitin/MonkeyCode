# 宿主安装与发行

后台入口为「系统设置 → 宿主管理」。生成命令后在所选架构的 Linux 宿主执行即可。需要 root、systemd、cgroup v2、curl、SHA-256 工具和可信 HTTPS 后台地址。支持 amd64、arm64；缺少系统依赖时自动安装仅支持 Debian/Ubuntu。

## 先准备后台发行物

安装引导由本后台提供。`dependencies.lock.json` 固定官方下载地址、版本、归档 SHA-256 和提取成员，目前使用 containerd static v2.4.2、CNI v1.9.1、gVisor release-20261026.0。摘要来自对应官方 GitHub Release 元数据，更新时需要重新核对来源并完成兼容性验收。

使用 Python 3.11+、curl 和 Go 1.27 准备双架构发行物：

```bash
cd monkeyai/engine
python3 scripts/dependencies.py --arch amd64 --output dist/dependencies/amd64
python3 scripts/dependencies.py --arch arm64 --output dist/dependencies/arm64
python3 scripts/package.py --version v1.0.0 --arch amd64 \
  --dependencies dist/dependencies/amd64 --output dist/releases
python3 scripts/package.py --version v1.0.0 --arch arm64 \
  --dependencies dist/dependencies/arm64 --output dist/releases
```

下载脚本先校验归档摘要，只提取白名单中的普通文件，拒绝链接、重复成员和错误 ELF 架构，写入 `provenance.json`。打包脚本交叉构建 engine，校验来源记录与依赖内容一致，生成 `dist/releases/<version>/<arch>/manifest.json` 并保留来源记录。不使用 latest，不覆盖已有依赖目录或发行版本。修改源码或依赖后使用新的发行版本号。

gVisor 除 runsc 和 shim 外，还包含六个必需辅助程序，安装在 runsc 同目录下的 `gvisor-bin/`。仅复制 runsc 主文件不能构成完整安装。后台只对固定白名单组件提供下载，客户端按固定 manifest 摘要和各文件 SHA-256 校验。

把 `dist/releases` 目录以只读方式提供给后台，配置：

```dotenv
MONKEYAI_PUBLIC_URL=https://your-console.example
MONKEYAI_ENGINE_RELEASE_DIR=/opt/monkeyai-engine-releases
MONKEYAI_ENGINE_VERSION=v1.0.0
```

使用 Compose 时，在 backend 服务的部署覆盖文件中挂载：

```yaml
services:
  backend:
    environment:
      MONKEYAI_ENGINE_RELEASE_DIR: /opt/monkeyai-engine-releases
      MONKEYAI_ENGINE_VERSION: v1.0.0
    volumes:
      - ./engine/dist/releases:/opt/monkeyai-engine-releases:ro
```

先应用 `000035_engine_hosts` 迁移，再发布后台和管理页面。若地址未启用可信 HTTPS，或者对应架构发行物未配置，后台返回明确错误，不生成不可用的命令。自签名／内网证书需要先在宿主安装组织 CA；安装器不提供跳过 TLS 校验的开关。

## 执行与检查

在后台添加宿主、复制完整命令并执行。该命令包含一次性凭据，有效期 30 分钟；只对应一台宿主。完成后后台会展示在线状态和各项预检结果。

```bash
systemctl status monkeyai-engine monkeyai-containerd
journalctl -u monkeyai-engine -u monkeyai-containerd --since '-10 min'
sudo env PATH=/opt/monkeyai-engine/current/bin:$PATH \
  /opt/monkeyai-engine/current/bin/monkeyai-engine doctor \
  --architecture amd64 --data-dir /var/lib/monkeyai-engine/data \
  --cni-dir /opt/monkeyai-engine/current/cni
```

安装器不会格式化磁盘。运行云电脑前需要为专用数据目录准备 XFS 项目配额。当前仅提供宿主接入、预检和上报，云电脑驱动尚未开放。

## 失败恢复与撤销

- 下载／校验失败时不执行该文件，清理暂存下载；已创建的身份和配置保留。
- 注册响应丢失时使用同一私钥重试；不要删除 `identity.key`。同一公钥可在令牌有效期内重试。
- 已保存 host ID 后再次运行同版本、同配置命令修复服务安装，保留现有身份；不会切换到命令对应的另一台待接入记录。多余待接入记录可在后台撤销。
- 修复安装暂停既有 engine 以避免心跳挑战竞争；若上报失败，会尝试恢复原先运行中的服务，并返回安装错误。
- 不同版本、后台或数据目录需要独立的升级／迁移流程，本期拒绝隐式覆盖。
- 后台撤销后，服务无法继续认证，记录显示已撤销。撤销不停止可能存在的用户工作负载，不删除数据，也不卸载系统软件。
- 如仅需停用管理服务，执行 `sudo systemctl disable --now monkeyai-engine`；containerd 与持久数据独立保留。

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

测试只接受固定的 `engine-installer-test` profile，要求其尚未安装 engine。它创建临时数据库 schema、HTTPS 服务与测试 CA，在 VM 内执行后台生成的完整命令，验证重复安装、身份和权限、故障恢复、服务与整机重启、既有 containerd 共存、配额预检和撤销。测试会重启该 VM；Colima 启动脚本主动停止其 containerd，因此整机重启后由测试恢复原有 containerd，再核对文件摘要及并存状态。结束时清理测试 schema、engine 文件和测试 CA，保留通过 apt 安装的系统依赖。网络上只开放宿主 API，管理调用在测试进程内完成。

验收结果与待验证范围记录在[实施计划](../design/engine-installer-plan.md)。安装验收不代表云电脑工作负载、XFS 配额强制执行或生产发布完成。

## 可选公网出站

新版完整发行物包含 CNI ptp。安装仍默认隔离网络，不写入公网配置或开启 IPv4 转发；启用步骤、规则边界和网络变更流程见 [网络说明](NETWORK.md)。已发布旧版本不得覆盖，升级需生成新的固定版本及清单。
