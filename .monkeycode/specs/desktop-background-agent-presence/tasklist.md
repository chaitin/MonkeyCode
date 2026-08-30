# Desktop 后台任务在场感知与停止实施计划

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

## P3 停止（best-effort）

- [ ] 7. Driver 停止通道
  - [ ] 7.1 `session_call` kind `background_stop`：publishEvent 组装（幂等 event_id、点名 TaskStop、busy/not_found 透传）
  - [ ] 7.2 `normalize.rs` host 事件轮（source=desktop）接入开轮/收轮，轻量系统行呈现
  - [ ] 7.3 按 event_id 观察 TaskStop tool_call：确认/超时回弹（session-event 通知 UI）
  - [ ] 7.4 Rust 测试：幂等开轮、观察确认、超时回弹、busy 透传
- [ ] 8. UI 停止入口
  - [ ] 8.1 BackgroundBar 任务行与派发卡详情弹窗的"停止"入口，二段确认（提示不可恢复）
  - [ ] 8.2 停止中态、busy/超时回弹与 toast
  - [ ] 8.3 `engine_caps` 探测：无 publishEvent 时隐藏入口；预留 task/stop 直通切换位
  - [ ] 8.4 UI 测试：二段确认、停止中、回弹

## 验证

- [ ] 9. 门禁
  - [ ] 9.1 相关 Cargo 聚焦测试通过
  - [ ] 9.2 Vitest 与 TypeScript typecheck 通过
  - [ ] 9.3 `git diff --check` 通过
