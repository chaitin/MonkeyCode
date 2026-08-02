# 手机任务工具入口移至主题按钮下方实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将手机任务页三点工具入口移动到主题切换按钮正下方并统一为 32px × 32px，同时保留模型按钮原始宽度和现有工具交互。

**Architecture:** 三点入口继续由任务详情组件管理，通过 `fixed right-4 top-17` 在手机端对齐全局主题按钮，沿用任务页本地状态和现有 Portal。任务页页头增加 40px 手机右侧安全空间，Popover、文件视图和工具动作保持现有组件树与状态流。

**Tech Stack:** React、TypeScript、Tailwind CSS、Radix UI、Node.js Test Runner、ESLint、Vite

## Global Constraints

- 三点入口仅在手机任务详情页显示，使用 `fixed right-4 top-17 z-30 md:hidden`。
- 三点按钮使用 `size="icon-sm"`，尺寸与主题按钮一致为 32px × 32px。
- 手机任务页页头保留 40px 右侧安全空间，桌面断点恢复原有空间。
- 模型按钮保留 28px 高度、内容自适应宽度、220px 最大宽度和窄屏收缩规则。
- 工具菜单继续使用 104px 宽度；文件视图继续使用 `calc(100vw - 2rem)` 且最大 420px。
- Skills、文件、预览、发布、关闭复位和关闭后动作时序保持现状。
- 桌面任务页、其他控制台页面、主题切换组件和消息定位保持现状。
- 使用 RED-GREEN-REFACTOR；实现提交前获得用户单独明确授权。
- 每次提交仅暂存任务列出的文件，保留工作树中的其他改动。

---

### Task 1: 移动手机工具入口并统一按钮尺寸

**Files:**
- Modify: `frontend/src/pages/console/user/task/task-detail.tsx:1257-1420`
- Test: `frontend/test/task-detail-mobile-header-layout.test.mjs:13-49`

**Interfaces:**
- Consumes: 现有 `mobileToolsOpen`、`mobileToolsView`、`handleMobileToolsOpenChange`、`handleMobileToolsCloseAutoFocus` 和 Radix `Popover`。
- Produces: 位于主题按钮正下方的 32px 手机工具入口，以及防止页头内容覆盖入口的 40px 安全空间；组件 props 和状态保持不变。

- [ ] **Step 1: 写入位置、尺寸和安全空间失败测试**

在 `frontend/test/task-detail-mobile-header-layout.test.mjs` 的“手机页头恢复官方紧凑尺寸”测试中，将三点入口断言：

```javascript
assert.match(source, /className="flex w-11 shrink-0 justify-end md:hidden"[\s\S]*?className="size-7 shrink-0"/);
```

替换为：

```javascript
assert.match(source, /className="fixed right-4 top-17 z-30 md:hidden"[\s\S]*?size="icon-sm"/);
```

在“320px 页头保留 104px 尾部对齐轨道”测试后新增：

```javascript
test("手机工具入口位于主题按钮正下方并使用相同尺寸", () => {
  assert.match(source, /className="flex items-center gap-2 pr-10 md:justify-between md:gap-3 md:pr-0"/);
  assert.match(source, /className="fixed right-4 top-17 z-30 md:hidden"[\s\S]*?<Popover modal open=\{mobileToolsOpen\} onOpenChange=\{handleMobileToolsOpenChange\}>/);
  assert.match(source, /className="fixed right-4 top-17 z-30 md:hidden"[\s\S]*?<PopoverTrigger asChild>[\s\S]*?size="icon-sm"[\s\S]*?aria-label=\{t\("taskDetail\.page\.mobileTools\.trigger"\)\}/);
  assert.doesNotMatch(source, /className="flex w-11 shrink-0 justify-end md:hidden"/);
  assert.doesNotMatch(source, /className="size-7 shrink-0"/);
});
```

在“更多工具使用固定向下的动态宽度单一 Popover”测试中，将 Popover 断言补强为：

```javascript
assert.equal(source.match(/<Popover modal open=\{mobileToolsOpen\}/g)?.length, 1);
assert.match(source, /<PopoverContent[\s\S]*?side="bottom"[\s\S]*?align="end"[\s\S]*?sideOffset=\{6\}[\s\S]*?avoidCollisions=\{false\}/);
```

在“320px 页头保留 104px 尾部对齐轨道”测试中移除旧三点 44px 槽断言：

```javascript
assert.match(source, /className="flex w-11 shrink-0 justify-end md:hidden"/);
```

保留模型按钮自适应宽度、上下文圆环、104px 工具菜单、文件视图和交互时序的全部现有断言。

