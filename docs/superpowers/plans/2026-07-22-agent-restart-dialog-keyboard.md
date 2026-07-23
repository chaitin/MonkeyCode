# Agent Restart Dialog Keyboard Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add left and right arrow focus navigation to both Agent restart confirmation modes tracked by Issue #910.

**Architecture:** Keep the behavior local to `TaskDetailPage` and mirror the slash-command dialog implementation from PR #863. Add source-level regression coverage using the repository's existing Node test pattern, then verify lint, TypeScript, and the online Vite build.

**Tech Stack:** React 19, TypeScript 5.9, Radix AlertDialog, Node `node:test`, ESLint 9, Vite 7

## Global Constraints

- `ArrowLeft` focuses Cancel and prevents the default action.
- `ArrowRight` focuses Confirm and prevents the default action.
- `Enter` keeps the native behavior of the focused action.
- `Tab`, `Shift+Tab`, and `Escape` continue to use Radix AlertDialog behavior.
- The restart request, loading state, close behavior, copy, and visual layout remain unchanged.
- Shared UI primitives and unrelated dialogs remain unchanged.

---

### Task 1: Agent Restart Dialog Keyboard Navigation

**Files:**
- Create: `frontend/test/task-restart-dialog-keyboard.test.mjs`
- Modify: `frontend/src/pages/console/user/task/task-detail.tsx:20-28,111-140,974-997,1472-1506`

**Interfaces:**
- Consumes: `AlertDialogCancel`, `Button`, `React.KeyboardEvent<HTMLDivElement>`, and the existing `handleConfirmRestartAgent(): Promise<void>` callback.
- Produces: `handleRestartAgentDialogKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void`, `restartAgentCancelRef`, and `restartAgentConfirmRef` within `TaskDetailPage`.

- [x] **Step 1: Write the failing source regression test**

Create `frontend/test/task-restart-dialog-keyboard.test.mjs`:

```javascript
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(
  new URL("../src/pages/console/user/task/task-detail.tsx", import.meta.url),
  "utf8",
);

test("Agent 重启确认弹窗支持左右方向键切换操作按钮", () => {
  assert.match(pageSource, /const restartAgentCancelRef = React\.useRef<HTMLButtonElement>\(null\)/);
  assert.match(pageSource, /const restartAgentConfirmRef = React\.useRef<HTMLButtonElement>\(null\)/);

  const handlerStart = pageSource.indexOf("const handleRestartAgentDialogKeyDown");
  const handlerEnd = pageSource.indexOf("const handleConfirmRestartAgent", handlerStart);
  assert.notEqual(handlerStart, -1, "restart dialog should define an arrow-key handler");
  assert.notEqual(handlerEnd, -1, "restart handler should precede the confirm callback");
  const handlerSource = pageSource.slice(handlerStart, handlerEnd);
  const leftBranch = handlerSource.match(/if \(event\.key === "ArrowLeft"\) \{([\s\S]*?)\n    \}/);
  const rightBranch = handlerSource.match(/if \(event\.key === "ArrowRight"\) \{([\s\S]*?)\n    \}/);
  assert.ok(leftBranch, "restart handler should handle ArrowLeft");
  assert.ok(rightBranch, "restart handler should handle ArrowRight");
  assert.match(leftBranch[1], /event\.preventDefault\(\)/);
  assert.match(leftBranch[1], /restartAgentCancelRef\.current\?\.focus\(\)/);
  assert.match(rightBranch[1], /event\.preventDefault\(\)/);
  assert.match(rightBranch[1], /restartAgentConfirmRef\.current\?\.focus\(\)/);
  assert.doesNotMatch(handlerSource, /event\.key === "Enter"/);

  const dialogMatch = pageSource.match(
    /<AlertDialog\s+open=\{restartAgentDialogOpen\}[\s\S]*?<\/AlertDialog>/,
  );
  assert.ok(dialogMatch, "restart dialog should be present");
  assert.match(dialogMatch[0], /<AlertDialogContent onKeyDown=\{handleRestartAgentDialogKeyDown\}>/);
  assert.match(dialogMatch[0], /<AlertDialogCancel ref=\{restartAgentCancelRef\} disabled=\{restartAgentSubmitting\}>/);
  assert.doesNotMatch(dialogMatch[0], /<AlertDialogAction/);
  const confirmMatch = dialogMatch[0].match(/<Button\s+ref=\{restartAgentConfirmRef\}[\s\S]*?<\/Button>/);
  assert.ok(confirmMatch, "restart confirm should remain a plain Button");
  assert.match(confirmMatch[0], /type="button"/);
  assert.match(confirmMatch[0], /void handleConfirmRestartAgent\(\)/);
  assert.match(confirmMatch[0], /disabled=\{restartAgentSubmitting\}/);
  assert.match(confirmMatch[0], /restartAgentSubmitting && <Spinner/);
});
```

