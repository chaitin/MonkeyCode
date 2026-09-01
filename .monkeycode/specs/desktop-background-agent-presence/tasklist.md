# Desktop 后台代理在场感知与停止实施计划

## P1 三态感知与对账

- [x] 1. Driver 后台第三态
  - [x] 1.1 `frame.rs` SessionStatus 新增 `Background`（ts-rs 导出）
  - [x] 1.2 `subagent.rs` 实现 `pending_background(sid)` 派生（两张表合并、摘要取材、锁秩序）
  - [x] 1.3 `normalize.rs` turn/stopped complete 分支按 pending 写 `background`/`idle`
  - [x] 1.4 `normalize.rs` task_notification 清理后回写状态（空→idle，余→background）
  - [x] 1.5 状态词流转 Rust 测试（complete/interrupted × pending 有无、通知回写）

- [x] 2. sidecar 持久化与引擎更替对账
  - [x] 2.1 sidecar 增加 `background: [{agentId, tcId, summary, startedAt}]`，派发写入、通知移除
  - [x] 2.2 冷修复扩展：新引擎代 + sidecar 遗留 → 合成 `tool_call_update{failed}` 帧、清 pending、状态归一 interrupted
  - [x] 2.3 对账测试：合成终态帧、正常重开不触发、旧 sidecar 无字段兼容

- [x] 3. 结构化后台标记
  - [x] 3.1 driver 派发闭卡帧附带结构化标记
  - [x] 3.2 `reduce.ts` 优先按结构化字段判定，中文嗅探降级为旧 journal fallback（注释标注）
  - [x] 3.3 归约测试：结构化优先、fallback 仍生效

- [x] 4. 对话内在场呈现
  - [x] 4.1 `Composer.tsx` countItem 拆分 `runningBackground`，`runningTools` 排除后台卡，presentation 纳入全等比较
  - [x] 4.2 `composerKit.tsx` 新增 `BackgroundBar`（渲染条件、摘要/耗时、点击定位、断连门控）
  - [x] 4.3 `reduce.ts` task-ended 后台变体 key `chat.sys.turnEndBg`
  - [x] 4.4 i18n zh/en 新增键（`chat.bg.running`、`chat.sys.turnEndBg`、`chat.tool.bgInterrupted`）
  - [x] 4.5 UI 测试：计数拆分、状态条条件、变体 key、通知到达后消退

## P2 会话外在场呈现

- [ ] 5. 侧栏与未读
  - [ ] 5.1 侧栏对 `status === "background"` 渲染徽标
  - [ ] 5.2 通知落非当前会话置 sidecar `unread`，打开清除，session-event 广播
- [ ] 6. 系统通知
  - [ ] 6.1 引入 `tauri-plugin-notification` 及权限声明
  - [ ] 6.2 失焦/非当前会话的结构化通知 → 系统通知，点击聚焦并定位结果卡
  - [ ] 6.3 权限缺失静默降级；触发条件测试（mock plugin）

## P3 停止（已按 subagentControl 直通 RPC 落地；publishEvent 中介方案作废，见 design §2.6）

- [x] 7. Driver 停止通道
  - [x] 7.1 `session_call` kind `background_stop {agent_id}`：直调 `subagent/cancel`（cap 守卫、engine_id 寻址、应答/错误原样透传）
  - [x] 7.2 `Caps` 投影新增 `subagent_control`（engine_caps → UI 门控）
  - [x] 7.3 Rust 测试：cap 缺失拒绝、agent_id 校验、RPC 形状与应答透传、引擎错误透传
  - ~~publishEvent 组装 / desktop 事件轮 / TaskStop 观察与超时回弹~~（直通 RPC 后不需要：应答即受理确认，终态归 task_notification 既有链路）
- [x] 8. UI 停止入口
  - [x] 8.1 BackgroundBar 任务行常驻「停止」，二段确认（原位变「确认停止?」，4s 自动回弹）
  - [x] 8.2 停止中态（等 task_notification 收卡）、失败回弹 + 条内原因外显（chat.bg.stopFailed）
  - [x] 8.3 `engine_caps.subagent_control` 门控：无能力/无 agentId（旧 journal 卡）隐藏入口
  - [x] 8.4 stopped 终态状态词：通知按「已停止」收卡（chat.tool.bgStopped），不再混用「执行失败」
  - [x] 8.5 UI 测试：二段确认、停止中、能力门控、失败回弹；reduce stopped 收卡
  - [ ] 8.6 派发卡详情弹窗的停止入口（暂缓：状态条为唯一入口）

## 验证

- [ ] 9. 门禁
  - [ ] 9.1 相关 Cargo 聚焦测试通过
  - [ ] 9.2 Vitest 与 TypeScript typecheck 通过
  - [ ] 9.3 `git diff --check` 通过
