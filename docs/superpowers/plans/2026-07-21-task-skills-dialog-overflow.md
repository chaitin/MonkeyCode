# Task Skills Dialog Overflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep every task-skills dialog element inside the white dialog while preserving horizontal tag scrolling and vertical skill scrolling.

**Architecture:** Apply width constraints at the task-skills dialog's direct Grid child and the shared picker boundaries that own the overflowing tag row. Keep the generic Dialog and Tabs components unchanged so the fix has a narrow regression surface.

**Tech Stack:** React 19, TypeScript 5.9, Radix UI, Tailwind CSS 4, Node.js test runner, ESLint, Vite 7, pnpm.

## Global Constraints

- Continue using `sm:max-w-xl` for the task-skills dialog.
- Keep the generic `Dialog` and generic `TabsList` defaults unchanged.
- Preserve skill loading, searching, tag filtering, selection, saving, and wheel behavior.
- Keep tags on one line and scroll them horizontally inside the dialog.
- Keep the skill list vertically scrollable at its existing fixed height.
- Validate desktop and narrow viewport layouts in an isolated preview environment.
- Do not create a Git commit unless the user explicitly requests one.

## File Map

- Create `frontend/test/task-skills-dialog-layout.test.mjs`: source-level regression checks for the width constraints that prevent Grid and Flex min-content overflow.
- Modify `frontend/src/components/console/task/task-skills-update-dialog.tsx`: constrain the direct Dialog Grid child that contains the picker.
- Modify `frontend/src/components/console/task/task-skill-selector.tsx`: allow the picker root and tag row to shrink, and override the tag list's intrinsic `w-fit` width locally.
- Validate `frontend/src/components/ui/dialog.tsx` and `frontend/src/components/ui/tabs.tsx` remain unchanged.

---

### Task 1: Constrain the Task Skills Dialog Layout

**Files:**

- Create: `frontend/test/task-skills-dialog-layout.test.mjs`
- Modify: `frontend/src/components/console/task/task-skills-update-dialog.tsx:153-166`
- Modify: `frontend/src/components/console/task/task-skill-selector.tsx:202-246`

**Interfaces:**

- Consumes: `TaskSkillsUpdateDialog`, `TaskSkillPickerBody`, the existing `TabsList` horizontal scrolling behavior, and Tailwind utility merging through `cn`.
- Produces: a task-skills dialog whose direct Grid child has zero minimum width and whose picker tag row shrinks within the dialog.

- [ ] **Step 1: Write the failing layout regression test**

Create `frontend/test/task-skills-dialog-layout.test.mjs`:

```javascript
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { twMerge } from "tailwind-merge";

function readSource(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const updateDialog = readSource(
  "../src/components/console/task/task-skills-update-dialog.tsx",
);
const skillSelector = readSource(
  "../src/components/console/task/task-skill-selector.tsx",
);

function extractClassTokens(source, pattern) {
  const match = source.match(pattern);

  assert.ok(match, `未找到布局元素：${pattern}`);
  return new Set(match[1].split(/\s+/));
}

function assertHasClasses(classTokens, expectedClasses) {
  for (const expectedClass of expectedClasses) {
    assert.ok(classTokens.has(expectedClass), `缺少布局类：${expectedClass}`);
  }
}

test("任务技能弹窗限制 Grid 子项宽度", () => {
  const dialogBodyClasses = extractClassTokens(
    updateDialog,
    /<div className="([^"]+)">\s*<TaskSkillPickerBody/,
  );

  assertHasClasses(dialogBodyClasses, ["min-w-0", "max-w-full"]);
  assert.equal(dialogBodyClasses.has("overflow-hidden"), false);
});

test("任务技能标签栏在弹窗宽度内横向滚动", () => {
  const pickerClasses = extractClassTokens(
    skillSelector,
    /<Tabs[\s\S]*?className=\{cn\("([^"]+)", className\)\}/,
  );
  const tagRowClasses = extractClassTokens(
    skillSelector,
    /<div className="([^"]+)">\s*<Button[\s\S]*?<IconChevronLeft/,
  );
  const tabsListClasses = extractClassTokens(
    skillSelector,
    /<TabsList[\s\S]*?className="([^"]+)"/,
  );

  assertHasClasses(pickerClasses, ["min-w-0", "w-full"]);
  assertHasClasses(tagRowClasses, ["min-w-0"]);
  assertHasClasses(tabsListClasses, [
    "min-w-0",
    "w-auto",
    "flex-1",
    "overflow-x-auto",
    "whitespace-nowrap",
  ]);

  const mergedTabsListClasses = twMerge("inline-flex w-fit", [...tabsListClasses].join(" "));
  assert.match(mergedTabsListClasses, /(?:^|\s)w-auto(?:\s|$)/);
  assert.doesNotMatch(mergedTabsListClasses, /(?:^|\s)w-fit(?:\s|$)/);
});
```

