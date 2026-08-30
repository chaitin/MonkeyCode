# Desktop 后台代理在场感知与停止需求

## 简介

`desktop-background-agent-notification`（已完成）打通了后台派发与完成通知的渲染链路，但会话的"活动"模型仍是二元的（running/空闲）：派发轮 `turn/stopped` 后 RunBar 消失、轮末分隔线宣告"回合结束"，唯一的"仍在工作"信号是一张会被滚出视野的派发卡。用户因此误以为对话已结束，随后的通知轮"凭空复活"造成困惑；离开会话或应用后则完全错过结果。此外，后台代理一旦转入后台，用户没有任何停止入口。

约束：不修改 Agent。引擎 `163a418` 现状已核实——transport 无任何 `task/*` 方法，`session/state`/`session/list`/`turn/stopped` 均不含任务信息；`todo_update` 事件的 `ChecklistItems()` 显式排除非手工任务（task_tools.go:517），注释明言 "Background tasks are excluded: hosts already surface those via task notifications"。即：宿主从派发回执与完成通知自行推导后台状态是引擎的设计意图，本 spec 是该意图在 Desktop 的补全。停止能力引擎侧仅有模型工具 `TaskStop`，宿主只能经 `session/publishEvent` 由模型中介触发（best-effort）。

## 需求

### 需求 1：会话后台第三态（P1）

1. Driver 必须能从 `SubagentState` 的 `background_agents` 与 `active_continuations` 按父会话派生"未了结后台代理"集合（含 agentId、父工具卡 tcId、展示摘要）。
2. `turn/stopped` 正常收尾时，若该会话 pending 集合非空，sidecar status 必须写 `background` 而非 `idle`，并照常广播 `session-event`。
3. `task_notification` 清理后台登记后，若会话空闲且 pending 已空，状态必须回写 `idle`。
4. 用户中断/错误收尾维持现有状态词（`interrupted`/`error`），pending 的存在仍由对话内状态条表达（需求 2），不因状态词覆盖而丢失。
5. `SessionStatus` 新增 `Background` 变体经 ts-rs 导出，前端不得手写该类型。

### 需求 2：对话内在场呈现（P1）

1. Composer 展示层必须区分前台运行工具与后台运行卡：`runningTools` 不再计入 `background` 卡（修复后续轮次 runningLabel 被钉住的后台卡误报为"执行工具中"），新增 `runningBackground` 计数。
2. 主循环空闲（`!running`）且 `runningBackground > 0` 时，必须在 RunBar 位置渲染常驻后台状态条：显示任务数与摘要、运行耗时，明示"完成后将在此继续汇报"；输入框保持可用；点击可定位到对应派发卡或打开其详情弹窗。
3. 状态条必须与 RunBar 视觉可区分（无主循环停止按钮、更安静的样式），并受引擎连接状态门控（断连不得显示"运行中"）。
4. `task-ended` 归约时，若消息流中仍存在 `run+background` 工具卡，轮末系统行必须使用后台变体文案键（如 `chat.sys.turnEndBg`），归约层只产 key 不产成品文案。
5. 通知轮到达后，状态条随派发卡终态回填自然消退，不得残留。

### 需求 3：僵尸对账与重启恢复（P1）

1. Driver 必须把 pending 集合持久化进 sidecar（派发时写入、通知清理时移除），使侧栏无需打开会话即可感知，且重启后有对账依据。
2. 引擎进程更替后（后台 goroutine 必然已死），会话打开时若 sidecar 存在遗留 pending，driver 必须按记录的 tcId 追加合成的失败终态帧（"已中断"语义、复用冷修复的 journal 追加机制）关闭僵尸后台卡，清空 sidecar pending，并把遗留的 `background` 状态归一。
3. 对账后 UI 不得出现永远转圈的状态条或后台卡；正常存活的引擎会话重开必须不受对账影响。
4. 中文启动回执的协议嗅探（reduce.ts）必须降级为兼容旧 journal 的 fallback：新帧携带结构化后台标记，归约优先按结构化字段判定。

### 需求 4：会话外在场呈现（P2）

1. 侧栏会话列表必须对 `background` 状态渲染可辨识的徽标（区别于 running 与 idle）。
2. 结构化 `task_notification` 落地时，若窗口失焦或目标会话非当前会话，必须发送系统通知（任务名/状态），点击聚焦窗口并定位到该会话的结果卡。
3. 通知落在非当前会话时必须置未读标记，打开会话后清除。
4. 系统通知权限缺失或被拒时静默降级，不得报错打断。

### 需求 5：停止后台代理（P3，best-effort）

1. 后台状态条任务行与派发卡详情弹窗必须提供"停止"入口，采用二段式轻确认，确认文案须提示停止后不可恢复（引擎 stopped 状态的 agent 不能 resume）。
2. 停止实现为 `session/publishEvent` 中介：幂等 event_id，消息点名 `TaskStop(task_id=<agentId>)` 并要求模型仅执行停止；driver 手中有精确 agentId，不得要求模型自行查表。
3. Driver 必须把 host 事件轮（非 notification 的自主 source）接入现有开轮/收轮生命周期，UI 以轻量形式呈现该轮。
4. Driver 必须以 event_id 关联观察该轮是否实际发生 `TaskStop` 工具调用：超时未见须回弹停止入口并明示失败，不得静默假装已停止。
5. `publishEvent` 返回 `busy`（主轮进行中）时须提示稍后重试；停止成功的终态经现有通知管道（stopped 状态的结果卡与派发卡回填）呈现，不得新增终态路径。
6. 主轮 RunBar 的停止与后台代理停止语义分离：前者只停当前轮次，不得合并为"停止一切"。

### 需求 6：验证

1. Rust 测试必须覆盖：pending 派生与状态词流转（complete/interrupted × pending 有无）、通知清理回写、sidecar pending 持久化、引擎更替对账（合成终态帧 + 状态归一）、host 事件轮开轮/收轮、TaskStop 观察超时。
2. UI 测试必须覆盖：presentation 拆分计数、状态条渲染条件与断连门控、轮末变体文案键、结构化后台标记与嗅探 fallback、停止入口二段确认与回弹。
3. TypeScript 类型检查、相关 Cargo/Vitest 聚焦测试、`git diff --check` 必须通过。

## 本次范围外

- 修改 Agent 协议或代码；确定性停止通道（待引擎 caps 提供 `task/stop` 后按探测切换直通，publishEvent 降为 fallback）。
- 展示续跑子代理的模型/process 文本（collector 不转发，Desktop-only 无法恢复）。
- 轮次将结束时向模型注入"后台未了结"收尾话术约定（引擎侧 follow-up）。
- 停止请求的自动排队重试（busy 时由用户重试）。
- 云端任务流的后台状态呈现。
