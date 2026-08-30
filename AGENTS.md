# Git 提交与推送规则

- 禁止直接向 `main` 分支提交或推送代码。
- MonkeyCode：本地仓库路径为 `/Users/caiqj/project/company/xiaomakuaiz/MonkeyCode`，所有提交和推送都必须使用 `feat/design-preview-workbench` 分支。
- OhMyAgent：本地仓库路径为 `/Users/caiqj/project/company/xiaomakuaiz/MonkeyCode/agent`，所有提交和推送都必须使用 `feature/monkeydesign-integration` 分支。
- 推送前必须确认当前仓库和分支正确；通过 Pull Request 合并到 `main`。

## `ohmydesign-tmp` 例外

- 远程仓库：`git@github.com:ACaiCaiOnTheRoadSide/ohmydesign-tmp.git`。
- 本地仓库路径：`/Users/caiqj/project/company/monkeydesign`。
- 仓库作用：MonkeyDesign 的可信设计能力 Package，维护 Scenario、Pipeline、Contract、Skill rules、模板及静态缩略图、结构化模板搜索索引、Registry、完整性校验和发布测试，供 OhMyAgent 与 MonkeyCode 设计流程加载使用。
- 固定的设计流程与内容收集规则应维护在此 Package 的 Skill rules 中，不得硬编码到 OhMyAgent 或 MonkeyCode。
- 此仓库不适用上面的功能分支与 Pull Request 规则；代码直接提交并推送到 `main`，不要创建长期功能分支。
- 提交前必须确认当前仓库为 `ohmydesign-tmp`、当前分支为 `main`，并运行与改动相匹配的 Package 校验；不得提交 `.DS_Store` 等本地文件。

## 启动 MonkeyCode Debug App（开发与测试）

### 1. 编译 Agent（必须用最新功能分支代码）

每次 Agent 代码有改动都必须重新编译，Debug App 不会自动重新构建 Agent：

```bash
cd /Users/caiqj/project/company/xiaomakuaiz/MonkeyCode/agent
go build -trimpath -ldflags "-s -w -X github.com/chaitin/ohmyagent/internal/buildinfo.Version=$(git rev-parse --short HEAD)" \
  -o ../desktop/target/debug/ohmyagent ./cmd/ohmyagent
```

### 2. 启动 Debug App（ui-next 热加载）

```bash
cd /Users/caiqj/project/company/xiaomakuaiz/MonkeyCode/desktop
MC_OHMYAGENT_BIN="$PWD/target/debug/ohmyagent" \
cargo tauri dev --config tauri.dev-next.conf.json --no-watch
```

### 启动规则与注意事项

- 必须使用 `tauri.dev-next.conf.json`（Vite 端口 `1421`）；不要使用旧的 `tauri.dev.conf.json`。
- ui-next 前端改动通过 Vite HMR 即时生效，无需重启。
- `--no-watch` 禁用了 `tauri dev` 的 Rust 文件监听：`desktop/src` 的 Rust 改动不再自动重编，需手动重启 Debug App。必须加 `--no-watch`，否则 watcher 会监听整个 `desktop/`（含 `node_modules/`、`target/`），别的会话跑测试/写文件就会触发重建导致 App 反复重启消失。
- Agent 改动不会自动生效：重编 Agent 二进制后必须重启 Debug App。
- 重启 Debug App 前先停止旧的 `tauri dev` 进程组，避免多个实例同时监听端口 `1421` 和 Agent 会话互相干扰；安装版 `/Applications/MonkeyCode.app` 只用于正式发布行为测试。
- 启动日志位于 `/tmp/monkeycode-ui-next-dev.log`。
