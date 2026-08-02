# Mobile Task Chat Input Overlap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Web 任务对话页在手机浏览器中因 block addon 纵向布局失效而产生的输入框、工具按钮和发送按钮重叠。

**Architecture:** 为共享 `InputGroup` 增加显式 `orientation` 契约，让关键纵向布局不再依赖 CSS `:has()`；三个 block addon 调用点统一声明纵向布局。任务对话输入栏在此基础上使用“左侧可滚动工具区 + 右侧固定发送区”的移动布局，桌面端保持现状。

**Tech Stack:** React 19、TypeScript 5.9、Tailwind CSS 4、shadcn、Node.js test runner、ESLint、Vite 7、pnpm。

## Global Constraints

- block addon 的关键布局必须由 React 属性显式声明。
- 320px 及以上宽度必须保持输入区、工具区和发送区互不重叠。
- 手机端高频操作触控区域至少为 44px。
- 页面不得因任务输入栏产生横向滚动。
- 桌面端现有视觉、文案和交互必须保持一致。
- React Native 输入栏、消息数据流、附件上传逻辑、语音逻辑和发送状态机保持原实现。
- 所有功能修改遵循 RED-GREEN-REFACTOR。
- 每次 commit 前必须展示精确提交范围并取得用户明确授权。

## File Map

- Create `frontend/test/input-group-orientation.test.mjs`: 验证共享 orientation 契约和三个 block addon 调用点。
- Modify `frontend/src/components/ui/input-group.tsx`: 增加默认横向、可显式纵向的布局属性。
- Modify `frontend/src/components/console/task/task-input.tsx`: 为新任务输入框声明纵向布局。
- Modify `frontend/src/components/console/task/task-chat-section.tsx`: 为后续变更输入框声明纵向布局。
- Create `frontend/test/task-chat-input-mobile-layout.test.mjs`: 验证任务对话输入栏的移动端宽度、滚动、触控和可访问性约束。
- Modify `frontend/src/components/console/task/chat-inputbox.tsx`: 应用纵向布局，隔离左右工具区并压缩手机端发送按钮。

---

### Task 1: Add the Explicit InputGroup Orientation Contract

**Files:**

- Create: `frontend/test/input-group-orientation.test.mjs`
- Modify: `frontend/src/components/ui/input-group.tsx:9-21`
- Modify: `frontend/src/components/console/task/chat-inputbox.tsx:1100`
- Modify: `frontend/src/components/console/task/task-input.tsx:346`
- Modify: `frontend/src/components/console/task/task-chat-section.tsx:154`

**Interfaces:**

- Consumes: existing `React.ComponentProps<"div">`, `cn`, and `InputGroupAddon align="block-end"` behavior.
- Produces: `InputGroupProps` with `orientation?: "horizontal" | "vertical"`; default horizontal layout; explicit vertical layout through `orientation="vertical"`.

- [ ] **Step 1: Write the failing orientation contract test**

Create `frontend/test/input-group-orientation.test.mjs`:

```javascript
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readSource(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const inputGroupSource = readSource("../src/components/ui/input-group.tsx");
const blockInputSources = {
  chatInput: readSource("../src/components/console/task/chat-inputbox.tsx"),
  taskInput: readSource("../src/components/console/task/task-input.tsx"),
  chatSection: readSource("../src/components/console/task/task-chat-section.tsx"),
};

test("InputGroup 提供显式纵向布局且默认保持横向", () => {
  assert.match(
    inputGroupSource,
    /orientation\?: "horizontal" \| "vertical"/,
  );
  assert.match(inputGroupSource, /orientation = "horizontal"/);
  assert.match(inputGroupSource, /data-orientation=\{orientation\}/);
  assert.match(
    inputGroupSource,
    /orientation === "vertical" && "h-auto flex-col items-stretch"/,
  );
});

test("所有 block-end 输入组显式声明纵向布局", () => {
  for (const [name, source] of Object.entries(blockInputSources)) {
    assert.match(
      source,
      /<InputGroup\s+orientation="vertical"/,
      `${name} 缺少 vertical orientation`,
    );
    assert.match(source, /<InputGroupAddon align="block-end"/);
  }
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node --test test/input-group-orientation.test.mjs
```

Working directory: `frontend`

Expected: both tests fail because `InputGroup` has no orientation prop and all three call sites omit it.

