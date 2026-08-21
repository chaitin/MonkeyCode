# Desktop 后台 Agent 通知适配设计

## 1. 总体方案

不修改 Agent。Desktop 使用 Agent `163a418` 的协议顺序：

```text
turn/started(source=notification)
task_notification
模型后续事件
turn/stopped
```

通知轮接入现有会话生命周期；后台完成通知新增独立 `BackgroundAgentResultItem`，视觉复用子代理/工具卡语言，但不伪装成一次新工具调用。

## 2. Rust Driver

### 2.1 通知轮开轮

在 `desktop/src/driver/normalize.rs::handle_notification` 处理 `turn/started`：

- 仅处理 `source=notification`；
- 通过 engine session ID 反查 shell session ID；
- 会话空闲时设置 `running=true`，清理轮内临时状态并递增 `turn`；
- 生成 `task-started`，更新 sidecar 与 session status；
- 会话已经 running 时幂等忽略。

`turn/stopped` 复用现有收尾逻辑，不新增第二套状态机。

### 2.2 SendMessage 派发结果

`tool_result` 若工具为 `SendMessage` 且结果是 `async_launched`：

- 解析响应中的 `agentId`；
- 在派发卡闭卡前生成 `background_agent` 进度帧；
- reducer 保存 `backgroundAgentId`，将派发回执解释为后台运行态；
- 原始 JSON 不进入工具卡，运行/终态由状态点和耗时表达；
- 右侧入口复用普通子代理卡的蓝色文字动作：有 `childSessionId` 时显示“查看子会话”，否则显示详情入口，不再使用灰色状态文案加箭头；
- 后台过程不再行内撑开工具卡：有 `childSessionId` 时打开真实子代理会话弹窗，否则以同一弹窗外壳展示当前已归约的过程详情。

收到结构化 `task_notification` 后，reducer 按 `agentId` 精确关闭仍在运行的派发卡，但不把完整结果复制进派发卡。完成位置的独立结果卡仍是最终正文的权威展示。

### 2.3 续跑过程事件重绑

Agent 的续跑 child session 沿用稳定 `childSessionId`，但其事件仍携带首次 `Agent` 的 `parent_session_id` / `parent_tool_call_id`。Desktop 建立以下精确关联：

```text
agentId → 首次 Agent 父会话/工具卡
(parent session, name) → agentId
childSessionId → agentId
agentId → 当前 SendMessage 父会话/工具卡
```

`SendMessage tool_call` 到达时即按 `agent_id` 或会话内 name alias 建立 provisional continuation，保证早于 `async_launched` 应答的 child 事件也能重绑。`agent_result` 和首次后台应答统一登记 Agent identity，因此同步完成后被再次激活的 Agent 也适用。首个续跑事件按 child identity 或旧 parent stamp 找到 Agent，将路由切换到当前 `SendMessage` 卡，并在需要时重开/物化 child 会话。

现有 `subagent_feed` 将 Agent 实际转发的 `tool_call`、`tool_result`、`error` 归一化为派发卡进度行。Agent collector 会过滤后台 `model_delta`，所以 Desktop-only 不虚构也无法展示续跑模型/process 文本。

`task_notification` 清理 continuation 路由和 child 运行态；完整 Result 只进入独立结果卡。

### 2.4 结构化完成帧

`frame.rs` 生成：

```json
{
  "sessionUpdate": "task_notification",
  "agentId": "...",
  "agentName": "...",
  "description": "...",
  "status": "completed|error|stopped",
  "result": "...",
  "text": "简短兼容摘要"
}
```

`normalize.rs` 从通知 `message` 的 `Result:` 段取正文；失败时剥除 `<task-notification>` 包装后保留完整内容。现有历史后台 Agent 映射仍用于回填旧卡，但不再由该路径产生或吞掉系统通知。结构化结果帧始终追加到通知实际到达的会话。

## 3. UI

### 3.1 数据模型与 reducer

新增 `BackgroundAgentResultItem`：

```ts
{
  kind: "background-result";
  agentId: string;
  agentName: string;
  description: string;
  status: string;
  result: string;
  text: string;
  timestamp?: number;
}
```

结构化 `task_notification` 始终追加该 item，并把 `streamKind` 断开，保证前后模型分片不会合并。旧的纯 text 通知仍归约为 `SysItem(tag=notify)`。若存在相同 `backgroundAgentId` 的运行中派发卡，先将其更新为完成/失败；若旧 Agent 工具卡带 `backgroundNoticePending`，只清除该标志，不吞结果卡。

### 3.2 结果卡

新增 `BackgroundAgentResultCard`：

- 外框、圆角和状态点复用现有 ToolCard 视觉语言；
- 收起态保持单行，显示“子代理结果”、任务描述和状态点；
- 右侧使用与普通子代理卡同款的蓝色“查看结果”，点击后打开只读详情弹窗，时间线卡片本身始终保持单行；
- 弹窗支持本地链接和图片回读；Markdown 正文可直接选择复制，不提供额外复制按钮；
- error/stopped/completed 使用失败、警告、成功状态色；
- 时间线为结果卡提供独立行与高度估算。

### 3.3 统一详情弹窗

抽出通用 `DetailModal` 外壳，由子代理会话、后台过程详情和后台结果详情共用：统一尺寸、滚动区、关闭按钮、遮罩和 Esc 层栈。卡片详情通过 portal 挂到页面根部，避免被卡片的 `overflow-hidden` 裁切。

## 4. 兼容策略

- Agent 不需要修改；Desktop 只消费新 capability。
- 历史 journal 的纯 text `task_notification` 保持系统行展示。
- 解析异常不会退回助手正文。
- 无内存映射、SendMessage 续跑和 Desktop 恢复后的通知都能直接形成结果卡。

## 5. 测试

- Rust：通知开轮幂等、turn/stopped 回归、有/无映射结果、错误终态、SendMessage async，以及已有/首次 child 的提前事件重绑、同步 Agent identity、并发隔离和通知清理。
- UI：结构化通知断流、旧通知兼容、结果卡共存、展开、复制、失败状态和时间线。
- 门禁：相关 Cargo tests、Vitest、TypeScript typecheck、diff check。
