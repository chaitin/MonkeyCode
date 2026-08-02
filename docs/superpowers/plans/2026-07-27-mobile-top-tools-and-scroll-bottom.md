# 移动端顶部任务工具与消息定位底部操作实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 恢复手机端原有模型入口，使用页头下方单一 Popover 承载更多工具与文件，并在官方消息定位内容底部增加按需显示的“回到底部”。

**Architecture:** `TaskDetailPage` 继续拥有消息滚动容器、底部状态和工具 Dialog 状态；`TaskUserInputIndex` 仅消费 `isAtBottom` 与 `scrollToBottom`，在现有手机 Drawer 和桌面 hover 面板中复用同一个底部操作。手机更多工具使用受控模态 Popover，通过 `tools | files` 内部模式复用一个 Portal，并在 Popover 完成关闭生命周期后执行技能、预览和发布动作。

**Tech Stack:** React 19、TypeScript、Radix UI Popover、Vaul Drawer、Tailwind CSS、Node.js `node:test`、Vite 7。

## Global Constraints

- 官方消息定位入口、手机 Drawer、桌面圆点栏、列表、分页、跳转和高亮逻辑保持现状。
- 手机端定位入口必须位于页头正常 flex 布局中，不得遮挡消息内容或使用消息区绝对定位。
- 320px 及以上宽度不得出现页头控件重叠或页面级横向滚动。
- 手机端常驻入口和新增操作的点击目标至少为 44px。
- 底部判定继续使用任务页现有 24px 阈值。
- 桌面端模型、任务工具、文件侧栏和消息定位视觉保持现状。
- 不新增第三方依赖、全局状态、消息索引 API 或虚拟消息列表接口。
- 保留工作树中与本计划无关的修改；每次只暂存任务明确列出的文件。
- 每个任务提交前暂停并取得用户单独授权；push 与 PR 继续单独授权。

---

## File Map

- `frontend/src/components/console/task/task-user-input-index.tsx`：保留官方定位实现，新增底部操作 props、共享按钮和手机关闭行为。
- `frontend/src/pages/console/user/task/task-detail.tsx`：同步消息底部状态，恢复模型入口，承载手机顶部 Popover 和文件模式。
- `frontend/src/i18n/resources/cn.ts`：新增“回到底部”中文文案。
- `frontend/src/i18n/resources/en.ts`：新增“回到底部”英文文案。
- `frontend/test/task-user-input-index-mobile-layout.test.mjs`：锁定官方定位结构与底部操作行为。
- `frontend/test/task-detail-mobile-header-layout.test.mjs`：锁定窄屏页头、顶部 Popover、文件同实例和关闭后动作。

## Execution Order

当前工作树的任务页、手机断点 hook、双语资源和页头测试已包含上一版顶部工具的未提交差异。为让每个提交保持单一职责，先跳转执行本文后半部分的 **Task 1：恢复模型入口并实现页头下方单一工具面板**，完成并提交后，再回到此处执行 **Task 2：在官方消息定位底部增加“回到底部”**。

### Task 2: 在官方消息定位底部增加“回到底部”

**Files:**
- Modify: `frontend/src/components/console/task/task-user-input-index.tsx:14-390`
- Modify: `frontend/src/pages/console/user/task/task-detail.tsx:127-151, 1070-1179, 1381-1390, 1668-1677`
- Modify: `frontend/src/i18n/resources/cn.ts:4138-4147`
- Modify: `frontend/src/i18n/resources/en.ts:4138-4147`
- Test: `frontend/test/task-user-input-index-mobile-layout.test.mjs`

**Interfaces:**
- Consumes: `scheduleChatScrollToBottom(behavior, { forceAutoScroll })` 与 `updateChatScrollState()` 的现有 24px 底部判断。
- Produces: `TaskUserInputIndexProps.isAtBottom: boolean`、`TaskUserInputIndexProps.scrollToBottom: () => void`、任务页 `chatAtBottom: boolean`。

