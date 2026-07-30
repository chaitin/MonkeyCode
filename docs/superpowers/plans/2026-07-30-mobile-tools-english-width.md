# Mobile Tools English Width Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将移动端任务工具菜单从 104px 扩宽至 120px，使英文工具名称完整显示。

**Architecture:** 保留现有模型行定位上下文、Popover 结构和动态文件视图宽度，只修改工具视图的固定宽度契约。通过现有源码结构测试锁定 120px，并运行前端静态检查与 online build 防止布局回归。

**Tech Stack:** React、TypeScript、Tailwind CSS、Vite、Node.js Test Runner

## Global Constraints

- 工具视图固定宽度为 120px。
- 菜单继续右对齐，新增宽度向左扩展。
- 操作行继续使用 44px 高度、现有图标、8px 图文间距和 12px 水平内边距。
- 文件视图继续使用 `calc(100vw - 2rem)`，最大宽度为 420px。
- 三点入口、模型行锚定、Popover 行为、关闭时序、业务动作和桌面布局保持现状。

---

### Task 1: Expand the mobile tools menu

**Files:**
- Modify: `frontend/test/task-detail-mobile-header-layout.test.mjs:79-83,131-136`
- Modify: `frontend/src/pages/console/user/task/task-detail.tsx:1415-1425`

**Interfaces:**
- Consumes: `mobileToolsView: "tools" | "files"` and the existing `PopoverContent` class selection.
- Produces: a 120px tools view while preserving the existing file view width and all event handlers.

- [ ] **Step 1: Write the failing width contract**

In `frontend/test/task-detail-mobile-header-layout.test.mjs`, replace the two 104px assertions with 120px assertions and update the test description:

```js
test("320px 页头使用 120px 工具菜单", () => {
  assert.match(source, /className="flex min-w-0 flex-1 items-center gap-2"/);
  assert.match(source, /className="flex w-11 shrink-0 flex-wrap items-center/);
  assert.match(source, /mobileToolsView === "tools"[\s\S]*?"w-\[120px\] p-1\.5"/);
});
```

Update the dynamic-width assertion in `更多工具使用固定向下的动态宽度单一 Popover`:

```js
assert.match(source, /mobileToolsView === "tools"[\s\S]*?"w-\[120px\] p-1\.5"[\s\S]*?"w-\[calc\(100vw-2rem\)\] max-w-\[420px\] p-0"/);
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
cd frontend
/root/.local/share/pnpm/nodejs/22.23.1/bin/node --test test/task-detail-mobile-header-layout.test.mjs
```

Expected: FAIL in the two width-contract tests because `task-detail.tsx` still contains `w-[104px]`.

- [ ] **Step 3: Implement the 120px tools width**

In `frontend/src/pages/console/user/task/task-detail.tsx`, update only the tools-view class:

```tsx
mobileToolsView === "tools"
  ? "w-[120px] p-1.5"
  : "w-[calc(100vw-2rem)] max-w-[420px] p-0"
```

- [ ] **Step 4: Run focused layout tests**

Run:

```bash
cd frontend
/root/.local/share/pnpm/nodejs/22.23.1/bin/node --test test/task-detail-mobile-header-layout.test.mjs test/task-user-input-index-mobile-layout.test.mjs test/task-chat-input-mobile-layout.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 5: Run frontend verification**

Run:

```bash
cd frontend
/root/.local/share/pnpm/nodejs/22.23.1/bin/node node_modules/eslint/bin/eslint.js src/pages/console/user/task/task-detail.tsx test/task-detail-mobile-header-layout.test.mjs
/root/.local/share/pnpm/nodejs/22.23.1/bin/node node_modules/typescript/bin/tsc -b
/root/.local/share/pnpm/nodejs/22.23.1/bin/node node_modules/vite/bin/vite.js build --mode online
```

Expected: all commands exit 0.

- [ ] **Step 6: Verify the English UI in the existing preview**

Open the mobile task detail page in English at 320px viewport width and confirm:

- `Skills`, `Files`, `Preview`, and `Publish` display without ellipsis.
- The menu right edge remains aligned with the trigger.
- The menu remains inside the viewport.
- The file view and all four actions continue to work.

- [ ] **Step 7: Commit the implementation**

```bash
git add frontend/src/pages/console/user/task/task-detail.tsx frontend/test/task-detail-mobile-header-layout.test.mjs
git commit -m "修复：扩宽移动端英文工具菜单"
```