- [ ] **Step 2: Run the regression test and verify the initial failure**

Run:

```bash
node --test test/task-skills-dialog-layout.test.mjs
```

Working directory: `frontend`

Expected: two failed tests because the required `min-w-0`, `max-w-full`, and local `w-auto` classes are absent.

- [ ] **Step 3: Apply the minimal dialog and picker constraints**

In `frontend/src/components/console/task/task-skills-update-dialog.tsx`, change the picker wrapper to:

```tsx
<div className="flex h-80 min-h-0 min-w-0 max-w-full flex-col">
```

In `frontend/src/components/console/task/task-skill-selector.tsx`, change the picker root to:

```tsx
className={cn("flex min-h-0 min-w-0 w-full flex-1 flex-col", className)}
```

Change the tag row wrapper to:

```tsx
<div className="flex min-w-0 items-center gap-1">
```

Change the local `TabsList` classes to:

```tsx
className="no-scrollbar h-7 min-w-0 w-auto flex-1 justify-start gap-1 overflow-x-auto overflow-y-hidden bg-background p-0 whitespace-nowrap group-data-horizontal/tabs:h-7"
```

The local `w-auto` class overrides the generic `TabsList` `w-fit` class through `cn`, while `min-w-0 flex-1` allows the list to use the space between the two navigation buttons.

- [ ] **Step 4: Run the new and existing task-skill tests**

Run:

```bash
node --test test/task-skills-dialog-layout.test.mjs test/task-skill-selector-wheel.test.mjs
```

Expected: all tests pass.

- [ ] **Step 5: Verify generic components were not changed**

Run:

```bash
git diff -- frontend/src/components/ui/dialog.tsx frontend/src/components/ui/tabs.tsx
```

Expected: empty output.

### Task 2: Validate Build and Isolated Preview

**Files:**

- Verify: `frontend/src/components/console/task/task-skills-update-dialog.tsx`
- Verify: `frontend/src/components/console/task/task-skill-selector.tsx`
- Verify: `frontend/test/task-skills-dialog-layout.test.mjs`

**Interfaces:**

- Consumes: the constrained dialog from Task 1 and the existing online Vite configuration.
- Produces: passing static checks, a production build, and an isolated preview URL for manual regression.

- [ ] **Step 1: Run targeted ESLint**

Run:

```bash
pnpm exec eslint src/components/console/task/task-skills-update-dialog.tsx src/components/console/task/task-skill-selector.tsx test/task-skills-dialog-layout.test.mjs
```

Working directory: `frontend`

Expected: exit code 0 with no lint errors.

- [ ] **Step 2: Run the online production build**

Run:

```bash
pnpm run build:online
```

Working directory: `frontend`

Expected: TypeScript compilation and Vite build complete successfully, producing `frontend/dist`.

- [ ] **Step 3: Start the isolated online development server**

Use the `deploy-website` skill to start the frontend from this worktree on port `4207` with the online mode equivalent of:

```bash
pnpm run dev:online --host 0.0.0.0 --port 4207
```

Expected: Vite reports a local server on port `4207`, and the platform returns an isolated preview URL.

- [ ] **Step 4: Verify the desktop layout**

Open a task detail page in the isolated preview, then click the top-right “技能” button next to “终端”. Use a task whose skill data includes enough tags to overflow the available label width.

Expected:

- The white dialog remains centered at `sm:max-w-xl`.
- The title, description, search field, tag row, skill list, and Footer remain inside the dialog.
- The left and right tag navigation buttons remain visible.
- The tag list scrolls horizontally.
- The skill list scrolls vertically.
- Cancel and Save remain in the dialog's lower-right corner.

- [ ] **Step 5: Verify the narrow viewport layout**

Set the browser viewport below the `sm` breakpoint and reopen the task-skills dialog.

Expected:

- The dialog respects `max-w-[calc(100%-2rem)]`.
- No visible content crosses the white dialog boundary.
- Search, tag scrolling, skill scrolling, Cancel, and Save remain usable.

- [ ] **Step 6: Inspect the final working-tree diff**

Run:

```bash
git status --short
git diff --check
git diff -- frontend/src/components/console/task/task-skills-update-dialog.tsx frontend/src/components/console/task/task-skill-selector.tsx
git diff --no-index /dev/null frontend/test/task-skills-dialog-layout.test.mjs
git diff --no-index /dev/null docs/superpowers/specs/2026-07-21-task-skills-dialog-overflow-design.md
git diff --no-index /dev/null docs/superpowers/plans/2026-07-21-task-skills-dialog-overflow.md
```

Expected: only the design, plan, two component changes, and one regression test appear. Each `git diff --no-index` command exits with status 1 because it intentionally compares a new file with `/dev/null`; its output contains the complete new file. `git diff --check` reports no whitespace errors.