- [ ] **Step 1: 写入失败的结构与行为测试**

在 `frontend/test/task-user-input-index-mobile-layout.test.mjs` 增加任务页源码读取和以下用例：

```js
const taskDetailSource = readFileSync(
  new URL("../src/pages/console/user/task/task-detail.tsx", import.meta.url),
  "utf8",
);

test("官方定位面板仅在离开底部时提供回到底部操作", () => {
  assert.match(source, /isAtBottom: boolean/);
  assert.match(source, /scrollToBottom: \(\) => void/);
  assert.match(source, /if \(isAtBottom\) return null/);
  assert.match(source, /taskDetail\.userInputIndex\.scrollToBottom/);
  assert.match(source, /presentation === "mobile" \? "h-11" : "h-8"/);
  assert.equal(source.match(/renderScrollToBottom\(\)/g)?.length, 2);
});

test("手机回到底部后关闭官方定位 Drawer", () => {
  assert.match(source, /const handleScrollToBottom = React\.useCallback/);
  assert.match(source, /scrollToBottom\(\)[\s\S]*?presentation === "mobile"[\s\S]*?setMobileOpen\(false\)/);
  assert.match(source, /<Drawer open=\{mobileOpen\} onOpenChange=\{setMobileOpen\}>/);
});

test("任务页复用现有底部判断并向两个定位实例传递状态", () => {
  assert.match(taskDetailSource, /const \[chatAtBottom, setChatAtBottom\] = React\.useState\(true\)/);
  assert.match(taskDetailSource, /setChatAtBottom\(\(previous\) => previous === isAtBottom \? previous : isAtBottom\)/);
  assert.match(taskDetailSource, /scheduleChatScrollToBottom\("smooth", \{ forceAutoScroll: true \}\)/);
  assert.equal(taskDetailSource.match(/isAtBottom=\{chatAtBottom\}/g)?.length, 2);
  assert.equal(taskDetailSource.match(/scrollToBottom=\{handleScrollToBottom\}/g)?.length, 2);
});

test("回到底部具备完整双语文案", () => {
  assert.match(cn, /userInputIndex:[\s\S]*?scrollToBottom: "回到底部"/);
  assert.match(en, /userInputIndex:[\s\S]*?scrollToBottom: "Back to bottom"/);
});
```

- [ ] **Step 2: 运行聚焦测试并确认 RED**

Run:

```bash
cd frontend
/root/.local/share/pnpm/nodejs/22.23.1/bin/node --test test/task-user-input-index-mobile-layout.test.mjs
```

Expected: 新增 4 个用例失败，错误分别指向缺失 props、底部状态、按钮和双语文案；现有 5 个用例继续通过。

- [ ] **Step 3: 给官方定位组件增加最小底部操作**

在 `task-user-input-index.tsx` 中加入图标、props 和共享处理函数：

```tsx
import { IconArrowDown, IconListSearch, IconX } from "@tabler/icons-react"

export interface TaskUserInputIndexProps {
  taskId: string | null | undefined
  liveMessages: MessageType[]
  getScrollContainer: () => HTMLElement | null
  scrollToMessage?: (messageId: string, options?: { align?: "start" | "center" | "end" | "auto"; behavior?: ScrollBehavior; highlight?: boolean }) => boolean
  historyHasMore: boolean
  loadMoreHistory: () => Promise<void>
  isAtBottom: boolean
  scrollToBottom: () => void
  presentation?: "desktop" | "mobile"
}
```

从 props 解构 `isAtBottom` 与 `scrollToBottom`，并在 `handleDesktopJump` 后加入：

