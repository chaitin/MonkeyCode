# Web 任务对话页移动端输入栏重叠修复设计

## 背景

浏览器 Web 任务对话页在手机宽度下会把消息输入框、附件操作和发送操作挤在同一行。textarea 可用宽度过窄后，placeholder 发生换行并出现原生滚动条，后续行越过输入框视觉边界，形成 UI 重影和重叠。

该问题位于 Web 前端任务对话输入栏，与 `mobile/` 下的 React Native 页面无关。

## 根因

共享 `InputGroup` 默认使用固定高度的横向 flex 布局。组件通过 Tailwind `has-*` 选择器识别直接子元素中的 `data-align="block-end"`，再切换为自动高度的纵向布局。

当目标手机浏览器未应用对应 `:has()` 规则时，组件保留以下默认布局：

- 固定高度 `h-9`
- 横向 `flex`
- textarea、block-end addon 同处一行
- addon 使用 `w-full`，进一步压缩 textarea

截图中的窄 textarea、右侧滚动条、换行文字越界和操作按钮横向拥挤均与该降级结果一致。

## 目标

1. block addon 的关键布局由 React 属性显式声明，不依赖浏览器对 `:has()` 的支持。
2. 任务对话页在 320px 及以上宽度保持输入区、工具区和发送区互不重叠。
3. 手机端触控目标至少为 44px，输入栏不产生页面级横向滚动。
4. 桌面端现有视觉、文案和交互保持一致。
5. 其他使用 block addon 的输入组件同步消除相同风险。

## 方案比较

### 方案 A：共享组件显式 orientation

为 `InputGroup` 增加可选 `orientation` 属性。默认保持横向布局；block addon 调用方显式传入 `orientation="vertical"`。

优点：

- 形成清晰的共享组件契约
- 同时修复三个已知 block addon 使用点
- 保留默认行为，横向输入组件无回归
- 后续可以通过测试阻止遗漏

代价：

- 需要更新三个调用点
- `orientation` 与 addon 的 `align` 需要保持一致

### 方案 B：仅在任务对话输入栏覆盖 className

在 `TaskChatInputBox` 的 `InputGroup` 上添加 `h-auto flex-col items-stretch`。

优点：改动范围最小。

代价：另外两个 block addon 输入组件继续依赖 `:has()`，共享组件契约仍然隐含。

### 方案 C：拆分移动端 Composer

为手机宽度创建独立输入栏 DOM 结构。

优点：移动端布局控制最充分。

代价：产生桌面与移动两套交互结构，状态、可访问性和测试成本增加。

采用方案 A。

## 组件设计

### InputGroup

`InputGroup` 新增：

```ts
orientation?: "horizontal" | "vertical"
```

行为约定：

- 默认值为 `horizontal`
- `vertical` 输出 `data-orientation="vertical"`
- `vertical` 直接应用 `h-auto flex-col items-stretch`
- 现有 `has-*` 样式保留为兼容增强
- Combobox、Command 等未传属性的调用继续使用横向布局

### block addon 调用点

以下组件的 `InputGroup` 显式传入 `orientation="vertical"`：

- `TaskChatInputBox`
- `TaskInput`
- `TaskChatSection`

测试约束所有 `align="block-start"` 或 `align="block-end"` 的直接父级输入组必须声明纵向 orientation。

### TaskChatInputBox 移动端布局

textarea：

- 使用完整可用宽度和 `min-w-0`
- 保持当前自动增长与最大高度
- 超过最大高度后仅在 textarea 内部纵向滚动

底部工具条：

- 左侧工具区使用 `min-w-0 flex-1 overflow-x-auto`
- 命令、附件、画板和附件项位于左侧工具区
- 右侧语音与发送区使用 `shrink-0`
- 工具区横向滚动不推动右侧发送按钮

小于 640px：

- 图标操作按钮触控区至少为 44px
- 发送按钮隐藏文字标签，保留发送图标
- 发送按钮提供明确 `aria-label`
- 工具区保持 8px 间距

640px 及以上：

- 保留现有发送文字和控件尺寸
- 保留现有输入栏最大宽度和视觉样式

## 可访问性

- 手机端隐藏可见文字后，发送按钮继续暴露可访问名称
- 附件、画板、命令和语音按钮保持已有可访问名称
- 所有手机端高频操作满足至少 44px 触控区域
- 横向工具区支持触摸滚动，发送操作始终可见
- 键盘焦点顺序保持 DOM 顺序：输入框、左侧工具、语音、发送

## 错误与边界状态

- 三个附件存在时，附件项进入左侧横向滚动区域
- 任务执行中、等待发送和自动发送状态继续使用现有按钮逻辑
- textarea 长内容仅触发内部滚动，不改变页面宽度
- 语音功能开启或隐藏时，右侧区域按现有条件渲染并保持收缩隔离
- 320px 宽度下输入区仍具有有效宽度，操作按钮不覆盖输入内容
- 浏览器支持 `:has()` 时，显式 orientation 与现有增强规则产生相同布局结果

## 测试设计

### 自动测试

1. `InputGroup` 默认 orientation 保持横向。
2. `orientation="vertical"` 应用自动高度、纵向排列和拉伸对齐。
3. 三个 block addon 调用点均声明 `orientation="vertical"`。
4. `TaskChatInputBox` 包含左侧可滚动区、右侧不可收缩区和移动端发送标签规则。
5. 手机端发送按钮保留可访问名称。
6. 运行 frontend 全量测试、ESLint 和 online build。

### 人工验收

使用浏览器响应式模式验证 320px、375px、390px 和 430px：

- 空输入与长 placeholder
- 单行、三行和超过最大高度的输入
- 零附件、一个附件和三个附件
- 空闲、执行中、等待发送和自动发送状态
- 语音按钮存在和隐藏状态
- 软键盘弹出与收起
- 中文和英文界面

验收结果应满足：

- textarea 内容始终位于输入框边界内
- 工具和发送按钮无重叠
- 发送按钮始终可见且可点击
- 页面无横向滚动
- 桌面端布局与修复前一致

## 范围边界

本次只调整 Web 前端共享 InputGroup 布局契约和任务输入栏响应式行为。React Native 输入栏、消息数据流、附件上传逻辑、语音逻辑和发送状态机保持原实现。
