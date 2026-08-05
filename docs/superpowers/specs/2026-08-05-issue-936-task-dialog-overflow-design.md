# Issue #936 任务操作弹窗溢出修复设计

## 状态

- 日期：2026-08-05
- Issue：https://github.com/chaitin/MonkeyCode/issues/936
- 分支：`260805-fix-936-stop-dialog-overflow`
- 状态：设计已确认并完成实施

## 问题

项目导航中的终止任务和删除任务确认弹窗会把完整任务名称插入描述。长任务名称产生大量换行时，弹窗高度超过当前视口，底部取消和确认按钮移出屏幕。现有弹窗缺少视口高度约束、正文滚动区域和任意长文本断行规则。

该入口使用国内版与海外版共用的 `NavProject` 组件。英文长任务名称更容易触发，两个区域均受相同布局影响。

## 目标

1. 终止任务与删除任务弹窗始终保持在可见视口内。
2. 长任务名称在正文区域内换行和滚动。
3. 底部取消与确认按钮始终保留在弹窗内的固定操作区。
4. 短任务名称和现有桌面、移动端布局保持当前视觉行为。
5. 修复范围限定在项目导航的两个任务操作弹窗。

## 方案选择

### 采用方案：局部双弹窗约束

在 `nav-project.tsx` 中为终止和删除任务弹窗应用相同布局：

- `AlertDialogContent` 使用基于 `100dvh` 的最大高度。
- Content 的网格行分为可收缩正文和固定 Footer。
- Header 作为可滚动正文区域，允许垂直滚动。
- Description 对连续长文本启用任意位置断行。
- Footer 保持在滚动区域之外。

此方案覆盖两个使用完整任务名称的相邻入口，并保持公共 `AlertDialog` 的其他消费者不变。

### 备选方案

1. 仅修终止任务弹窗：改动最少，删除任务保留同类溢出风险。
2. 修改公共 `AlertDialog`：所有确认弹窗获得统一高度行为，同时扩大回归范围并可能改变现有复杂弹窗布局。

## 组件设计

### AlertDialogContent

两个弹窗增加等价的局部类名：

- 最大高度：`max-h-[calc(100dvh-2rem)]`
- 网格行：`grid-rows-[minmax(0,1fr)_auto]`
- 内容裁剪：`overflow-hidden`

视口上下各保留 `1rem` 安全间距。第一行允许缩小，第二行根据 Footer 内容保持自然高度。

### AlertDialogHeader

Header 增加：

- `min-h-0`
- `overflow-y-auto`
- `overscroll-contain`
- `role="region"`、`tabIndex={0}` 和本地化 `aria-label`
- 可见的 `focus-visible` 焦点环

长任务名称只在 Header 内滚动，滚动到边界时保持弹窗上下文稳定。键盘用户可以聚焦该区域并使用方向键、Page Up 或 Page Down 浏览完整内容。

### AlertDialogDescription

Description 增加：

- `break-words`
- `[overflow-wrap:anywhere]`

普通英文句子按空格换行，连续 URL、仓库名或无空格字符串也能在弹窗宽度内断行。

## 数据与交互

任务数据、停止接口、删除接口和状态管理保持原状。布局变化只作用于确认弹窗：

1. 用户选择终止或删除任务。
2. 完整任务名称进入本地化描述。
3. 短内容保持自然高度。
4. 长内容达到最大高度后，Header 内部滚动。
5. Footer 始终显示取消与确认按钮。

关闭弹窗、请求进行中禁用按钮、成功刷新任务列表和错误提示继续使用现有逻辑。

## 测试

新增一个聚焦布局契约的 TypeScript 测试，读取 `nav-project.tsx` 并验证：

1. 终止和删除两个 `AlertDialogContent` 都具有视口最大高度、双行网格和内容裁剪。
2. 两个 Header 都具有可收缩、垂直滚动、overscroll 约束和键盘焦点入口。
3. 两个 Description 都具有单词断行和任意位置断行。
4. Footer 位于 Header 之后，保持独立操作区。

验证命令：

```bash
tsx --test frontend/test/console-nav-project-dialog-layout.test.ts
pnpm --dir frontend lint
pnpm --dir frontend run build:online
```

使用海外 SaaS 预览完成手工验证：

1. 浏览器保持 100% 缩放。
2. 使用约 600 词的任务名称。
3. 在 1366×768 和移动端视口打开终止、删除弹窗。
4. 验证任务名称区域可滚动，两个操作按钮始终可见且可点击。

## 验收标准

1. 终止任务与删除任务弹窗在长任务名称下保持在视口内。
2. Footer 无需缩放浏览器即可访问。
3. 连续长字符串不会横向撑开弹窗。
4. 两个操作流程的 API 与状态行为保持原状。
5. 定向测试、Lint 和 `build:online` 通过。
6. 海外 SaaS 预览通过桌面和移动视口人工验证。

## 范围边界

- 不修改公共 `AlertDialog`。
- 不截断或改写任务名称。
- 不修改后端、API、国际化文案和区域判断。
- 不处理 Issue #936 之外的侧边栏交互。