- [x] **Step 2: Run the focused test and verify the expected failure**

Run:

```bash
node --test test/task-restart-dialog-keyboard.test.mjs
```

Working directory: `frontend`

Expected: FAIL on the missing refs or keyboard handler.

- [x] **Step 3: Implement the minimal dialog behavior**

Add the action refs beside the existing page refs:

```typescript
const restartAgentCancelRef = React.useRef<HTMLButtonElement>(null)
const restartAgentConfirmRef = React.useRef<HTMLButtonElement>(null)
```

Add the keydown handler beside the existing restart callbacks:

```typescript
const handleRestartAgentDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
  if (event.key === "ArrowLeft") {
    event.preventDefault()
    restartAgentCancelRef.current?.focus()
    return
  }

  if (event.key === "ArrowRight") {
    event.preventDefault()
    restartAgentConfirmRef.current?.focus()
  }
}
```

Add the handler to the Agent restart dialog content:

```tsx
<AlertDialogContent onKeyDown={handleRestartAgentDialogKeyDown}>
```

Replace the restart Cancel action with:

```tsx
<AlertDialogCancel ref={restartAgentCancelRef} disabled={restartAgentSubmitting}>
  {t("taskDetail.common.cancel")}
</AlertDialogCancel>
```

Attach the ref to the existing restart Confirm button:

```tsx
<Button
  ref={restartAgentConfirmRef}
  type="button"
  onClick={() => {
    void handleConfirmRestartAgent()
  }}
  disabled={restartAgentSubmitting}
>
  {restartAgentSubmitting && <Spinner className="mr-2 size-4" />}
  {t("taskDetail.page.dialogs.confirm")}
</Button>
```

- [x] **Step 4: Run the focused test and verify success**

Run:

```bash
node --test test/task-restart-dialog-keyboard.test.mjs
```

Working directory: `frontend`

Expected: 1 test passes and 0 tests fail.

- [x] **Step 5: Run targeted lint**

Run:

```bash
pnpm exec eslint src/pages/console/user/task/task-detail.tsx test/task-restart-dialog-keyboard.test.mjs
```

Working directory: `frontend`

Expected: exit code 0 with no lint errors.

- [x] **Step 6: Run the online frontend build**

Run:

```bash
pnpm run build:online
```

Working directory: `frontend`

Expected: TypeScript and Vite build complete successfully.

- [x] **Step 7: Review and commit the implementation**

Review:

```bash
git diff --check
git diff -- frontend/src/pages/console/user/task/task-detail.tsx frontend/test/task-restart-dialog-keyboard.test.mjs
```

Commit:

```bash
git add frontend/src/pages/console/user/task/task-detail.tsx frontend/test/task-restart-dialog-keyboard.test.mjs
git commit -m "fix(frontend): support keyboard navigation in restart dialog"
```

Expected: one implementation commit containing the dialog behavior, regression test, and execution-plan status updates.

---

### Task 2: Manual Preview Verification

**Files:**
- Modify: none

**Interfaces:**
- Consumes: the completed Issue #910 branch build.
- Produces: a local preview URL for manual acceptance testing.

- [x] **Step 1: Start the project with the deploy-website skill**

Start the frontend and required backend services from the Issue #910 worktree using the repository's existing development commands and proxy configuration.

Expected: the preview URL responds successfully and the task page loads.

- [x] **Step 2: Verify both restart modes manually**

For “Restart Agent” and “Restart Agent and clear context”:

1. Open the confirmation dialog.
2. Press `ArrowLeft` and verify Cancel receives focus.
3. Press `ArrowRight` and verify Confirm receives focus.
4. Press `Enter` and verify the focused action executes.
5. Reopen the dialog, press `Escape`, and verify it closes.

Expected: both restart modes satisfy Issue #910 without changing loading, disabled, or close behavior.
