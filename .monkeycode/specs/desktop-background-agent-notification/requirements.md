# Desktop 后台 Agent 通知适配需求

## 简介

Agent `163a418` 已为自主后台通知轮提供 `turn/started { source: "notification" }`。本修复仅修改 Desktop：接入通知轮生命周期，并把 `task_notification` 渲染为独立、可展开的子代理结果卡，禁止协议原文混入助手正文。

## 需求

### 需求 1：通知轮生命周期

1. 收到 `turn/started(source=notification)` 时，空闲会话必须进入 running、递增轮次、生成 `task-started` 并更新 sidecar/session status。
2. 重复 `turn/started` 必须幂等，不得重复开轮。
3. 后续 `turn/stopped` 必须沿用现有收尾路径生成唯一 `task-ended`。
4. 未知会话或未知 source 不得破坏已有会话状态。

### 需求 2：后台任务派发

1. `SendMessage` 返回 `async_launched` 时，工具卡必须以友好文案完成，不得展示原始 JSON。
2. 现有显式后台 `Agent` 卡仍可在完成通知到达时回填终态和 Result。
3. `SendMessage` 的派发卡只表示“已转后台”，最终结果以完成位置的新结果卡为准。

### 需求 3：后台结果卡

1. 每条结构化 `task_notification` 都必须在通知到达位置生成独立结果卡。
2. 结果卡必须显示子代理名称（缺省回退 agent ID）、任务描述、完成状态和 Result 摘要。
3. 结果卡必须支持展开完整 Markdown Result 和复制。
4. completed/error/stopped 必须使用可区分的状态文案和状态色。
5. Result 解析失败时必须保留剥除包装标签后的完整可见内容。
6. 通知不得转换为 `agent_message_chunk`，不得与前后模型正文合并。
7. 旧的仅含 text 的 `task_notification` 继续显示为独立系统行。
8. 历史后台 Agent 卡即使已回填，也不得吞掉新的结果卡。

### 需求 4：验证

1. Rust 测试必须覆盖通知轮开轮幂等、结果解析、有/无历史映射、失败终态和 SendMessage 友好闭卡。
2. UI 测试必须覆盖 reducer 正文隔离、旧通知兼容、工具卡与结果卡共存、展开 Markdown、失败状态和复制。
3. TypeScript 类型检查和相关 Rust/UI 聚焦测试必须通过。

## 本次范围外

- 修改 Agent 协议或 Agent 代码。
- 持久化 Desktop 的 agent→工具卡映射。
- 将 SendMessage 最终结果强制回填到旧派发卡。
- 重构用户发送与通知轮的极小 RPC 竞态。
- 为旧 Agent 合成缺失的 `turn/started`。