```tsx
const handleScrollToBottom = React.useCallback(() => {
  scrollToBottom()
  if (presentation === "mobile") {
    setMobileOpen(false)
  }
}, [presentation, scrollToBottom])

const renderScrollToBottom = () => {
  if (isAtBottom) return null

  return (
    <div className="shrink-0 border-t bg-popover/95 p-1.5">
      <Button
        type="button"
        variant="ghost"
        className={cn(
          "w-full gap-1.5 text-muted-foreground hover:text-popover-foreground",
          presentation === "mobile" ? "h-11" : "h-8",
        )}
        onClick={handleScrollToBottom}
      >
        <IconArrowDown className="size-4" />
        {t("taskDetail.userInputIndex.scrollToBottom")}
      </Button>
    </div>
  )
}
```

手机 Drawer 保持现有 header 与列表，只在列表后追加：

```tsx
<div className="min-h-0 overflow-y-auto border-t">
  {renderEntries(handleMobileJump)}
</div>
{renderScrollToBottom()}
```

桌面展开面板保留现有位置、宽度和过渡类，把内容区拆为可滚动列表与固定 footer：

```tsx
<div
  className={cn(
    "flex flex-col rounded-xl border bg-popover/95 shadow-xl backdrop-blur-sm transition-all origin-right overflow-hidden",
    expanded
      ? "scale-100 opacity-100 pointer-events-auto"
      : "scale-95 opacity-0 pointer-events-none absolute right-0 top-1/2 -translate-y-1/2",
  )}
  style={{ maxHeight: "min(480px, 70vh)", width: "280px" }}
>
  <div className="min-h-0 overflow-y-auto">
    {renderEntries(handleDesktopJump)}
  </div>
  {renderScrollToBottom()}
</div>
```

- [ ] **Step 4: 在任务页同步底部状态并复用现有滚动函数**

在滚动 refs 附近新增：

```tsx
const [chatAtBottom, setChatAtBottom] = React.useState(true)
```

在 `updateChatScrollState` 计算 `isAtBottom` 后立即同步状态，保留后续自动滚动逻辑：

```tsx
const isAtBottom = !hasOverflow || maxScrollTop - container.scrollTop <= 24
setChatAtBottom((previous) => previous === isAtBottom ? previous : isAtBottom)
```

在 `scheduleChatScrollToBottom` 后新增稳定回调：

```tsx
const handleScrollToBottom = React.useCallback(() => {
  scheduleChatScrollToBottom("smooth", { forceAutoScroll: true })
}, [scheduleChatScrollToBottom])
```

向手机和桌面两个 `TaskUserInputIndex` 实例加入相同 props：

```tsx
isAtBottom={chatAtBottom}
scrollToBottom={handleScrollToBottom}
```

在中英文 `userInputIndex` 中分别增加：

```ts
scrollToBottom: "回到底部",
```

```ts
scrollToBottom: "Back to bottom",
```

- [ ] **Step 5: 运行 GREEN 验证**

Run:

```bash
cd frontend
/root/.local/share/pnpm/nodejs/22.23.1/bin/node --test test/task-user-input-index-mobile-layout.test.mjs
/root/.local/share/pnpm/nodejs/22.23.1/bin/node node_modules/eslint/bin/eslint.js src/components/console/task/task-user-input-index.tsx src/pages/console/user/task/task-detail.tsx src/i18n/resources/cn.ts src/i18n/resources/en.ts test/task-user-input-index-mobile-layout.test.mjs
/root/.local/share/pnpm/nodejs/22.23.1/bin/node node_modules/typescript/bin/tsc -b
```

Expected: 定位聚焦测试全部通过，ESLint 和 TypeScript 均以 exit code 0 结束且无输出。

- [ ] **Step 6: 人工验收底部操作**

在 320px、375px、390px、430px 和 1280px 验证：离开消息底部后显示“回到底部”；点击后平滑滚动到底部并隐藏该操作；手机 Drawer 同时关闭；官方定位原有列表、分页、跳转、高亮和桌面圆点布局保持现状。

- [ ] **Step 7: 检查最小差异并请求 Task 2 提交授权**