- [ ] **Step 3: Add the minimal InputGroup orientation implementation**

Replace the current `InputGroup` declaration in `frontend/src/components/ui/input-group.tsx` with:

```tsx
interface InputGroupProps extends React.ComponentProps<"div"> {
  orientation?: "horizontal" | "vertical"
}

function InputGroup({
  className,
  orientation = "horizontal",
  ...props
}: InputGroupProps) {
  return (
    <div
      data-slot="input-group"
      data-orientation={orientation}
      role="group"
      className={cn(
        "group/input-group relative flex h-9 w-full min-w-0 items-center rounded-md border border-input shadow-xs transition-[color,box-shadow] outline-none in-data-[slot=combobox-content]:focus-within:border-inherit in-data-[slot=combobox-content]:focus-within:ring-0 has-[[data-slot=input-group-control]:focus-visible]:border-ring has-[[data-slot=input-group-control]:focus-visible]:ring-3 has-[[data-slot=input-group-control]:focus-visible]:ring-ring/50 has-[[data-slot][aria-invalid=true]]:border-destructive has-[[data-slot][aria-invalid=true]]:ring-3 has-[[data-slot][aria-invalid=true]]:ring-destructive/20 has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col has-[>textarea]:h-auto dark:bg-input/30 dark:has-[[data-slot][aria-invalid=true]]:ring-destructive/40 has-[>[data-align=block-end]]:[&>input]:pt-3 has-[>[data-align=block-start]]:[&>input]:pb-3 has-[>[data-align=inline-end]]:[&>input]:pr-1.5 has-[>[data-align=inline-start]]:[&>input]:pl-1.5",
        orientation === "vertical" && "h-auto flex-col items-stretch",
        className
      )}
      {...props}
    />
  )
}
```

Keep all existing `has-*` classes so existing callers receive the same progressive enhancement.

- [ ] **Step 4: Migrate the three block addon call sites**

In `frontend/src/components/console/task/chat-inputbox.tsx`, change:

```tsx
<InputGroup orientation="vertical">
```

In `frontend/src/components/console/task/task-input.tsx`, change:

```tsx
<InputGroup orientation="vertical" className="rounded-4xl p-2 pb-0">
```

In `frontend/src/components/console/task/task-chat-section.tsx`, change:

```tsx
<InputGroup orientation="vertical" className="rounded-lg">
```

- [ ] **Step 5: Run the orientation test and verify GREEN**

Run:

```bash
node --test test/input-group-orientation.test.mjs
```

Working directory: `frontend`

Expected: 2 tests pass.

- [ ] **Step 6: Run targeted lint**

Run:

```bash
pnpm exec eslint src/components/ui/input-group.tsx src/components/console/task/chat-inputbox.tsx src/components/console/task/task-input.tsx src/components/console/task/task-chat-section.tsx test/input-group-orientation.test.mjs
```

Working directory: `frontend`

Expected: exit code 0 with no lint errors.

- [ ] **Step 7: Request commit authorization and commit Task 1**

After explicit user authorization, run:

```bash
git add frontend/src/components/ui/input-group.tsx frontend/src/components/console/task/chat-inputbox.tsx frontend/src/components/console/task/task-input.tsx frontend/src/components/console/task/task-chat-section.tsx frontend/test/input-group-orientation.test.mjs
git commit -m "修复：显式声明输入组纵向布局"
```

Expected: one commit containing only the shared orientation contract, three migrations, and its regression test.

### Task 2: Make the Task Chat Composer Stable on Mobile

**Files:**

- Create: `frontend/test/task-chat-input-mobile-layout.test.mjs`
- Modify: `frontend/src/components/console/task/chat-inputbox.tsx:1100-1266`

**Interfaces:**

- Consumes: `InputGroup orientation="vertical"` from Task 1, existing `VoiceInputButton.className`, `InputGroupButton`, send-state logic, and upload controls.
- Produces: a full-width textarea; a horizontally scrollable left tool region; a fixed right action region; icon-only 44px send controls below 640px with accessible labels.

- [ ] **Step 1: Write the failing mobile layout regression test**

Create `frontend/test/task-chat-input-mobile-layout.test.mjs`:

```javascript
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/components/console/task/chat-inputbox.tsx", import.meta.url),
  "utf8",
);

test("任务对话输入栏在窄屏隔离输入区和操作区", () => {
  assert.match(
    source,
    /className="min-h-8 min-w-0 w-full max-h-36 resize-none overflow-y-auto/,
  );
  assert.match(
    source,
    /className="flex w-full min-w-0 flex-row items-center justify-between gap-2"/,
  );
  assert.match(
    source,
    /className="no-scrollbar flex min-w-0 flex-1 flex-row items-center gap-2 overflow-x-auto"/,
  );
  assert.match(
    source,
    /className="flex shrink-0 flex-row items-center gap-2"/,
  );
});

test("手机端操作保持 44px 触控区和发送可访问名称", () => {
  const mobileTouchTargets = source.match(/max-sm:size-11/g) ?? [];
  assert.ok(mobileTouchTargets.length >= 6);
  assert.match(source, /aria-label=\{t\("taskDetail\.common\.send"\)\}/);
  assert.match(
    source,
    /<span className="max-sm:hidden">\{t\("taskDetail\.common\.send"\)\}<\/span>/,
  );
  assert.match(
    source,
    /<VoiceInputButton[\s\S]*?className="max-sm:min-h-11 max-sm:min-w-11"/,
  );
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node --test test/task-chat-input-mobile-layout.test.mjs
```

Working directory: `frontend`

Expected: both tests fail because the input and action regions lack the required mobile constraints.

- [ ] **Step 3: Constrain the textarea and footer regions**

In `frontend/src/components/console/task/chat-inputbox.tsx`, change the textarea class to:

```tsx
className="min-h-8 min-w-0 w-full max-h-36 resize-none overflow-y-auto text-sm break-all [field-sizing:content] disabled:opacity-80"
```

Replace the addon opening tag and the three wrapper opening tags with these exact tags, keeping their existing children and closing tags in place:

```tsx
<InputGroupAddon align="block-end" className="min-w-0 pb-1.5">
<div className="flex w-full min-w-0 flex-row items-center justify-between gap-2">
<div className="no-scrollbar flex min-w-0 flex-1 flex-row items-center gap-2 overflow-x-auto">
<div className="flex shrink-0 flex-row items-center gap-2">
```

Only these class attributes change in this step; control order, children, closing tags, and event handlers remain unchanged.

- [ ] **Step 4: Add mobile touch sizing to icon controls**

Change the command, upload, and whiteboard button classes from `rounded-full` to:

```tsx
className="rounded-full max-sm:size-11"
```

Pass the mobile sizing class to `VoiceInputButton`:

```tsx
<VoiceInputButton
  className="max-sm:min-h-11 max-sm:min-w-11"
  onTextRecognized={handleTextRecognized}
  disabled={!canEditContent || !!queuedInput}
/>
```

Use minimum dimensions for voice input because its recording state contains a visible text label and must be allowed to grow wider than 44px.

- [ ] **Step 5: Compact every send state below 640px**

For the queued input button, retain the loader and existing desktop labels, add the mobile size classes, and expose the current action through `aria-label`:

```tsx
<InputGroupButton
  aria-label={autoSendingQueuedInput
    ? t("taskDetail.chat.autoSending")
    : t("taskDetail.chat.cancelAutoSend")}
  className="group/auto-send flex flex-row items-center gap-2 max-sm:size-11 max-sm:justify-center max-sm:p-0"
  variant="outline"
  size="sm"
  onClick={cancelQueuedInput}
  disabled={autoSendingQueuedInput}
>
  <IconLoader className="size-4 shrink-0 animate-spin" />
  {autoSendingQueuedInput ? (
    <span className="max-sm:hidden">{t("taskDetail.chat.autoSending")}</span>
  ) : (
    <>
      <span className="max-sm:hidden group-hover/auto-send:hidden">{t("taskDetail.chat.waitingAutoSend")}</span>
      <span className="hidden group-hover/auto-send:inline max-sm:hidden">{t("taskDetail.chat.cancelAutoSend")}</span>
    </>
  )}
</InputGroupButton>
```

Replace the executing send button with:

```tsx
<InputGroupButton
  aria-label={t("taskDetail.common.send")}
  className="flex flex-row items-center gap-2 max-sm:size-11 max-sm:justify-center max-sm:p-0"
  variant="default"
  size="sm"
  onClick={handleSend}
  disabled={!canSend}
>
  <IconSend />
  <span className="max-sm:hidden">{t("taskDetail.common.send")}</span>
</InputGroupButton>
```

