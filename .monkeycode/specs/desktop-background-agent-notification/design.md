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

`tool_result` 若工具为 `SendMessage` 且结果是 `async_launched`，以友好文案完成派发卡：

```text
后台代理已继续执行，完成后将在对话中显示结果卡
```

不登记新的 agent→tool 映射；结果卡本身是最终结果的权威展示位置。

### 2.3 结构化完成帧

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

结构化 `task_notification` 始终追加该 item，并把 `streamKind` 断开，保证前后模型分片不会合并。旧的纯 text 通知仍归约为 `SysItem(tag=notify)`。若旧 Agent 工具卡带 `backgroundNoticePending`，只清除该标志，不吞结果卡。

### 3.2 结果卡

新增 `BackgroundAgentResultCard`：

- 外框、圆角和状态点复用现有 ToolCard 视觉语言；
- 收起态显示“后台子代理”、名称、状态、任务描述和 Result 第一条有效摘要；
- 点击标题行展开完整 Markdown；
- 支持本地链接、图片回读和复制完整结果；
- error/stopped/completed 使用失败、警告、成功状态色；
- 时间线为结果卡提供独立行与高度估算。

## 4. 兼容策略

- Agent 不需要修改；Desktop 只消费新 capability。
- 历史 journal 的纯 text `task_notification` 保持系统行展示。
- 解析异常不会退回助手正文。
- 无内存映射、SendMessage 续跑和 Desktop 恢复后的通知都能直接形成结果卡。

## 5. 测试

- Rust：通知开轮幂等、turn/stopped 回归、有/无映射结果、错误终态、SendMessage async。
- UI：结构化通知断流、旧通知兼容、结果卡共存、展开、复制、失败状态和时间线。
- 门禁：相关 Cargo tests、Vitest、TypeScript typecheck、diff check。
