# Issue #936 Task Dialog Overflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the stop-task and delete-task confirmation actions visible when a task name is longer than the viewport.

**Architecture:** Apply viewport height and two-row grid constraints only to the two task action dialogs in `NavProject`. Make each dialog header a keyboard-accessible scrollable region, keep its footer outside that region, and add a source-contract regression test matching the frontend test conventions.

**Tech Stack:** React 19, TypeScript, Tailwind CSS 4, Radix AlertDialog, Node test runner, tsx, pnpm, Vite

## Global Constraints

- Modify only the project navigation task dialogs and their focused regression test.
- Keep the shared `AlertDialog`, APIs, state handling, i18n resources, and region logic unchanged.
- Cover both stop-task and delete-task dialogs.
- Preserve complete task names while supporting continuous strings and normal word wrapping.
- Run the focused test, frontend lint, online build, and overseas SaaS preview.
- Commit implementation only after the user approves the preview.

---

### Task 1: Constrain task action dialogs to the viewport

**Files:**
- Create: `frontend/test/console-nav-project-dialog-layout.test.ts`
- Modify: `frontend/src/components/console/nav/nav-project.tsx:409-454`

**Interfaces:**
- Consumes: the existing `AlertDialogContent`, `AlertDialogHeader`, `AlertDialogDescription`, and `AlertDialogFooter` components
- Produces: two dialogs with scrollable descriptions and always-visible action footers

- [x] **Step 1: Add the failing layout contract test**

Create `frontend/test/console-nav-project-dialog-layout.test.ts`:

```typescript
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(
  new URL("../src/components/console/nav/nav-project.tsx", import.meta.url),
  "utf8",
)

function countOccurrences(value: string) {
  return source.split(value).length - 1
}

test("任务操作弹窗限制在视口内并保持操作区可见", () => {
  assert.equal(
    countOccurrences(
      'className="max-h-[calc(100dvh-2rem)] grid-rows-[minmax(0,1fr)_auto] overflow-hidden"',
    ),
    2,
  )
  assert.equal(
    countOccurrences('className="min-h-0 overflow-y-auto overscroll-contain"'),
    2,
  )
  assert.equal(
    countOccurrences('className="break-words [overflow-wrap:anywhere]"'),
    2,
  )
})
```

- [x] **Step 2: Run the test and confirm the regression**

Run:

```bash
tsx --test frontend/test/console-nav-project-dialog-layout.test.ts
```

Expected: FAIL because all three occurrence counts are `0` instead of `2`.

- [x] **Step 3: Apply the layout constraints to both dialogs**

On both the delete-task and stop-task dialogs, replace the three existing opening tags with these exact tags. Keep every child node, footer, handler, disabled state, and localized string in its current order:

```tsx
<AlertDialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[minmax(0,1fr)_auto] overflow-hidden">
<AlertDialogHeader
  role="region"
  tabIndex={0}
  aria-label={t("navProject.deleteTask.title")}
  className="min-h-0 overflow-y-auto overscroll-contain outline-hidden ring-ring focus-visible:ring-2 focus-visible:ring-inset"
>
<AlertDialogDescription className="break-words [overflow-wrap:anywhere]">
```

- [x] **Step 4: Run focused frontend tests**

Run:

```bash
tsx --test frontend/test/console-nav-project-dialog-layout.test.ts frontend/test/console-nav-project-i18n.test.ts
```

Expected: 3 tests pass.

- [x] **Step 5: Run frontend static validation**

Run:

```bash
pnpm --dir frontend lint
pnpm --dir frontend run build:online
git diff --check
```

Expected: lint and online build succeed; `git diff --check` has no output. Existing Vite chunk-size warnings may remain informational.

- [x] **Step 6: Start the overseas SaaS preview**

Run the Vite development server from `frontend` with:

```bash
TARGET=https://monkeycode-ai.net pnpm dev:online
```

Use an available preview port. At 100% browser zoom, verify both dialogs with a roughly 600-word task name at desktop 1366×768 and a mobile viewport. The task name region scrolls, the footer remains visible, and cancel/confirm actions remain clickable.

Preview evidence: the overseas SaaS preview was served successfully on 2026-08-05, and the user confirmed the rendered result looked correct before authorizing the commit and pull request.

- [x] **Step 7: Present evidence and wait for commit approval**

Show the changed files, focused test results, lint result, online build result, preview URL, and manual verification checklist. After user approval, stage only:

```bash
git add docs/superpowers/specs/2026-08-05-issue-936-task-dialog-overflow-design.md docs/superpowers/plans/2026-08-05-issue-936-task-dialog-overflow.md frontend/src/components/console/nav/nav-project.tsx frontend/test/console-nav-project-dialog-layout.test.ts
git commit -m "修复：限制任务操作弹窗高度"
```
