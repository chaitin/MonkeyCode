# Desktop 后台 Agent 通知适配实施计划

- [x] 1. 接入 Agent 通知轮生命周期
  - [x] 1.1 在 `normalize.rs` 处理 `turn/started(source=notification)`
  - [x] 1.2 空闲会话开轮、重置临时态并更新 sidecar/session status
  - [x] 1.3 重复 started 幂等并复用现有 `turn/stopped` 收尾
  - [x] 1.4 增加通知轮开轮和终态回归测试

- [x] 2. 归一化后台派发和完成通知
  - [x] 2.1 将 `SendMessage async_launched` 友好闭卡，禁止显示原始 JSON
  - [x] 2.2 从通知包装中提取 Result，失败时保留剥标签后的完整内容
  - [x] 2.3 现有后台 Agent 卡继续回填终态，但不吞完成通知
  - [x] 2.4 始终生成结构化 `task_notification`，删除 agent_text fallback
  - [x] 2.5 增加有/无映射、失败状态和 SendMessage 测试

- [x] 3. 实现独立后台子代理结果卡
  - [x] 3.1 新增 `BackgroundAgentResultItem` 和结构化 ACP 字段
  - [x] 3.2 reducer 将结构化通知追加为独立 item，旧 text 通知保持系统行
  - [x] 3.3 新增 `BackgroundAgentResultCard` 的折叠摘要和 Markdown 展开态
  - [x] 3.4 支持状态色、本地资源、复制结果和时间戳
  - [x] 3.5 接入 LogList 与时间线高度估算
  - [x] 3.6 增加 reducer 和组件测试

- [x] 4. 验证修复
  - [x] 4.1 Rust 后台通知与 turn/stopped 聚焦测试通过
  - [x] 4.2 UI reducer、结果卡和时间线测试通过
  - [x] 4.3 TypeScript 类型检查通过
  - [x] 4.4 `git diff --check` 通过