- [ ] **Step 2: 运行页头聚焦测试确认 RED**

Run:

```bash
cd frontend
/root/.local/share/pnpm/nodejs/22.23.1/bin/node --test test/task-detail-mobile-header-layout.test.mjs
```

Expected: 新测试失败；源码仍包含三点 44px Flex 槽、28px `size-7` 按钮，页头尚无 `pr-10 md:pr-0`。

- [ ] **Step 3: 为页头增加手机右侧安全空间**

在 `frontend/src/pages/console/user/task/task-detail.tsx` 中将页头行：

```tsx
<div className="flex items-center gap-2 md:justify-between md:gap-3">
```

替换为：

```tsx
<div className="flex items-center gap-2 pr-10 md:justify-between md:gap-3 md:pr-0">
```

`pr-10` 在手机端预留 40px，覆盖 32px 固定按钮和 8px 间距；`md:pr-0` 保持桌面页头宽度。

- [ ] **Step 4: 将三点入口固定到主题按钮下方**

将手机 Popover 外层：

```tsx
<div className="flex w-11 shrink-0 justify-end md:hidden">
```

替换为：

```tsx
<div className="fixed right-4 top-17 z-30 md:hidden">
```

将三点按钮：

```tsx
<Button
  type="button"
  variant="outline"
  size="icon"
  className="size-7 shrink-0"
  aria-label={t("taskDetail.page.mobileTools.trigger")}
>
```

替换为：

```tsx
<Button
  type="button"
  variant="outline"
  size="icon-sm"
  aria-label={t("taskDetail.page.mobileTools.trigger")}
>
```

保留 `IconDots`、`PopoverContent`、工具视图、文件视图和所有事件处理函数。

- [ ] **Step 5: 运行页头聚焦测试确认 GREEN**

Run:

```bash
cd frontend
/root/.local/share/pnpm/nodejs/22.23.1/bin/node --test test/task-detail-mobile-header-layout.test.mjs
```

Expected: 页头测试 10/10 通过。

- [ ] **Step 6: 运行组合聚焦测试和目标静态检查**

Run:

```bash
cd frontend
/root/.local/share/pnpm/nodejs/22.23.1/bin/node --test test/task-detail-mobile-header-layout.test.mjs test/task-user-input-index-mobile-layout.test.mjs
/root/.local/share/pnpm/nodejs/22.23.1/bin/node node_modules/eslint/bin/eslint.js src/pages/console/user/task/task-detail.tsx test/task-detail-mobile-header-layout.test.mjs
git diff --check -- src/pages/console/user/task/task-detail.tsx test/task-detail-mobile-header-layout.test.mjs
```

Expected: 组合测试 19/19 通过，ESLint 和差异检查均退出 0。

- [ ] **Step 7: 运行完整回归与 online 构建**

Run:

```bash
cd frontend
/root/.local/share/pnpm/nodejs/22.23.1/bin/node node_modules/eslint/bin/eslint.js .
/root/.local/share/pnpm/nodejs/22.23.1/bin/node node_modules/typescript/bin/tsc -b
/root/.local/share/pnpm/nodejs/22.23.1/bin/node --test
/root/.local/share/pnpm/nodejs/22.23.1/bin/node node_modules/vite/bin/vite.js build --mode online
```

Expected: ESLint、TypeScript 和 online build 退出 0；新增一个测试后完整测试预计为 305 项中 297 通过、8 项既有失败，失败集合保持一致。

- [ ] **Step 8: 执行 online 健康检查和登录态人工验收**

Run:

```bash
cd frontend
PREVIEW_URL=https://4215-e84020e6e952be3c.monkeycode-ai.online /root/.local/share/pnpm/nodejs/22.23.1/bin/node scripts/check-online-preview.mjs
```

Expected: 输出 `Online preview captcha health check passed.`。

在 320px、375px、390px、430px 和 1280px 下确认：

```text
手机任务页三点按钮位于主题按钮正下方，两个按钮右边线对齐。
主题按钮和三点按钮均为 32px × 32px。
模型与上下文区块和固定三点入口之间无覆盖。
工具菜单、文件视图、Skills、预览和发布动作正常。
离开任务页后固定三点入口消失。
桌面任务页和其他控制台页面保持现状。
```

- [ ] **Step 9: 请求授权后提交实现**

获得用户对本任务的单独明确授权后运行：

```bash
git add frontend/src/pages/console/user/task/task-detail.tsx frontend/test/task-detail-mobile-header-layout.test.mjs
git diff --cached --check
git commit -m "修复：移动手机任务工具入口"
```

Expected: 提交仅包含上述两个文件，并包含已验证的模型按钮自适应宽度修复。