Run:

```bash
git diff --check
git diff -- frontend/src/components/console/task/task-user-input-index.tsx frontend/src/pages/console/user/task/task-detail.tsx frontend/src/i18n/resources/cn.ts frontend/src/i18n/resources/en.ts frontend/test/task-user-input-index-mobile-layout.test.mjs
git status --short
```

Expected: 仅出现本任务预期差异和用户已有修改；暂停并请求提交授权。

授权后执行：

```bash
git add frontend/src/components/console/task/task-user-input-index.tsx frontend/src/pages/console/user/task/task-detail.tsx frontend/src/i18n/resources/cn.ts frontend/src/i18n/resources/en.ts frontend/test/task-user-input-index-mobile-layout.test.mjs
git commit -m "修复：为对话定位增加回到底部操作"
```

### Task 1: 恢复模型入口并实现页头下方单一工具面板

**Files:**
- Modify: `frontend/src/pages/console/user/task/task-detail.tsx:30-68, 89-153, 1223-1538, 1708-1729`
- Modify: `frontend/src/hooks/use-mobile.ts:1-24`
- Modify: `frontend/src/i18n/resources/cn.ts:3994-3998`
- Modify: `frontend/src/i18n/resources/en.ts:3994-3998`
- Test: `frontend/test/task-detail-mobile-header-layout.test.mjs`

**Interfaces:**
- Consumes: `TaskFileExplorer`、`mobileToolsOpen`、`pendingMobileToolActionRef`、现有技能/预览/发布 Dialog setters。
- Produces: `MobileToolsView = "tools" | "files"`、受控模态 Popover、`handleMobileToolsCloseAutoFocus(event)`、手机文件面板单实例。

- [ ] **Step 1: 把现有 Drawer 测试改写为最终设计的失败测试**

在 `frontend/test/task-detail-mobile-header-layout.test.mjs` 中保留同步手机断点测试，替换其余页头与 Drawer 断言：

```js
test("手机端恢复独立模型和上下文入口", () => {
  assert.match(source, /className="h-11 min-w-0 flex-1 gap-1 px-2 text-xs font-normal md:h-7/);
  assert.doesNotMatch(source, /getBrandFromModel\(currentModel\)[\s\S]*?md:hidden/);
  assert.doesNotMatch(source, /overflow-hidden rounded-md border md:contents/);
  assert.match(source, /className="inline-flex size-11 shrink-0 items-center justify-center rounded-sm/);
});

test("320px 页头由模型收缩并保持定位与更多 44px", () => {
  assert.match(source, /className="flex min-w-0 flex-1 items-center gap-2"/);
  assert.match(source, /\{isMobile && \([\s\S]*?presentation="mobile"/);
  assert.match(source, /className="size-11 shrink-0 md:hidden"[\s\S]*?aria-label=\{t\("taskDetail\.page\.mobileTools\.trigger"\)\}/);
});

test("更多工具使用固定向下的单一模态 Popover", () => {
  assert.match(source, /<Popover modal open=\{mobileToolsOpen\} onOpenChange=\{handleMobileToolsOpenChange\}>/);
  assert.match(source, /<PopoverContent[\s\S]*?side="bottom"[\s\S]*?align="end"[\s\S]*?avoidCollisions=\{false\}/);
  assert.doesNotMatch(source, /<Drawer[\s\S]*?open=\{mobileToolsOpen\}/);
  assert.match(source, /type MobileToolsView = "tools" \| "files"/);
});

test("文件与工具共享 Popover 且手机端不打开右侧面板", () => {
  assert.match(source, /mobileToolsView === "tools"/);
  assert.match(source, /mobileToolsView === "files"[\s\S]*?<TaskFileExplorer/);
  assert.match(source, /onClick=\{\(\) => setMobileToolsView\("files"\)\}/);
  assert.match(source, /const hasSidePanel = !isMobile && activeSidePanel !== null/);
});

test("后续 Dialog 在 Popover 关闭生命周期后执行", () => {
  assert.match(source, /const runMobileToolAction = React\.useCallback\(\(action: \(\) => void\) => \{[\s\S]*?pendingMobileToolActionRef\.current = action[\s\S]*?setMobileToolsOpen\(false\)/);
  assert.match(source, /const handleMobileToolsCloseAutoFocus = React\.useCallback/);
  assert.match(source, /event\.preventDefault\(\)[\s\S]*?pendingMobileToolActionRef\.current = null[\s\S]*?action\(\)/);
  assert.match(source, /onCloseAutoFocus=\{handleMobileToolsCloseAutoFocus\}/);
});
```

