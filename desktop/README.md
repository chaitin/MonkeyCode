# desktop — MonkeyCode 本地桌面客户端(Tauri 壳)

单引擎架构:壳(Rust)承载 UI(`ui/` React SPA,构建产物随壳分发)与
全部平台服务(百智云/云端任务/文件浏览/上传/浏览器扩展桥),引擎
**ohmyagent** 是壳拉起的 stdio JSON-RPC 子进程(独立上游仓库,不 fork,
版本经仓库根 agent/ submodule 钉死)。

分层、契约(帧词汇/能力/IPC/配置所有权/会话状态机)、浏览器桥与
上游缺口清单见 **[ARCHITECTURE.md](./ARCHITECTURE.md)**(权威文档)。

## 构建与运行

前置:Rust 工具链、Node 22、Go 1.26+(编译引擎)、Linux 需 webkit2gtk。

```bash
# 引擎源码位置(独立仓库)
export OHMYAGENT_SRC=~/dev/chaitin/ai/monkeycode/ohmyagent

cd ui && npm ci && npm run build   # 生成 uidist(cargo build 的前置)
cd .. && cargo build && ./target/debug/monkeycode-desktop

# HMR 开发(devUrl overlay)
npx tauri dev --config tauri.dev.conf.json

# 测试(含浏览器桥假扩展、MCP 冒烟)。E2E 标 #[ignore]:缺引擎时如实报
# ignored,不冒充 passed;显式选中后缺二进制即硬失败。
cargo test
MC_OHMYAGENT_BIN=$OHMYAGENT_SRC/bin/ohmyagent cargo test -- --include-ignored
cd ui && npm test
```

开发运行找不到引擎时,壳按 `MC_OHMYAGENT_BIN` → 应用同目录 → PATH →
`~/.local/bin` 兜底查找。

## 打包

```bash
make macos            # universal .app/.dmg(在 Mac 上执行)
make macos-release    # + 签名 updater 产物(需 TAURI_SIGNING_PRIVATE_KEY)
make windows          # NSIS 安装包(在 Windows 上执行;或走 CI)
make linux            # deb + rpm + AppImage(在 Linux 上执行;AppImage 需 xdg-utils)
```

打包配置文件一律叫 `bundle.<平台>.conf.json`,**不能**叫
`tauri.<平台>.conf.json`——后者是 Tauri 的平台自动合并约定,那个名字一存在
就会被并进该平台上的**每次** `cargo build/check`,把只属于打包的
`active`/`externalBin`/`resources` 拖进普通开发构建(实测直接报
`resource path binaries/ohmyagent-<triple> doesn't exist`)。命名由
`scripts/check_bundle_configs.py` 守住。

Linux 自更新只对 AppImage 生效(updater 是原地替换 AppImage 文件);
deb/rpm 由 apt/dnf 升级,壳侧对非 AppImage 运行不提示更新。

引擎 sidecar 由 make 从 `OHMYAGENT_SRC` 编译。externalBin 声明在各平台
overlay 而非基础配置(基础配置带 sidecar 会让普通 `cargo check` 也强依赖
宿主 triple 的二进制);"任何包都带引擎"由 `make check-bundle-configs`
(`scripts/check_bundle_configs.py`,CI 同跑)强制,缺二进制打包直接失败。
CI:desktop-{macos,windows,win7}.yml
(win7 通道用 go-win7 补丁工具链 + 固定版 WebView2)。

## 浏览器扩展

`../browser-extension/` 随包分发(设置页引导加载);扩展经
`ws://127.0.0.1:{7440-7449}/ext` 连壳内桥,配对码在设置页展示。
browser_* 工具经壳内 MCP server 暴露给引擎；`Mcp-Session-Id` 与 Agent
调用 `_meta.session_id` 共同标识浏览器现场，父任务/子 Agent 可并行且标签页
归属隔离，同一现场内按调用顺序执行。
