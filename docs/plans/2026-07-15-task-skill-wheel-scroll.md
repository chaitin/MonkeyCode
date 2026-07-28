# 启动任务技能列表滚轮修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让“创建任务”和“启动 AI 任务”弹窗中的技能列表支持鼠标滚轮和触控板纵向滚动。

**Architecture:** 共享 `TaskSkillSelector` 接收可选 `enableWheelScrollFallback` 属性。“创建任务”和“启动 AI 任务”入口启用滚轮回退，通过回调 ref 跟踪 Portal 中稳定的 `PopoverContent` 节点。容器上的原生 `wheel` 监听器从事件目标定位活动技能列表，通过 `deltaMode` 换算后主动更新 `scrollTop`；该实现避开 PR #874 修改的 `TabsContent` 渲染结构。独立临时 worktree 组合 PR #871、PR #874 和 Issue #875，用于统一构建和预览。

**Tech Stack:** React 19、TypeScript、Radix UI、Node.js test runner、Vite。

## Global Constraints

- 修复范围限定为“创建任务”和“启动 AI 任务”入口。
- 保持搜索、标签筛选、技能勾选及其他任务入口行为。
- PR #874 和 Issue #875 按任意顺序合并时不产生文本冲突。
- 纵向滚轮回退不处理纯横向手势和 `Ctrl+滚轮`。
- 执行 `pnpm lint` 和 `pnpm run build:online`。
- 完成 SaaS 预览并由用户验收后再提交代码。

---

### Task 1: 更新入口范围回归测试

**Files:**
- Modify: `frontend/test/task-skill-selector-wheel.test.mjs`
- Read: `frontend/src/components/console/task/task-skill-selector.tsx`
- Read: `frontend/src/components/console/project/start-develop-task-dialog.tsx`
- Read: `frontend/src/components/console/task/task-input.tsx`
- Read: `frontend/src/components/console/task/create-default-task-dialog.tsx`

**Interfaces:**
- Consumes: `TaskSkillSelectorProps` 和三个现有调用入口。
- Produces: 对 `enableWheelScrollFallback?: boolean`、滚轮增量换算和两个弹窗入口启用范围的源码约束。

- [x] **Step 1: 编写失败测试**

```typescript
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readSource(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const selector = readSource("../src/components/console/task/task-skill-selector.tsx");
const startTask = readSource("../src/components/console/project/start-develop-task-dialog.tsx");
const taskInput = readSource("../src/components/console/task/task-input.tsx");
const defaultTask = readSource("../src/components/console/task/create-default-task-dialog.tsx");

function taskSkillSelectorTags(source) {
  return source.match(/<TaskSkillSelector\b[^>]*\/>/gs) ?? [];
}

test("启动任务技能选择器启用滚轮回退", () => {
  assert.match(selector, /enableWheelScrollFallback\?: boolean/);
  assert.match(selector, /addEventListener\("wheel", handleSkillListWheel, \{ passive: false \}\)/);
  assert.match(selector, /event\.preventDefault\(\)/);
  assert.match(selector, /removeEventListener\("wheel", handleSkillListWheel\)/);
  assert.match(selector, /setPopoverContentElement/);
  assert.match(selector, /activeSkillList\.scrollTop \+= getWheelScrollDelta/);
  assert.match(selector, /ref=\{setPopoverContentElement\}/);
  assert.match(selector, /closest<HTMLDivElement>\(ACTIVE_SKILL_LIST_SELECTOR\)/);
  assert.match(selector, /event\.ctrlKey/);
  assert.match(selector, /Math\.abs\(event\.deltaY\) <= Math\.abs\(event\.deltaX\)/);
  assert.doesNotMatch(selector, /ref=\{tag === activeSkillTag/);
  assert.doesNotMatch(selector, /<Popover modal=/);
  assert.equal(
    taskSkillSelectorTags(startTask).some((tag) => /\benableWheelScrollFallback\b/.test(tag)),
    true,
  );
});

test("滚轮回退按 deltaMode 换算滚动距离", () => {
  const getWheelScrollDelta = loadWheelScrollDelta();

  assert.equal(getWheelScrollDelta(24, 0, 300), 24);
  assert.equal(getWheelScrollDelta(3, 1, 300), 48);
  assert.equal(getWheelScrollDelta(2, 2, 300), 600);
  assert.equal(getWheelScrollDelta(-2, 1, 300), -32);
});

test("其他任务入口保持默认 Popover 行为", () => {
  assert.equal(
    taskSkillSelectorTags(defaultTask).some((tag) => /\benableWheelScrollFallback\b/.test(tag)),
    true,
  );
  assert.equal(
    taskSkillSelectorTags(taskInput).some((tag) => /\benableWheelScrollFallback\b/.test(tag)),
    false,
  );
});
```

- [x] **Step 2: 运行测试并确认失败**

Run: `node --test test/task-skill-selector-wheel.test.mjs`

Expected: 第一个测试因仍使用活动 `TabsContent` ref 而失败。

### Task 2: 为两个弹窗入口启用滚轮回退

**Files:**
- Modify: `frontend/src/components/console/task/task-skill-selector.tsx:29-40,108-140,182-223,267-286`
- Modify: `frontend/src/components/console/project/start-develop-task-dialog.tsx:456-466`
- Modify: `frontend/src/components/console/task/create-default-task-dialog.tsx:575-585`
- Test: `frontend/test/task-skill-selector-wheel.test.mjs`

**Interfaces:**
- Consumes: 浏览器原生 `WheelEvent`、`WheelEvent.deltaMode` 和非 passive 事件监听器。
- Produces: `TaskSkillSelectorProps.enableWheelScrollFallback?: boolean`，稳定的 Popover 容器监听器，两个弹窗入口启用该属性。