- [ ] **Step 2: 运行聚焦测试并确认 RED**

Run:

```bash
cd frontend
/root/.local/share/pnpm/nodejs/22.23.1/bin/node --test test/task-detail-mobile-header-layout.test.mjs
```

Expected: 最终设计相关用例失败；失败原因对应当前组合模型、底部 Drawer 和缺失文件模式。

- [ ] **Step 3: 将任务工具容器从 Drawer 改为 Popover**

移除任务页的 Drawer imports，加入：

```tsx
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
```

在类型区和状态区加入：

```tsx
type MobileToolsView = "tools" | "files"

const [mobileToolsOpen, setMobileToolsOpen] = React.useState(false)
const [mobileToolsView, setMobileToolsView] = React.useState<MobileToolsView>("tools")
```

把 `hasSidePanel` 收紧为桌面专用：

```tsx
const hasSidePanel = !isMobile && activeSidePanel !== null
```

用关闭生命周期替换 Drawer 动画回调：

```tsx
const handleMobileToolsOpenChange = React.useCallback((open: boolean) => {
  if (open) {
    setMobileToolsView("tools")
  }
  setMobileToolsOpen(open)
}, [])

const runMobileToolAction = React.useCallback((action: () => void) => {
  pendingMobileToolActionRef.current = action
  setMobileToolsOpen(false)
}, [])

const handleMobileToolsCloseAutoFocus = React.useCallback((event: Event) => {
  const action = pendingMobileToolActionRef.current
  if (!action) return

  event.preventDefault()
  pendingMobileToolActionRef.current = null
  action()
}, [])
```

- [ ] **Step 4: 恢复手机端原模型视觉并保持窄屏收缩**

删除模型与上下文外层的组合边框容器和当前模型品牌图标。模型 trigger 保持原逻辑，只把 Button class 调整为：

```tsx
className="h-11 min-w-0 flex-1 gap-1 px-2 text-xs font-normal md:h-7 md:max-w-[220px] md:shrink-0 md:flex-none"
```

保持 `DropdownMenuContent` 与 `HoverCardContent` 的现有子树原位，删除包裹二者的 `<div className="flex min-w-0 flex-1 overflow-hidden rounded-md border md:contents">` 开始标签及其配对结束标签。把上下文区域容器 class 从：

```tsx
className="contents md:flex md:shrink-0 md:flex-wrap md:items-center md:gap-x-3 md:gap-y-1 md:text-xs md:text-muted-foreground"
```

精确替换为：

```tsx
className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
```

随后把上下文 trigger 的 class 精确替换为：

```tsx
className="inline-flex size-11 shrink-0 items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 md:size-auto"
```

删除当前模型 trigger 内的以下手机品牌图标块：

```tsx
{currentModel && (
  <Icon name={getBrandFromModel(currentModel)} className="size-4 shrink-0 md:hidden" />
)}
```

- [ ] **Step 5: 渲染顶部工具网格与同实例文件模式**

用以下 Popover 外壳替换手机工具 Drawer；四个工具继续使用现有业务条件：

