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

1. `SendMessage` 返回 `async_launched` 时，Desktop 必须保存响应中的 `agentId`，不得展示原始 JSON。
2. `SendMessage` 派发卡必须在后台执行期间保持运行态，以状态点和耗时表达生命周期；右侧动作必须与普通子代理卡一致：有 child 时显示蓝色“查看子会话”，否则显示蓝色详情入口，不得使用灰色状态文案加箭头。过程详情不得在卡片内行内展开。
3. 对应 `task_notification` 到达时，必须按 `agentId` 将派发卡更新为完成或失败；其他 Agent 的通知不得误关该卡。
4. 现有显式后台 `Agent` 卡仍可在完成通知到达时回填终态和 Result。
5. 派发卡表示后台运行生命周期，最终正文仍以完成位置的新结果卡为准。
6. `SendMessage` 续跑子会话的 `tool_call`、`tool_result` 和 `error` 必须按稳定的 agent/child 身份重绑到当前派发卡的进度区，不得继续写入首次 `Agent` 卡。
7. 子事件即使早于 `SendMessage async_launched` 应答、首次运行未产生子事件，或首次 `Agent` 同步完成，也必须通过 agent ID、会话内 name alias 和原始 Agent tool call 精确关联；不同 Agent 不得串卡。
8. 完成通知必须关闭续跑子会话路由并清理运行登记，但不得把完整 Result 再复制到派发卡。

### 需求 3：后台结果卡

1. 每条结构化 `task_notification` 都必须在通知到达位置生成独立结果卡。
2. 结果卡必须显示子代理名称（缺省回退 agent ID）、任务描述、完成状态点和 Result 摘要，右侧使用蓝色“查看结果”动作。
3. 结果卡必须通过与子代理会话一致的只读弹窗展示完整 Markdown Result，不得在时间线卡片内行内展开或提供额外复制按钮。
4. completed/error/stopped 必须使用可区分的状态色，并保留无障碍状态文案。
5. Result 解析失败时必须保留剥除包装标签后的完整可见内容。
6. 通知不得转换为 `agent_message_chunk`，不得与前后模型正文合并。
7. 旧的仅含 text 的 `task_notification` 继续显示为独立系统行。
8. 历史后台 Agent 卡即使已回填，也不得吞掉新的结果卡。

### 需求 4：验证

1. Rust 测试必须覆盖通知轮开轮幂等、结果解析、有/无历史映射、失败终态、SendMessage 友好闭卡，以及续跑子会话的提前事件重绑、首次无 child、同步 Agent、并发隔离和完成清理。
2. UI 测试必须覆盖 reducer 正文隔离、旧通知兼容、工具卡与结果卡共存、展开 Markdown、失败状态和复制。
3. TypeScript 类型检查和相关 Rust/UI 聚焦测试必须通过。

## 本次范围外

- 修改 Agent 协议或 Agent 代码。
- 展示续跑子代理的模型/process 文本：Agent collector 当前不会向 Desktop 转发后台 `model_delta`，Desktop-only 无法恢复未发送的数据。
- 将 SendMessage 最终正文复制到旧派发卡。
- 重构用户发送与通知轮的极小 RPC 竞态。
- 为旧 Agent 合成缺失的 `turn/started`。
