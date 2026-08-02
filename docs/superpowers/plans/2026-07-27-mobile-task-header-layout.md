# Web 任务页移动端顶部工具区布局 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Web 任务详情页顶部工具区在手机端改为两行布局，消除控件碰撞并提供至少 44px 的触控目标。

**Architecture:** 保留 `task-detail.tsx` 现有 DOM、状态和事件处理，通过 Tailwind 响应式 class 在 768px 以下切换为纵向页头和等宽动作网格，在 768px 及以上恢复现有横向紧凑布局。使用 Node.js 源码结构测试锁定断点、伸缩规则、触控尺寸和动态等宽行为。

**Tech Stack:** React 19、TypeScript 5.9、Tailwind CSS 4、Node.js 22 `node:test`、Vite 7

## Global Constraints

- 320px 及以上宽度下，顶部所有可见控件互不重叠。
- 手机端保留模型、上下文、技能、文件、预览和发布的可见名称与直接入口。
- 手机端交互控件触控高度至少为 44px。
- 手机端工具区不产生页面级横向滚动。
- 768px 及以上宽度保持现有桌面端单行布局、尺寸、文案和交互。
- 发布按钮继续遵循 `canPublishWebsite`，实际可见操作自动均分宽度。
- 手机端继续隐藏终端按钮。
- 不改变模型切换、上下文管理、面板切换和发布业务逻辑。
- 每次 commit 前必须获得用户明确授权，只暂存该任务涉及的文件。

---

## File Structure

- Create: `frontend/test/task-detail-mobile-header-layout.test.mjs`：验证任务页头响应式结构、44px 触控目标和桌面端回退规则。
- Modify: `frontend/src/pages/console/user/task/task-detail.tsx:1212-1411`：调整 `detailHeader` 的响应式布局 class，并为动作文字增加受控截断容器。

### Task 1: 移动端两行页头布局

**Files:**
- Create: `frontend/test/task-detail-mobile-header-layout.test.mjs`
- Modify: `frontend/src/pages/console/user/task/task-detail.tsx:1212-1411`

**Interfaces:**
- Consumes: 现有 `detailHeader` JSX、`canPublishWebsite`、`taskInteractive`、`hasContextUsage`、面板开关状态和点击处理函数。
- Produces: 768px 以下两行页头、44px 手机触控目标、按实际可见数量等宽排列的动作区，以及保持原行为的 768px 以上桌面页头。

- [ ] **Step 1: 编写失败的响应式布局测试**

创建 `frontend/test/task-detail-mobile-header-layout.test.mjs`：

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/pages/console/user/task/task-detail.tsx", import.meta.url),
  "utf8",
);

test("任务详情页头在手机端分为信息行和等宽操作行", () => {
  assert.match(
    source,
    /className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-3"/,
  );
  assert.match(
    source,
    /className="flex w-full min-w-0 items-center gap-2 md:flex-1"/,
  );
  assert.match(
    source,
    /className="grid w-full auto-cols-fr grid-flow-col items-center gap-2 md:flex md:w-auto md:gap-0\.5"/,
  );
});

test("手机端模型、上下文和操作按钮保持稳定触控尺寸", () => {
  assert.match(
    source,
    /className="h-11 min-w-0 flex-1 gap-1 px-2 text-xs font-normal md:h-7 md:max-w-\[220px\] md:shrink-0 md:flex-none"/,
  );
  assert.match(
    source,
    /className="inline-flex size-11 shrink-0 items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring\/50 md:size-auto"/,
  );

  const responsiveActionButtons = source.match(
    /h-11 min-w-0 gap-1 px-2 text-xs font-normal md:h-7 md:text-sm/g,
  ) ?? [];
  assert.equal(responsiveActionButtons.length, 4);
});