```tsx
<Popover modal open={mobileToolsOpen} onOpenChange={handleMobileToolsOpenChange}>
  <PopoverTrigger asChild>
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="size-11 shrink-0 md:hidden"
      aria-label={t("taskDetail.page.mobileTools.trigger")}
    >
      <IconDots className="size-4" />
    </Button>
  </PopoverTrigger>
  <PopoverContent
    side="bottom"
    align="end"
    sideOffset={6}
    avoidCollisions={false}
    className="max-h-[65dvh] w-[calc(100vw-1rem)] max-w-[420px] gap-0 overflow-hidden p-0 md:hidden"
    onCloseAutoFocus={handleMobileToolsCloseAutoFocus}
  >
    {mobileToolsView === "tools" && (
      <>
        <div className="relative">
          <div className="space-y-1 p-4 pr-16">
            <h2 className="font-heading font-medium text-foreground">
              {t("taskDetail.page.mobileTools.title")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("taskDetail.page.mobileTools.description")}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-2 top-2 size-11"
            aria-label={t("taskDetail.common.close")}
            onClick={() => setMobileToolsOpen(false)}
          >
            <IconX className="size-4" />
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2 border-t p-4">
          <Button
            type="button"
            variant="secondary"
            className="min-h-16 justify-start gap-2"
            disabled={!taskInteractive}
            onClick={() => runMobileToolAction(() => setSkillsDialogOpen(true))}
          >
            <IconPuzzle className="size-4 shrink-0" />
            {t("taskDetail.chat.skills")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="min-h-16 justify-start gap-2"
            disabled={!taskInteractive}
            onClick={() => setMobileToolsView("files")}
          >
            <IconFile className="size-4 shrink-0" />
            {t("taskDetail.panels.files")}{fileChangesCount > 0 ? ` (${fileChangesCount})` : ""}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className={cn("min-h-16 justify-start gap-2", previewDialogOpen && "bg-accent text-primary")}
            disabled={!taskInteractive}
            onClick={() => runMobileToolAction(togglePreviewDialog)}
          >
            <IconDeviceDesktop className="size-4 shrink-0" />
            {t("taskDetail.panels.preview")}{previewPortCount > 0 ? ` (${previewPortCount})` : ""}
          </Button>
          {canPublishWebsite && (
            <Button
              type="button"
              variant="secondary"
              className={cn("min-h-16 justify-start gap-2", publishConfirmDialogOpen && "bg-accent text-primary")}
              disabled={!canInput}
              onClick={() => runMobileToolAction(() => setPublishConfirmDialogOpen(true))}
            >
              <IconUpload className="size-4 shrink-0" />
              {t("taskDetail.page.dialogs.publishWebsite.button")}
            </Button>
          )}
        </div>
      </>
    )}
    {mobileToolsView === "files" && (
      <div className="h-[min(60dvh,520px)] p-2">
        <TaskFileExplorer
          ref={taskFileExplorerRef}
          disabled={!taskInteractive}
          repository={taskControlClientRef.current}
          refreshSignal={fileRefreshSignal}
          onChangesCountChange={setFileChangesCount}
          onClosePanel={() => setMobileToolsOpen(false)}
          envid={envid}
        />
      </div>
    )}
  </PopoverContent>
</Popover>
```

- [ ] **Step 6: 保持消息内文件链接在手机端打开同一顶部面板**

把 `openWorkspaceFileLink` 和待打开文件 effect 调整为同时支持手机 Popover与桌面侧栏：

