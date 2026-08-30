# Desktop 后台代理在场感知与停止设计

## 1. 总体方案

不修改 Agent。把"主循环空闲但后台代理未了结"提升为会话第三态，driver 是唯一权威派生点：`SubagentState` 已在镜像两条派发路径（Agent async 与 SendMessage 续跑）与完成通知，缺的只是把这份派生状态落到 sidecar/session-event 并在 UI 的三个注意力表面（composer、轮末分隔线、侧栏/系统通知）持续呈现。停止走 `session/publishEvent` 模型中介（best-effort），成功与否都经现有通知管道收敛，不新增终态路径。

分三个独立可交付阶段：P1 三态感知与对账；P2 会话外呈现；P3 停止。

## 2. Rust Driver

### 2.1 pending 派生与状态词

- `frame.rs` `SessionStatus` 新增 `Background`（`as_str = "background"`），ts-rs 自动导出。
- `subagent.rs` 新增 `pending_background(sid) -> Vec<PendingBackground>`：合并 `background_agents`（agent_id → 父 sid/父 tc）与 `active_continuations`（agent_id → `ActiveContinuation`）中父会话匹配的条目。展示摘要：续跑取 `ActiveContinuation.summary`，显式后台 Agent 经 `agent_origins` 反查父 tc 后取 `agent_inputs` 的 description；缺省回退 agent_id。
- 遵守既有加锁秩序（subagents → sessions，不得反向）；派生函数只做点状取放。

### 2.2 状态落盘时机

- `normalize.rs` `turn/stopped` 收尾写 sidecar 处（现 `m["status"] = status` 一带）：正常 complete 且 `pending_background(sid)` 非空 → `Background`，否则维持现状（Idle）。interrupted/error 维持现有状态词——用户中断只停当前轮次 ctx，引擎侧续跑挂在 `context.Background()` 上仍存活，pending 的表达交给对话内状态条。
- `task_notification` 处理（`normalize.rs` 通知分支）在 `continuation_finished`/`background_agent_finished` 清理后：会话空闲且 pending 已空 → 回写 Idle + session-event；仍有其他 pending → 维持 `Background`。通知轮自身的 `turn/stopped` 按第一条规则再收敛一次，双保险。

### 2.3 sidecar 持久化 pending

sidecar 增加 `background: [{agentId, tcId, summary, startedAt}]`：

- 写入：Agent async 应答登记（`background_agent_launched`）与 SendMessage `confirm_continuation` 处；
- 移除：`task_notification` 清理处；
- 用途：① 侧栏无需打开会话即可渲染徽标与摘要；② 重启对账的依据（2.4）；③ 会话重开时校验内存态与 UI 的一致性。

### 2.4 引擎更替对账（冷修复扩展）

引擎进程更替后后台 goroutine 必死，"新引擎代 = pending 清零"是精确语义而非启发式。会话打开走冷修复路径时对账孤儿派发卡，来源有二、互补覆盖：

- **sidecar `background` 条目**：覆盖回放窗口之外的卡；
- **窗口帧考古**（`stale_background_cards_in_frames`）：覆盖 sidecar 持久化上线前的存量 journal——回执态卡由 reducer 嗅探恢复运行态，而完成通知可能因进程死亡未落盘、或旧帧缺 `backgroundAgentId` 绑定按 agentId 永远关不上。状态机对表 reduce.ts 的关卡语义（启动回执保持运行、普通终态按 tcId 关卡、通知按 agentId 只关最近一张绑定卡）。

处理：内存登记在场的条目跳过（引擎仍服务，含同进程重开）；孤儿按 tcId 追加合成 `tool_call_update{status:"failed", backgroundInterrupted:true}` 终态帧进 journal（复用 `journal_tx` Append + Materialize 机制），归约后卡片收敛为「已中断」、文案键 `chat.tool.bgInterrupted`；sidecar 剔除孤儿条目（保留存活项），无存活任务时 `background` 状态归一 `interrupted`；对账不得影响未闭合轮次冷修复的既有行为。

### 2.5 结构化后台标记

派发闭卡帧（driver 生成"已转后台"回执处）附带结构化标记（沿用 `progress {kind:"background_agent"}` 词汇或闭卡 update 上的专用字段），reducer 优先按结构化字段进入"保持运行态"分支；对引擎中文回执的字符串嗅探保留为旧 journal 回放 fallback，注释标注其唯一用途。

### 2.6 停止（P3）