test("手机端操作文字在等宽列内受控截断", () => {
  assert.match(
    source,
    /<span className="truncate">\{t\("taskDetail\.chat\.skills"\)\}<\/span>/,
  );
  assert.match(
    source,
    /<span className="truncate">[\s\S]*?taskDetail\.panels\.files[\s\S]*?<\/span>/,
  );
  assert.match(
    source,
    /<span className="truncate">[\s\S]*?taskDetail\.panels\.preview[\s\S]*?<\/span>/,
  );
  assert.match(
    source,
    /<span className="truncate">\{t\("taskDetail\.page\.dialogs\.publishWebsite\.button"\)\}<\/span>/,
  );
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```bash
/root/.local/share/pnpm/nodejs/22.23.1/bin/node --test frontend/test/task-detail-mobile-header-layout.test.mjs
```

Expected: FAIL，三个测试均报告当前源码缺少新的响应式 class 或截断容器。

- [ ] **Step 3: 实现最小响应式布局**

在 `detailHeader` 中进行以下定点修改。

将页头根容器改为手机端纵向、桌面端横向：

```tsx
<div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-3">
```

将模型与上下文所在的信息行改为占满手机宽度：

```tsx
<div className="flex w-full min-w-0 items-center gap-2 md:flex-1">
```

将模型按钮改为手机端 44px 高且占用剩余空间，桌面端恢复当前尺寸和最大宽度：

```tsx
className="h-11 min-w-0 flex-1 gap-1 px-2 text-xs font-normal md:h-7 md:max-w-[220px] md:shrink-0 md:flex-none"
```

将上下文触发按钮改为手机端 44px × 44px，桌面端恢复内容尺寸：

```tsx
className="inline-flex size-11 shrink-0 items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 md:size-auto"
```

将右侧两层容器合并为手机端等宽 grid、桌面端紧凑 flex。保留外层仅负责宽度和收缩：

```tsx
<div className="w-full shrink-0 md:w-auto">
  <div className="grid w-full auto-cols-fr grid-flow-col items-center gap-2 md:flex md:w-auto md:gap-0.5">
```

技能、文件、预览和发布四个按钮统一使用以下手机和桌面尺寸 class，同时保留各自现有选中态 class。文件按钮写法如下：

```tsx
className={cn(
  "h-11 min-w-0 gap-1 px-2 text-xs font-normal md:h-7 md:text-sm",
  activeSidePanel === "files" && "text-primary bg-accent",
)}
```

预览和发布按钮分别沿用 `previewDialogOpen` 与 `publishConfirmDialogOpen` 作为第二个 `cn` 参数。技能按钮直接使用：

```tsx
className="h-11 min-w-0 gap-1 px-2 text-xs font-normal md:h-7 md:text-sm"
```

四个操作图标增加 `shrink-0`，四段可见文字分别放入 `truncate` 容器：

```tsx
<IconPuzzle className="size-3.5 shrink-0" />
<span className="truncate">{t("taskDetail.chat.skills")}</span>

<IconFile className="size-3.5 shrink-0" />
<span className="truncate">
  {t("taskDetail.panels.files")}{fileChangesCount > 0 ? ` (${fileChangesCount})` : ""}
</span>

<IconDeviceDesktop className="size-3.5 shrink-0" />
<span className="truncate">
  {t("taskDetail.panels.preview")}{previewPortCount > 0 ? ` (${previewPortCount})` : ""}
</span>

<IconUpload className="size-3.5 shrink-0" />
<span className="truncate">{t("taskDetail.page.dialogs.publishWebsite.button")}</span>
```

终端按钮继续使用现有 `hidden ... md:inline-flex` 规则，并保留 28px 桌面高度。

- [ ] **Step 4: 运行聚焦测试并确认 GREEN**

Run:

```bash
/root/.local/share/pnpm/nodejs/22.23.1/bin/node --test frontend/test/task-detail-mobile-header-layout.test.mjs frontend/test/task-chat-input-mobile-layout.test.mjs frontend/test/input-group-orientation.test.mjs
```

Expected: PASS，全部测试通过。

- [ ] **Step 5: 运行前端静态检查和构建**

Run:

```bash
pnpm --dir frontend lint
pnpm --dir frontend exec tsc -b
pnpm --dir frontend run build:online
git diff --check
```

Expected: 四条命令退出码均为 0；online build 无需 `TARGET`。

- [ ] **Step 6: 启动 online 预览并执行自动健康检查**

使用现有 online 预览启动流程，显式提供合法 HTTP(S) `TARGET`：

```bash
TARGET=https://monkeycode-ai.com pnpm --dir frontend run dev:online -- --host 0.0.0.0 --port 4215
```

该命令通过后台终端运行。预览地址生成后执行：

```bash
PREVIEW_URL=https://4215-e84020e6e952be3c.monkeycode-ai.online pnpm --dir frontend run check:online-preview
```

Expected: 首页、CAP JavaScript、WASM 和 challenge API 健康检查全部通过，检查输出不包含 challenge 正文、token、Cookie 或认证头。

- [ ] **Step 7: 完成多宽度人工验收**

在浏览器响应式模式依次验证 320px、375px、390px、430px 和 1280px。

手机端 Expected:

- 第一行仅展示自适应模型按钮和上下文按钮。
- 第二行展示技能、文件、预览和按权限出现的发布按钮。
- 第二行按钮按实际可见数量等宽排列，高度至少 44px。
- 长模型名、文件计数和预览计数按列受控截断。
- 控件无重叠，页面无横向滚动。
- 字体族、字号、字重和行高与现有页面一致。

桌面端 Expected:

- 模型、上下文和操作组保持同一行。
- 操作按钮保持 28px 紧凑高度。
- 终端按钮按现有断点显示。
- 当前选中态、禁用态和点击行为保持一致。

- [ ] **Step 8: 获得授权后提交实现**

提交前向用户报告测试、构建和人工验收结果，并请求本任务的明确 commit 授权。授权后执行：

```bash
git status --short
git diff -- frontend/src/pages/console/user/task/task-detail.tsx frontend/test/task-detail-mobile-header-layout.test.mjs
git log --oneline -10
git add -- frontend/src/pages/console/user/task/task-detail.tsx frontend/test/task-detail-mobile-header-layout.test.mjs
git commit -m "修复：优化移动端任务页顶部工具区布局"
```

Expected: 只提交上述两个文件，工作树中的验证码、字体、MEMORY 和其他计划文件保持原状态。
