# Desktop 后台 Agent 通知适配实施计划

- [x] 1. 接入 Agent 通知轮生命周期
  - [x] 1.1 在 `normalize.rs` 处理 `turn/started(source=notification)`
  - [x] 1.2 空闲会话开轮、重置临时态并更新 sidecar/session status
  - [x] 1.3 重复 started 幂等并复用现有 `turn/stopped` 收尾
  - [x] 1.4 增加通知轮开轮和终态回归测试

- [x] 2. 归一化后台派发和完成通知
  - [x] 2.1 解析 `SendMessage async_launched` 的 agentId，派发卡保持后台运行态且不显示原始 JSON
  - [x] 2.2 从通知包装中提取 Result，失败时保留剥标签后的完整内容
  - [x] 2.3 现有后台 Agent 卡继续回填终态，但不吞完成通知
  - [x] 2.4 始终生成结构化 `task_notification`，删除 agent_text fallback
  - [x] 2.5 按 agentId 将完成通知回写 SendMessage 运行卡，且保留独立结果卡
  - [x] 2.6 增加有/无映射、错误 agent 隔离、失败状态和 SendMessage 测试

- [x] 3. 实现独立后台子代理结果卡
  - [x] 3.1 新增 `BackgroundAgentResultItem` 和结构化 ACP 字段
  - [x] 3.2 reducer 将结构化通知追加为独立 item，旧 text 通知保持系统行
  - [x] 3.3 新增 `BackgroundAgentResultCard` 的单行摘要和 Markdown 详情弹窗
  - [x] 3.4 支持状态色、本地资源和时间戳
  - [x] 3.5 接入 LogList 与时间线高度估算
  - [x] 3.6 增加 reducer 和组件测试

- [x] 4. 展示 SendMessage 续跑过程流
  - [x] 4.1 建立 agent origin、会话内 name alias、child identity 和 active continuation 映射
  - [x] 4.2 在 async 应答前按旧 parent stamp 将 child 路由重绑到当前 SendMessage 卡
  - [x] 4.3 将续跑 tool_call、tool_result 和 error 投喂当前卡进度区
  - [x] 4.4 通知完成时关闭 child 路由并清理 active continuation，不复制完整 Result
  - [x] 4.5 覆盖首次无 child、同步 Agent、并发隔离和引擎和解

- [x] 5. 统一后台卡片详情弹窗
  - [x] 5.1 抽取并复用子代理会话的只读 `DetailModal` 外壳
  - [x] 5.2 后台 SendMessage 过程详情改为弹窗，卡片不再行内展示 feed/lastLine
  - [x] 5.3 独立子代理结果卡改为弹窗展示 Markdown，不提供额外复制按钮
  - [x] 5.4 覆盖关闭按钮、Esc、真实 child 会话优先和行内隔离测试

- [x] 6. 统一三类子代理卡视觉
  - [x] 6.1 保留普通子代理的蓝色“查看子会话”基准样式
  - [x] 6.2 后台派发卡移除灰色状态文案和箭头，改用蓝色“查看子会话/详情”
  - [x] 6.3 后台结果卡移除状态文案和箭头，改用蓝色“查看结果”
  - [x] 6.4 状态点保留生命周期颜色和无障碍状态文案

- [x] 7. 验证修复
  - [x] 7.1 Rust 后台通知、续跑重绑与 turn/stopped 聚焦测试通过
  - [x] 7.2 UI reducer、结果卡、详情弹窗和时间线测试通过
  - [x] 7.3 TypeScript 类型检查通过
  - [x] 7.4 `git diff --check` 通过