```tsx
const openWorkspaceFileLink = React.useCallback((path: string) => {
  if (!path) return

  const fileExplorer = taskFileExplorerRef.current
  if (fileExplorer) {
    void fileExplorer.openFile(path)
    return
  }

  setPendingWorkspaceFilePath(path)
  if (isMobile) {
    setMobileToolsView("files")
    setMobileToolsOpen(true)
    return
  }
  setActiveSidePanel("files")
}, [isMobile])

React.useEffect(() => {
  const fileExplorerVisible = isMobile
    ? mobileToolsOpen && mobileToolsView === "files"
    : activeSidePanel === "files"
  if (!fileExplorerVisible || !pendingWorkspaceFilePath || !taskFileExplorerRef.current) {
    return
  }

  const path = pendingWorkspaceFilePath
  setPendingWorkspaceFilePath(null)
  void taskFileExplorerRef.current.openFile(path)
}, [activeSidePanel, isMobile, mobileToolsOpen, mobileToolsView, pendingWorkspaceFilePath])
```

- [ ] **Step 7: 运行 Task 1 GREEN 与完整自动门禁**

Run:

```bash
cd frontend
/root/.local/share/pnpm/nodejs/22.23.1/bin/node --test test/task-detail-mobile-header-layout.test.mjs test/task-user-input-index-mobile-layout.test.mjs
/root/.local/share/pnpm/nodejs/22.23.1/bin/node node_modules/eslint/bin/eslint.js .
/root/.local/share/pnpm/nodejs/22.23.1/bin/node node_modules/typescript/bin/tsc -b
/root/.local/share/pnpm/nodejs/22.23.1/bin/node node_modules/vite/bin/vite.js build --mode online
```

Expected: 两个聚焦测试文件全部通过，ESLint 与 TypeScript exit code 0，online build 输出构建成功并 exit code 0。构建预计超过 60 秒时使用后台终端执行。

从仓库根目录继续运行：

```bash
git diff --check
PREVIEW_URL=https://4215-e84020e6e952be3c.monkeycode-ai.online /root/.local/share/pnpm/nodejs/22.23.1/bin/node frontend/scripts/check-online-preview.mjs
```

Expected: `git diff --check` 无输出；健康检查输出 `Online preview captcha health check passed.`。

- [ ] **Step 8: online 人工验收**

在 320px、375px、390px、430px 和 1280px 验证：

1. 长短模型名均在模型按钮内部省略，官方定位和更多按钮完整可见。
2. 官方定位按钮位于页头正常布局中，不遮挡消息内容。
3. 官方手机 Drawer 和桌面圆点 hover 面板保持原视觉、分页和消息跳转。
4. 更多面板从页头下方向下展开，关闭时向上退出。
5. 文件在同一个 Popover 中打开；关闭文件时不出现右侧手机面板。
6. 快速操作定位、更多、文件、技能和预览时无双遮罩、重影和焦点跳动。
7. 1280px 桌面工具栏、右侧文件面板和消息定位布局保持现状。

- [ ] **Step 9: 最终只读审查并请求 Task 1 提交授权**

审查范围：

```bash
git diff -- frontend/src/pages/console/user/task/task-detail.tsx frontend/src/hooks/use-mobile.ts frontend/src/i18n/resources/cn.ts frontend/src/i18n/resources/en.ts frontend/test/task-detail-mobile-header-layout.test.mjs
git diff --check
git status --short
```

重点检查：官方定位组件保持当前已提交状态；手机页头控件处于正常 flex 布局；Popover 只有一个；文件模式不触发 `toggleSidePanel("files")`；所有后续 Dialog 均经关闭生命周期执行。

暂停并请求提交授权。授权后仅暂存 Task 1 文件：

```bash
git add frontend/src/pages/console/user/task/task-detail.tsx frontend/src/hooks/use-mobile.ts frontend/src/i18n/resources/cn.ts frontend/src/i18n/resources/en.ts frontend/test/task-detail-mobile-header-layout.test.mjs
git commit -m "修复：优化移动端顶部任务工具"
```

## Final Handoff

完成两个任务且取得各自提交后：

1. 使用 `finishing-a-development-branch` 检查分支收尾状态。
2. 汇报所有自动验证、人工验收、提交哈希和剩余既有测试基线。
3. 单独请求 push 授权。
4. push 完成后单独请求 PR 更新授权。