- [x] **Step 1: 移除 modal 方案并增加滚轮回退属性**

```tsx
interface TaskSkillSelectorProps {
  enableWheelScrollFallback?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedSkills: string[]
  skills: SkillForPicker[]
  skillTags: string[]
  activeSkillTag: string
  onActiveSkillTagChange: (tag: string) => void
  onSkillChange: (skillId: string, checked: boolean) => void
  triggerClassName?: string
  labelClassName?: string
}

export function TaskSkillSelector({
  enableWheelScrollFallback,
  open,
  onOpenChange,
  selectedSkills,
  skills,
  skillTags,
  activeSkillTag,
  onActiveSkillTagChange,
  onSkillChange,
  triggerClassName,
  labelClassName,
}: TaskSkillSelectorProps) {
  const { t } = useTranslation()
}
```

- [x] **Step 2: 通过 Popover 容器上的非 passive 原生监听器主动滚动技能列表**

```tsx
const DOM_DELTA_LINE = 1
const DOM_DELTA_PAGE = 2
const WHEEL_LINE_HEIGHT = 16

function getWheelScrollDelta(deltaY: number, deltaMode: number, pageHeight: number) {
  if (deltaMode === DOM_DELTA_LINE) return deltaY * WHEEL_LINE_HEIGHT
  if (deltaMode === DOM_DELTA_PAGE) return deltaY * pageHeight
  return deltaY
}

const ACTIVE_SKILL_LIST_SELECTOR = '[role="tabpanel"][data-state="active"]'

const [popoverContentElement, setPopoverContentElement] = useState<HTMLDivElement | null>(null)

useEffect(() => {
  if (!enableWheelScrollFallback || !open || !popoverContentElement) return

  const handleSkillListWheel = (event: WheelEvent) => {
    if (
      event.ctrlKey ||
      event.deltaY === 0 ||
      Math.abs(event.deltaY) <= Math.abs(event.deltaX) ||
      !(event.target instanceof Element)
    ) {
      return
    }

    const activeSkillList = event.target.closest<HTMLDivElement>(ACTIVE_SKILL_LIST_SELECTOR)
    if (!activeSkillList || !popoverContentElement.contains(activeSkillList)) return

    event.preventDefault()
    activeSkillList.scrollTop += getWheelScrollDelta(
      event.deltaY,
      event.deltaMode,
      activeSkillList.clientHeight
    )
  }

  popoverContentElement.addEventListener("wheel", handleSkillListWheel, { passive: false })

  return () => popoverContentElement.removeEventListener("wheel", handleSkillListWheel)
}, [enableWheelScrollFallback, open, popoverContentElement])

<PopoverContent
  ref={setPopoverContentElement}
  className="flex max-h-[min(24rem,var(--radix-popover-content-available-height))] w-[90vw] max-w-xl flex-col overflow-hidden p-2"
  align="start"
>
```

- [x] **Step 3: 在两个弹窗入口启用**

```tsx
<TaskSkillSelector
  enableWheelScrollFallback
  open={skillPopoverOpen}
  onOpenChange={setSkillPopoverOpen}
  selectedSkills={selectedSkill}
  skills={skillList}
  skillTags={skillTags}
  activeSkillTag={activeSkillTag}
  onActiveSkillTagChange={setActiveSkillTag}
  onSkillChange={handleSkillChange}
  triggerClassName="w-full justify-start rounded-md"
/>
```

在 `CreateDefaultTaskDialog` 的现有 `TaskSkillSelector` 调用中同样增加 `enableWheelScrollFallback`，并保持 `TaskInput` 调用不传该属性。

- [x] **Step 4: 运行回归测试**

Run: `node --test test/task-skill-selector-wheel.test.mjs`

Expected: 3 tests pass。

- [x] **Step 5: 验证与 PR #874 的三方自动合并**

Run: 使用当前 `main`、PR #874 head 和包含 Issue #875 工作树补丁的临时 tree 执行 `git merge-tree`。

Expected: `task-skill-selector.tsx` 自动合并，不输出 conflict markers。

- [x] **Step 6: 运行静态检查和 online 构建**

Run: `pnpm lint`

Expected: exit code 0。

Run: `pnpm run build:online`

Expected: TypeScript 和 Vite 构建成功，exit code 0。

- [x] **Step 7: 构建三个变更的临时组合版本**

在独立临时 worktree 中以最新 `main` 为基础，依次应用 PR #871、PR #874 和当前 Issue #875 补丁。该 worktree 只用于组合验证，不改变当前功能分支、索引和工作树。

Run: `pnpm lint` 和 `pnpm run build:online`

Expected: 三个变更自动组合，静态检查和构建均以 exit code 0 完成。

- [x] **Step 8: 启动组合版本 SaaS 预览并人工验证**

Run: `TARGET=https://monkeycode-ai.com pnpm dev:online`

Expected: 黄色提示复制功能正常；技能搜索、空结果和关闭清理正常；“创建任务”和“启动 AI 任务”技能列表支持鼠标滚轮和触控板纵向滚动；任务首页行为保持正常。

- [x] **Step 9: 用户验收后提交**

```bash
git add docs/superpowers/specs/2026-07-15-task-skill-wheel-scroll-design.md docs/superpowers/plans/2026-07-15-task-skill-wheel-scroll.md frontend/test/task-skill-selector-wheel.test.mjs frontend/src/components/console/task/task-skill-selector.tsx frontend/src/components/console/project/start-develop-task-dialog.tsx frontend/src/components/console/task/create-default-task-dialog.tsx
git commit -m "修复启动任务技能列表滚轮失效"
```