- `session_call` 新增 kind `background_stop {agentId}`：映射 shell sid → engine sid 后调 `session/publishEvent`，`event_id = "bgstop:" + agentId + ":" + uuid`（幂等），`type = "host_request"`，`source = "desktop"`，message 固定模板：点名 `TaskStop(task_id=<agentId>)`、要求仅执行停止并简短确认。`busy`/`not_found` 原样返回给 UI。
- `normalize.rs` 通知轮开轮分支放宽：`source == "notification" || source == "desktop"` 共用同一幂等开轮/收轮逻辑；desktop 事件轮的正文以轻量系统行呈现。
- TaskStop 观察：driver 按事件携带的 `event_id` 关联该轮 `tool_call`，登记 `bgstop` 待决项；见到 `TaskStop` 即确认，超时（30s）未见或轮次结束仍未见 → 经 session-event 通知 UI 回弹。停止成功的终态不需要专门处理——引擎 `manager.Complete` 照常入 `NotificationQueue`，现有 stopped 结果卡与派发卡回填链路原样工作。

## 3. UI（ui-next）

### 3.1 展示层计数拆分

`Composer.tsx` `countItem`：`runningTools` 仅计 `status==="run" && !background` 的工具卡；新增 `runningBackground` 计数（`run && background`）。`ComposerPresentation` 增加 `backgroundRunning: number` 并纳入全等比较。runningLabel 的 `toolRunning` 语义由此修正。

### 3.2 后台状态条

`composerKit.tsx` 新增 `BackgroundBar`：

- 渲染条件：`!presentation.running && presentation.backgroundRunning > 0 && conn.connected`，占 RunBar 的插槽位；
- 内容：脉冲状态点 + `chat.bg.running`（count 插值）。单任务摘要与耗时内联（`rawInput` 的 summary/description 优先，退回工具标题）；多任务收起为计数，可展开逐任务一行（摘要 + 耗时 + 各自「查看子会话」，对齐工具卡组「×N 展开」形态）。取材为 items 里全部 `run+background` 卡，ChatView 供给并经签名 memo 稳定引用；
- 交互：任务行点击打开对应子会话回放浮层（`childSessionId`）；无主循环停止按钮；
- P3：任务行 hover 出"停止"→ 二段确认（按钮原位变"确认停止？"）→ 调 `background_stop` → 行进入"停止中…"；busy/超时回弹并 toast。

### 3.3 轮末分隔线变体

`reduce.ts` `task-ended` 分支：`items` 中存在 `run+background` 工具卡 → 系统行 key 用 `chat.sys.turnEndBg`，否则维持 `chat.sys.turnEnd`。轮末低频，O(n) 扫描可接受；渲染层按 key 取当前语言，不嗅探文案。

### 3.4 侧栏与未读（P2）

- `App.tsx` 的 session-event 消费与侧栏列表：`status === "background"` 渲染徽标（安静的脉冲点，区别于 running 的活动指示）；sidecar `background` 数组可供悬浮摘要。
- 未读：通知落在非当前会话时 sidecar 置 `unread`，session-event 广播，打开会话清除。

### 3.5 系统通知（P2）

引入 `tauri-plugin-notification`（当前无此依赖）。结构化 `task_notification` 帧落地且（窗口失焦 或 目标会话 ≠ 当前会话）→ 系统通知（agentName/description/status）；点击聚焦窗口、切到会话并滚动到结果卡。权限缺失静默降级。

### 3.6 i18n

新增键：`chat.bg.running`、`chat.sys.turnEndBg`、`chat.tool.bgInterrupted`、停止入口与确认文案、系统通知模板。zh/en 同步。

## 4. 兼容与升级策略

- 旧 journal：无结构化标记的历史帧靠保留的嗅探 fallback 正常回放；无 sidecar `background` 字段的旧会话对账视为空集。
- 旧引擎：`publishEvent` 已在 caps 声明，缺失时停止入口整体隐藏（探测 `engine_caps`）。
- 升级位：引擎将来提供 `task/stop`/轮末任务快照 caps 时，`background_stop` 切直通 RPC，publishEvent 降为 fallback；派生逻辑收敛在 driver 一处，UI 无感。

## 5. 测试

- Rust（`ohmy_tests.rs`）：pending 派生（两条派发路径、多任务并存）；turn/stopped complete/interrupted × pending 有无的状态词；通知清理回写；sidecar 持久化写/删；引擎更替对账（合成终态帧、状态归一、正常重开不触发）；desktop 事件轮幂等开轮/收轮；TaskStop 观察确认与超时回弹。
- UI（Vitest）：countItem 拆分与 presentation 全等；BackgroundBar 渲染条件、断连门控、点击定位；turn-end 变体 key；结构化标记优先 + 嗅探 fallback；停止二段确认、停止中、回弹（P3）；通知触发条件（P2，mock plugin）。
- 门禁：相关 Cargo tests、Vitest、TypeScript typecheck、`git diff --check`。
