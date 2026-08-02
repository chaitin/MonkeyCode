# 用户指令记忆

本文件记录了用户的指令、偏好和教导，用于在未来的交互中提供参考。

## 格式

### 用户指令条目
用户指令条目应遵循以下格式：

[用户指令摘要]
- Date: [YYYY-MM-DD]
- Context: [提及的场景或时间]
- Instructions:
  - [用户教导或指示的内容，逐行描述]

### 项目知识条目
Agent 在任务执行过程中发现的条目应遵循以下格式：

[项目知识摘要]
- Date: [YYYY-MM-DD]
- Context: Agent 在执行 [具体任务描述] 时发现
- Category: [运维部署|构建方法|测试方法|排错调试|工作流协作|环境配置]
- Instructions:
  - [具体的知识点，逐行描述]

## 去重策略
- 添加新条目前，检查是否存在相似或相同的指令
- 若发现重复，跳过新条目或与已有条目合并
- 合并时，更新上下文或日期信息
- 这有助于避免冗余条目，保持记忆文件整洁

## 条目

[Online 预览构建与验证码验收]
- Date: 2026-07-26
- Context: Agent 在排查 online 构建后登录验证码失败时发现
- Category: 构建方法|测试方法|排错调试
- Instructions:
  - 在 `frontend` 运行 `pnpm run build:online` 验证 online 生产构建。
  - 启动 online 开发预览时显式设置 API 目标，例如 `TARGET=https://monkeycode-ai.com pnpm run dev:online -- --host 0.0.0.0 --port <PORT>`。
  - 获得预览地址后运行 `PREVIEW_URL=<URL> pnpm run check:online-preview`，验证 CAP JavaScript、WASM 和 challenge API。
  - 自动健康检查通过后，在浏览器完成一次真实验证码求解和登录，再开始登录后页面的 UI 验收。
  - UI 验收需等待 `document.fonts.ready`，确认 JetBrains Mono Variable 与 Noto Sans SC Variable 已加载，并检查浏览器控制台和 Network 中没有字体资源失败。
  - 在 320px、375px、390px、430px 和 1280px 对照基准页面核对字体族、字号、字重和行高，字体变化应作为构建后高频回归项记录和处理。
  - Vite 日志出现 `Must set target or forward` 表示 `/api` proxy 缺少 `TARGET`，应使用显式目标重启预览。
