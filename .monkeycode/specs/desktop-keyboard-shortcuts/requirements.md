# Desktop 快捷键需求

## 简介

为 MonkeyCode Desktop 增加一组符合主流 AI 编程工具习惯的键盘快捷键，使用户无需离开键盘即可创建任务、定位输入、管理工作台、切换权限模式和停止生成。

## 术语

- **主修饰键**：macOS 上的 `Cmd`，Windows/Linux 上的 `Ctrl`。
- **焦点格**：工作台中 `split.focused` 指向的任务格。
- **顶层浮层**：通过 Esc 层栈管理的菜单、弹窗、抽屉或帮助面板。
- **运行中会话**：当前正在生成回复或执行工具的本地或云端会话。

## 需求

### 需求 1：应用与工作台导航

**用户故事：** 作为 Desktop 用户，我希望通过键盘打开常用界面，以便减少鼠标操作。

1. WHEN 用户按下主修饰键加 `N`，Desktop SHALL 复用当前任务类型的新建任务流程。
2. WHEN 用户按下主修饰键加 `L`，Desktop SHALL 聚焦焦点格中可用的消息输入框。
3. WHEN 用户按下主修饰键加 `,`，Desktop SHALL 打开设置界面。
4. WHEN 用户按下主修饰键加 `B`，Desktop SHALL 切换任务侧栏的显示状态。
5. IF 当前上下文没有可执行目标，Desktop SHALL 保持当前界面状态。

### 需求 2：分屏管理

**用户故事：** 作为多任务用户，我希望通过键盘拆分当前任务格，以便并行查看多个任务。

1. WHEN 用户按下主修饰键加 `\`，Desktop SHALL 在焦点格右侧创建分屏。
2. WHEN 用户按下主修饰键加 `Shift+\`，Desktop SHALL 在焦点格下方创建分屏。
3. WHILE 工作台已达到现有六格上限，Desktop SHALL 保持当前布局。
4. WHEN 分屏创建成功，Desktop SHALL 使用现有布局状态机更新焦点格。

### 需求 3：会话控制

**用户故事：** 作为 Agent 用户，我希望通过键盘切换权限和停止生成，以便快速控制当前会话。

1. WHILE 焦点格显示本地会话，WHEN 用户按下主修饰键加 `.`，Desktop SHALL 切换当前会话的权限模式。
2. WHILE 焦点格显示本地会话，WHEN 用户按下无额外修饰键的 `Shift+Tab`，Desktop SHALL 切换当前会话的权限模式。
3. WHILE 焦点格显示运行中会话，WHEN 用户按下无修饰键的 `Escape`，Desktop SHALL 停止当前会话。
4. WHILE 顶层浮层处于打开状态，WHEN 用户按下 `Escape`，Desktop SHALL 关闭最高优先级浮层。
5. WHILE 审批交互处于打开状态，WHEN 用户按下 `Escape`，Desktop SHALL 沿用现有审批拒绝或输入框失焦行为。
6. IF 输入法正在组合输入，Desktop SHALL 保留输入法对按键事件的控制。

### 需求 4：事件隔离

**用户故事：** 作为多任务用户，我希望一次按键只影响当前交互目标，以便避免误操作其他任务。

1. WHEN 会话级快捷键触发，Desktop SHALL 仅操作焦点格对应的会话。
2. WHEN 提问卡消费无修饰 `Enter`，Desktop SHALL 阻止该事件触发审批允许操作。
3. WHEN审批快捷键收到带 `Ctrl`、`Meta`、`Alt` 或 `Shift` 的 `Enter`，Desktop SHALL 保留事件给局部交互。
4. WHEN 局部组件已消费键盘事件，Desktop SHALL 阻止全局快捷键重复执行动作。

### 需求 5：可发现性与验证

**用户故事：** 作为新用户，我希望查看快捷键清单，以便学习可用操作。

1. Desktop SHALL 在任务侧栏提供快捷键帮助入口。
2. WHEN 用户打开快捷键帮助，Desktop SHALL 显示首批快捷键、平台主修饰键和上下文限制。
3. WHEN 快捷键帮助处于打开状态且用户按下 `Escape`，Desktop SHALL 关闭快捷键帮助。
4. Desktop SHALL 使用自动化测试覆盖按键解析、焦点格隔离、Esc 优先级、审批修饰键和提问卡事件隔离。

## 本次范围外

- 用户自定义快捷键。
- 系统级全局唤起。
- 命令面板、全局文件搜索、历史会话搜索和模型切换。
- 修改现有六格分屏上限。
