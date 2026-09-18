# Task Preview Dialog Description Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve Issue #915 by giving the task preview dialog an accessible description without changing its visible layout or interaction.

**Architecture:** Reuse the existing Radix-backed `DialogDescription` component and the existing `taskDetail.preview` translation namespace. Extend the existing source-structure regression test so removal of the accessible description or either locale string fails immediately.

**Tech Stack:** React 19, TypeScript, Radix UI, i18next resources, Node.js test runner, ESLint, Vite.

## Global Constraints

- Keep the description visually hidden with `sr-only`.
- Add Chinese and English copy under `taskDetail.preview.description`.
- Preserve the existing task preview layout and behavior.
- Run the targeted test, ESLint, and online build.
- Keep commit, push, and PR creation behind separate explicit authorization.

---

### Task 1: Add the accessible task preview description

**Files:**
- Modify: `frontend/test/task-detail-preview-publish.test.ts`
- Modify: `frontend/src/pages/console/user/task/task-detail.tsx:1614-1635`
- Modify: `frontend/src/i18n/resources/cn.ts:4305-4311`
- Modify: `frontend/src/i18n/resources/en.ts:4305-4311`

**Interfaces:**
- Consumes: existing `DialogDescription` and `t("taskDetail.preview.description")` translation lookup.
- Produces: a Radix dialog description associated with the task preview `DialogContent`.

- [x] **Step 1: Write the failing regression test**

Add assertions that the preview dialog contains a screen-reader-only description and both locales define the exact copy:

```ts
assert.match(
  previewDialogMatch[0],
  /<DialogDescription className="sr-only">[\s\S]*?taskDetail\.preview\.description[\s\S]*?<\/DialogDescription>/,
);
assert.equal(cn.taskDetail.preview.description, "查看开发环境中可访问的端口预览");
assert.equal(en.taskDetail.preview.description, "View accessible port previews from the development environment");
```

- [x] **Step 2: Run the targeted test and verify failure**

Run: `tsx --test test/task-detail-preview-publish.test.ts`

Expected: FAIL because the preview dialog and locale resources do not yet contain `taskDetail.preview.description`.

- [x] **Step 3: Add the minimal implementation**

Place the description directly after the existing title while preserving the compact horizontal header:

```tsx
<DialogDescription className="sr-only">
  {t("taskDetail.preview.description")}
</DialogDescription>
```

Add these locale entries:

```ts
description: "查看开发环境中可访问的端口预览",
```

```ts
description: "View accessible port previews from the development environment",
```

- [x] **Step 4: Verify the targeted behavior**

Run: `tsx --test test/task-detail-preview-publish.test.ts`

Expected: PASS.

- [x] **Step 5: Run frontend quality checks**

Run: `pnpm exec eslint src/pages/console/user/task/task-detail.tsx src/i18n/resources/cn.ts src/i18n/resources/en.ts test/task-detail-preview-publish.test.ts`

Expected: exit code 0.

Run: `pnpm run build:online`

Expected: exit code 0.

- [x] **Step 6: Build a test environment**

Start Vite in online mode with the API proxy target configured, request a preview URL, open the task preview dialog, and verify the console no longer emits the missing description warning.

- [x] **Step 7: Commit after explicit authorization**

```bash
git add docs/superpowers/plans/2026-07-24-task-preview-dialog-description.md frontend/test/task-detail-preview-publish.test.ts frontend/src/pages/console/user/task/task-detail.tsx frontend/src/i18n/resources/cn.ts frontend/src/i18n/resources/en.ts
git commit -m "修复：补充任务预览弹窗无障碍描述"
```
