# Mobile Model-Row Tools and Index Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anchor the mobile task tools trigger to the model row so both remain vertically aligned while the task page scrolls, and make the message index “Back to bottom” action the same 32px height as “Load more.”

**Architecture:** Make the existing model-row container the positioning context and render the mobile tools Popover subtree inside it with absolute right-edge and vertical-center positioning. Preserve the component-owned state and event flow, remove the viewport Portal, and keep the message index structure and handlers intact while using a uniform 32px footer action height.

**Tech Stack:** React 19, TypeScript, Tailwind CSS 4, Node.js test runner

## Global Constraints

- Keep the model row at `relative` and the trigger at `absolute right-0 top-1/2 z-30 -translate-y-1/2 md:hidden` with `size="icon-sm"`.
- Keep the mobile task header safe space at `pr-10 md:pr-0`.
- Keep Popover placement at `side="bottom"`, `align="end"`, `sideOffset={6}`, and `avoidCollisions={false}`.
- Preserve tool actions, file view, close sequencing, context, and task-owned state.
- Keep both message index actions at `h-8` with their existing `p-1.5` wrappers.
- Preserve message positioning algorithms, history loading behavior, panel dimensions, and item dimensions.
- Add no third-party dependencies, cross-route context, global action slot, or global state.
- Stage only files explicitly listed by each task; every commit requires separate user authorization.

---

### Task 1: Anchor the mobile tools trigger to the model row

**Files:**
- Modify: `frontend/test/task-detail-mobile-header-layout.test.mjs:16-63`
- Modify: `frontend/src/pages/console/user/task/task-detail.tsx:56,1258-1500`

**Interfaces:**
- Consumes: the existing `detailHeader` model-row wrapper and mobile tools Popover subtree.
- Produces: a `relative` model-row positioning context and an absolutely positioned trigger centered on that row, with all existing state and event handlers unchanged.

- [x] **Step 1: Replace the viewport contract with a failing model-row contract test**

Replace the current fixed-position assertions and Portal test in `frontend/test/task-detail-mobile-header-layout.test.mjs` with:

```js
test("手机工具入口锚定模型行并共享滚动参考系", () => {
  assert.match(
    source,
    /<div className="relative flex items-center gap-2 pr-10 md:justify-between md:gap-3 md:pr-0">[\s\S]*?<div className="absolute right-0 top-1\/2 z-30 -translate-y-1\/2 md:hidden">[\s\S]*?<\/Popover>/,
  );
  assert.doesNotMatch(source, /import \{ createPortal \} from "react-dom"/);
  assert.doesNotMatch(source, /createPortal\(|document\.body|fixed right-4 top-\[58px\]/);
});
```

Update the compact-header assertion to require the new absolute class, remove the `60 + 28 / 2 === 58 + 32 / 2` formula, and locate `mobileToolsStart` with the new class string:

```js
assert.match(source, /className="absolute right-0 top-1\/2 z-30 -translate-y-1\/2 md:hidden"[\s\S]*?size="icon-sm"/);

const mobileToolsStart = source.indexOf('<div className="absolute right-0 top-1/2 z-30 -translate-y-1/2 md:hidden">');
```

- [x] **Step 2: Run the focused test and verify RED**

Run from `frontend/`:

```bash
/root/.local/share/pnpm/nodejs/22.23.1/bin/node --test test/task-detail-mobile-header-layout.test.mjs
```

Expected: the new model-row contract fails because the source still uses the body Portal and fixed viewport coordinates.

- [x] **Step 3: Move the Popover subtree into the model-row positioning context**

Remove the React DOM import from `frontend/src/pages/console/user/task/task-detail.tsx`:

```tsx
import { createPortal } from "react-dom"
```

Change the model-row wrapper:

```tsx
      <div className="relative flex items-center gap-2 pr-10 md:justify-between md:gap-3 md:pr-0">
```

Replace the Portal opening and fixed wrapper:

```tsx
          <div className="absolute right-0 top-1/2 z-30 -translate-y-1/2 md:hidden">
```

Replace the Portal closing immediately after the mobile tools `</Popover>`:

```tsx
          </div>
```

Keep the full `Popover`, `PopoverTrigger`, `PopoverContent`, tool actions, and file view content unchanged.

- [x] **Step 4: Run focused tests and verify GREEN**

Run from `frontend/`:

```bash
/root/.local/share/pnpm/nodejs/22.23.1/bin/node --test test/task-detail-mobile-header-layout.test.mjs test/task-user-input-index-mobile-layout.test.mjs
```

Expected: all focused tests pass.

- [x] **Step 5: Verify static quality gates**

Run from `frontend/`:

```bash
/root/.local/share/pnpm/nodejs/22.23.1/bin/node node_modules/eslint/bin/eslint.js src/pages/console/user/task/task-detail.tsx test/task-detail-mobile-header-layout.test.mjs
/root/.local/share/pnpm/nodejs/22.23.1/bin/node node_modules/typescript/bin/tsc -b
```

