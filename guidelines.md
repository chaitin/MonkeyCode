# MonkeyAI 与 MonkeyCode

MonkeyAI 提供团队 AI 办公工作台。仓库同时包含 MonkeyCode 服务端和客户端。

## 目录

- `monkeyai/` 部署 MonkeyAI。Go 1.27 后端提供管理和 Agent API，engine 驱动云端执行环境，web 和 landing 提供管理页面与产品站。设备登记见 [endpoint 模块地图](monkeyai/backend/internal/endpoint/guidelines.md)，设备中转见 [relay 模块地图](monkeyai/backend/internal/relay/guidelines.md)。
- `backend/` 和 `frontend/` 分别提供 MonkeyCode 的 Go 服务端与 Web 前端。
- `desktop/` 使用 Rust 和 Tauri 2 构建桌面客户端。`browser-extension/` 连接桌面内核，按用户授权转发浏览器调试命令。
- `mobile/` 使用 Expo 和 React Native 构建移动客户端。
- `agent/` 和 `plugins/` 分别接入 OhMyAgent 和 MonkeyCode 官方插件子模块。
- `docs/` 保存架构、实施计划和测试文档。

## 配置与术语

- `monkeyai/docker-compose.yml` 编排 PostgreSQL、迁移与应用服务。
- `.gitmodules` 声明两个子模块的路径和来源。
- [领域术语](CONTEXT.md) 与 [后端上下文](monkeyai/backend/CONTEXT.md) 定义身份、资源与授权边界。