Replace the idle send button with:

```tsx
<InputGroupButton
  aria-label={t("taskDetail.common.send")}
  className="flex flex-row items-center gap-2 max-sm:size-11 max-sm:justify-center max-sm:p-0"
  variant="default"
  size="sm"
  onClick={handleSend}
  disabled={!canSend || !canUseIdleControls}
>
  <IconSend />
  <span className="max-sm:hidden">{t("taskDetail.common.send")}</span>
</InputGroupButton>
```

- [ ] **Step 6: Run the mobile layout and orientation tests**

Run:

```bash
node --test test/input-group-orientation.test.mjs test/task-chat-input-mobile-layout.test.mjs
```

Working directory: `frontend`

Expected: 4 tests pass.

- [ ] **Step 7: Run targeted lint**

Run:

```bash
pnpm exec eslint src/components/console/task/chat-inputbox.tsx test/task-chat-input-mobile-layout.test.mjs
```

Working directory: `frontend`

Expected: exit code 0 with no lint errors.

- [ ] **Step 8: Request commit authorization and commit Task 2**

After explicit user authorization, run:

```bash
git add frontend/src/components/console/task/chat-inputbox.tsx frontend/test/task-chat-input-mobile-layout.test.mjs
git commit -m "修复：适配移动端任务对话输入栏"
```

Expected: one commit containing only the task composer responsive behavior and its regression test.

### Task 3: Validate the Complete Mobile Composer Fix

**Files:**

- Verify: `frontend/src/components/ui/input-group.tsx`
- Verify: `frontend/src/components/console/task/chat-inputbox.tsx`
- Verify: `frontend/src/components/console/task/task-input.tsx`
- Verify: `frontend/src/components/console/task/task-chat-section.tsx`
- Verify: `frontend/test/input-group-orientation.test.mjs`
- Verify: `frontend/test/task-chat-input-mobile-layout.test.mjs`

**Interfaces:**

- Consumes: Tasks 1 and 2.
- Produces: passing frontend tests, lint, online production build, whitespace validation, and a completed responsive preview acceptance check.

- [ ] **Step 1: Run the focused regression suite**

Run:

```bash
node --test test/input-group-orientation.test.mjs test/task-chat-input-mobile-layout.test.mjs
```

Working directory: `frontend`

Expected: 4 tests pass.

- [ ] **Step 2: Run the complete frontend test suite**

Run:

```bash
node --test test/*.test.ts test/*.test.mjs
```

Working directory: `frontend`

Expected: all frontend tests pass with exit code 0.

- [ ] **Step 3: Run full frontend lint**

Run:

```bash
pnpm run lint
```

Working directory: `frontend`

Expected: ESLint exits with code 0.

- [ ] **Step 4: Run the online production build**

Run:

```bash
pnpm run build:online
```

Working directory: `frontend`

Expected: TypeScript and Vite complete successfully and produce `frontend/dist`.

- [ ] **Step 5: Validate whitespace and exact change scope**

Run:

```bash
git diff --check origin/main...HEAD
git status --short --branch
```

Working directory: repository root.

Expected: `git diff --check` prints nothing; status shows a clean worktree on `260725-fix-mobile-chat-input-overlap`.

- [ ] **Step 6: Start the isolated online preview**

Use the `deploy-website` skill to start the frontend from this worktree with the online-mode equivalent of:

```bash
pnpm run dev:online --host 0.0.0.0 --port 4215
```

Working directory: `frontend`

Expected: Vite starts successfully and the platform preview URL loads the Web console.

- [ ] **Step 7: Complete responsive manual acceptance**

In browser responsive mode, verify widths 320px, 375px, 390px, and 430px with:

- empty input and the full Chinese/English placeholder
- one line, three lines, and content exceeding the textarea maximum height
- zero, one, and three uploaded attachments
- idle, executing, queued, and auto-sending states
- voice input present and unavailable
- software keyboard opened and closed

Expected for every case:

- textarea text remains inside its rounded border
- no input, tool, voice, or send control overlaps another control
- send remains visible and tappable
- touch targets are at least 44px below 640px
- task page has no horizontal scroll
- desktop width 1280px matches the pre-fix layout