Expected: all commands exit 0.

- [x] **Step 6: Request authorization and commit Task 1**

After explicit user authorization, run from the repository root:

```bash
git add -- frontend/src/pages/console/user/task/task-detail.tsx frontend/test/task-detail-mobile-header-layout.test.mjs
git commit -m "修复：锚定手机任务工具到模型行"
```

Expected: one commit containing only the two listed files.

### Task 2: Match the message index action heights

**Files:**
- Modify: `frontend/test/task-user-input-index-mobile-layout.test.mjs:41-49`
- Modify: `frontend/src/components/console/task/task-user-input-index.tsx:262-277`

**Interfaces:**
- Consumes: the existing `renderScrollToBottom`, `handleScrollToBottom`, and “Load more” `h-8` contract.
- Produces: a “Back to bottom” action with `h-8` at every breakpoint and unchanged behavior.

- [x] **Step 1: Change the layout test to require equal heights**

Replace the current responsive-height assertion in `frontend/test/task-user-input-index-mobile-layout.test.mjs` with:

```js
  assert.match(source, /"flex h-8 w-full items-center justify-center gap-1\.5 rounded-md text-sm transition-colors"/);
  assert.match(source, /className="h-8 w-full gap-1\.5 text-muted-foreground hover:text-popover-foreground"/);
  assert.doesNotMatch(source, /className="h-11 w-full[^\"]*md:h-8"/);
```

- [x] **Step 2: Run the focused test and verify RED**

Run from `frontend/`:

```bash
/root/.local/share/pnpm/nodejs/22.23.1/bin/node --test test/task-user-input-index-mobile-layout.test.mjs
```

Observed: the uniform `h-8` footer assertion failed against the previous `h-11 ... md:h-8` class.

- [x] **Step 3: Apply the minimal height change**

In `frontend/src/components/console/task/task-user-input-index.tsx`, change only the footer Button class:

```tsx
className="h-8 w-full gap-1.5 text-muted-foreground hover:text-popover-foreground"
```

Keep the outer `p-1.5`, icon, translation key, click handler, and conditional rendering unchanged.

- [x] **Step 4: Run combined focused tests and verify GREEN**

Run from `frontend/`:

```bash
/root/.local/share/pnpm/nodejs/22.23.1/bin/node --test test/task-detail-mobile-header-layout.test.mjs test/task-user-input-index-mobile-layout.test.mjs
```

Observed after the model-row revision: all 20 focused tests passed.

- [x] **Step 5: Run complete verification**

Run from `frontend/`:

```bash
/root/.local/share/pnpm/nodejs/22.23.1/bin/node node_modules/eslint/bin/eslint.js .
/root/.local/share/pnpm/nodejs/22.23.1/bin/node node_modules/typescript/bin/tsc -b
/root/.local/share/pnpm/nodejs/22.23.1/bin/node --test
/root/.local/share/pnpm/nodejs/22.23.1/bin/node node_modules/vite/bin/vite.js build --mode online
```

Observed: ESLint, TypeScript, and online build exited 0. After completing the online preview regression coverage, the complete test suite reported 313 total, 305 passed, and the same eight pre-existing failures after replacing the viewport positioning contract with the model-row contract:

- `项目基础组件使用 consoleProject i18n key`
- `格式化扩展包导入结果`
- `格式化扩展包导入结果时缺省计数按 0 处理`
- `登录页根据服务端 region=en 展示海外登录入口`
- `管理后台挂载 Skills 页面路由和侧边栏入口`
- `添加 Skill 对话框默认选中输入文本并放在上传文件左侧`
- `test/member-seat.test.ts`
- `test/skill-package.test.ts`

- [x] **Step 6: Verify online preview and manual behavior**

Run from `frontend/`:

```bash
PREVIEW_URL=https://4215-e84020e6e952be3c.monkeycode-ai.online /root/.local/share/pnpm/nodejs/22.23.1/bin/node scripts/check-online-preview.mjs
```

Observed: the health check printed `Online preview captcha health check passed.` The user completed logged-in scrolling acceptance and reported no significant issue.

At 320px, 375px, 390px, and 430px widths, verify:

- Scrolling the task page moves the three-dot trigger together with the model row.
- The trigger stays 16px from the viewport right edge and vertically centered with the model button.
- Opening and closing the tools Popover, file view, and follow-up dialogs still works.
- “Load more” and “Back to bottom” have equal 32px heights.

At 1280px, verify the mobile trigger remains hidden and the desktop toolbar is unchanged.

- [x] **Step 7: Request authorization and commit Task 2**

After explicit user authorization, run from the repository root:

```bash
git add -- frontend/src/components/console/task/task-user-input-index.tsx frontend/test/task-user-input-index-mobile-layout.test.mjs
git commit -m "修复：统一消息定位面板动作尺寸"
```

Expected: one commit containing only the two listed files.
