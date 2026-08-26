# desktop — MonkeyCode 本地桌面客户端(Tauri 壳)

单引擎架构:壳(Rust)承载 UI(`ui-next/` React SPA,构建产物随壳分发)与
全部平台服务(百智云/云端任务/文件浏览/上传/浏览器扩展桥/装机遥测),
引擎 **ohmyagent** 是壳拉起的 stdio JSON-RPC 子进程(独立上游仓库,
不 fork,版本经仓库根 agent/ submodule 钉死)。

分层、契约(帧词汇/能力/IPC/配置所有权/会话状态机/引擎生命周期)、
浏览器桥、WSL 运行环境与上游缺口清单见
**[ARCHITECTURE.md](./ARCHITECTURE.md)**(权威文档)。

## 构建与运行

前置:Rust 工具链、Node 22、Go 1.26+(编译引擎)、Linux 需 webkit2gtk。

**UI 工程是 `ui-next/`**——`tauri.conf.json` 的 `beforeBuildCommand.cwd` 指的
就是它,`make macos/windows/linux` 打进包里的也是它的产物。`ui/` 是待退役的
旧工程,已不参与打包,别拿它去生成 uidist:两个工程的 outDir 同为
`../uidist` 且都 `emptyOutDir`,后 build 的那个生效,建错了的症状是
"改了半天跑起来还是旧界面"。

```bash
# 引擎源码位置(独立仓库)
export OHMYAGENT_SRC=~/dev/chaitin/ai/monkeycode/ohmyagent

cd ui-next && npm ci && npm run build   # 生成 uidist(cargo build 的前置)
cd .. && cargo build && ./target/debug/monkeycode-desktop

# HMR 开发(devUrl overlay;dev-next 的 devUrl 指 1421、cwd 指 ui-next)
npx tauri dev --config tauri.dev-next.conf.json

# 测试(含浏览器桥假扩展、MCP 冒烟)。E2E 标 #[ignore]:缺引擎时如实报
# ignored,不冒充 passed;显式选中后缺二进制即硬失败。
cargo test
MC_OHMYAGENT_BIN=$OHMYAGENT_SRC/bin/ohmyagent cargo test e2e_ -- --ignored --test-threads=1
cd ui-next && npm test
```

开发运行找不到引擎时,壳按 `MC_OHMYAGENT_BIN` → 应用同目录 → PATH
(含 `~/.local/bin`)兜底查找;WSL 运行环境的 Linux 引擎按
`MC_OHMYAGENT_LINUX_BIN` → 应用同目录查找,不搜 PATH。

## 打包

```bash
make macos                 # 编译并生成强制 unsigned 的 universal .app/.dmg
make macos-release-build   # 注入 tag 版本后构建 unsigned 发布候选,供测试
make macos-release         # 不重新编译;签名/公证刚测试的构建并生成 updater
make macos-notarize-dmg    # 只重试最终 DMG 公证/staple,不重新 bundle
make windows               # NSIS 安装包(在 Windows 上执行;或走 CI)
make windows-release  # + 签名 updater 产物
make linux            # deb + rpm + AppImage(在 Linux 上执行;AppImage 需 xdg-utils)
make linux-release    # + 签名 updater 产物
```

macOS 发布构建要求当前提交带 `vYYMMDDNN` tag，并设置：

```bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat /path/to/updater.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD='...'
export APPLE_SIGNING_IDENTITY='Developer ID Application: BEIJING CHAITIN TECHNOLOGY Co.,Ltd. (8Z56KX83T3)'
export APPLE_API_KEY='...'
export APPLE_API_ISSUER='...'
export APPLE_API_KEY_PATH="$HOME/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8"
```

本地签名使用登录钥匙串中的 Developer ID 私钥；CI 可额外提供
`APPLE_CERTIFICATE` 和 `APPLE_CERTIFICATE_PASSWORD`，由 Tauri 临时导入
`.p12`。推荐流程是先运行 `macos-release-build`，测试其 unsigned `.app`；
确认通过后运行 `macos-release`。后者通过 `tauri bundle` 复用已有 universal
二进制，不重新编译 Rust/Go/UI，只重新生成签名后的 `.app`、updater 和 DMG，
最后公证/staple DMG 容器并执行 Gatekeeper 验收。候选构建会记录 binary、
unsigned `.app`、sidecar、UI/resources 和 bundle 配置的 SHA-256 指纹；测试后
任一输入变化或 `.app` 已被签名，release 都会拒绝继续。公证网络失败时只需
重跑 `macos-notarize-dmg`。CI 同样将 unsigned build 与签名拆为不同 step，
编译进程不会拿到 Apple/updater 私钥。

打包配置文件一律叫 `bundle.<平台>.conf.json`,**不能**叫
`tauri.<平台>.conf.json`——后者是 Tauri 的平台自动合并约定,那个名字一存在
就会被并进该平台上的**每次** `cargo build/check`,把只属于打包的
`active`/`externalBin`/`resources` 拖进普通开发构建(实测直接报
`resource path binaries/ohmyagent-<triple> doesn't exist`)。命名由
`scripts/check_bundle_configs.py` 守住。

Linux 自更新只对 AppImage 生效(updater 是原地替换 AppImage 文件);
deb/rpm 由 apt/dnf 升级,壳侧对非 AppImage 运行不提示更新。
更新检查统一走 UI 侧节流闸门(挂载/切前台触发 + 30 分钟节流 + 4 小时
兜底,ui-next/src/features/update/useUpdate.ts)。

引擎 sidecar 由 make 从 `OHMYAGENT_SRC` 编译。externalBin 声明在各平台
overlay 而非基础配置(基础配置带 sidecar 会让普通 `cargo check` 也强依赖
宿主 triple 的二进制);"任何包都带引擎"由 `make check-bundle-configs`
(`scripts/check_bundle_configs.py`,CI 同跑)强制,缺二进制打包直接失败。
Windows 包另经 bundle.resources 附带 `ohmyagent-linux`(WSL 运行环境用,
externalBin 装不下第二平台),nsis 配置缺它同样被守卫拦下。
CI:desktop-{check,macos,windows,linux}.yml
(check 跑契约守卫脚本与两侧测试)。

## WSL 运行环境(Windows)

设置页「运行环境」可把引擎宿主切到 WSL 发行版(`kernel_env=wsl:<发行版>`):
引擎(`ohmyagent-linux`)spawn 进发行版,workdir/repo 浏览/上传全链路按
guest 路径工作,壳经 `\\wsl$` 视图访问文件;浏览器扩展桥要求 WSL
networking-mode=mirrored。契约与不变量见 ARCHITECTURE.md「WSL 运行环境」。
Linux 开发机可用 `MC_WSL_EXE=scripts/fake-wsl.sh` 冒烟完整链路。

## 浏览器扩展

`../browser-extension/` 随包分发(设置页引导加载);扩展经
`ws://127.0.0.1:{7440-7449}/ext` 连壳内桥,配对码在设置页展示。
browser_* 工具经壳内 MCP server 暴露给引擎；`Mcp-Session-Id` 与 Agent
调用 `_meta.session_id` 共同标识浏览器现场，父任务/子 Agent 可并行且标签页
归属隔离，同一现场内按调用顺序执行。
