# Web 任务页移动端紧凑工具栏与对话定位 Implementation Plan

> 状态：历史计划，已被 `2026-07-27-mobile-top-tools-and-scroll-bottom-design.md` 及后续实施计划取代。本文中的手机定位 Drawer 与 `presentation` 分支未进入最终实现。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Web 任务详情页手机端改为单行紧凑工具栏，并用底部抽屉替代遮挡消息内容的常驻定位栏。

**Architecture:** `TaskUserInputIndex` 增加 `presentation` 变体，在共享定位数据和跳转逻辑上分别呈现桌面圆点栏与手机 Drawer。`task-detail.tsx` 保留同一套模型、上下文和工具状态，通过现有 `isMobile` 在页头挂载手机定位入口与更多工具 Drawer，在消息区仅挂载桌面定位器。

**Tech Stack:** React 19、TypeScript 5.9、Tailwind CSS 4、Vaul Drawer、Tabler Icons、i18next、Node.js 22 `node:test`、Vite 7

## Global Constraints

- 手机端顶部工具栏使用单行紧凑结构，320px 及以上宽度无控件碰撞和页面级横向滚动。
- 当前模型按钮展示品牌图标、模型名称和下拉状态。
- 上下文入口与模型入口形成统一视觉分组，同时保持独立语义和点击行为。
- 手机端常驻操作仅保留模型组、定位和更多三个区域。
- 定位与更多操作通过底部抽屉展示，所有触控目标至少为 44px。
- 手机端消息内容使用完整可用宽度，不受定位栏覆盖。
- 768px 及以上保持现有桌面页头、圆点定位栏和交互行为。
- 不新增第三方依赖，不改变 API、消息数据流、虚拟列表接口和工具业务逻辑。
- 每个实现任务的 commit 前必须获得用户明确授权，只暂存对应任务文件。

---

## File Structure

- Create: `frontend/test/task-user-input-index-mobile-layout.test.mjs`：锁定定位器的手机 Drawer、桌面圆点栏和共享跳转内容。
- Modify: `frontend/src/components/console/task/task-user-input-index.tsx`：增加响应式呈现变体、手机定位 Drawer 和共享列表渲染。
- Modify: `frontend/src/pages/console/user/task/task-detail.tsx`：实现紧凑模型组合条、模型图标、定位挂载位置和更多工具 Drawer。
- Modify: `frontend/test/task-detail-mobile-header-layout.test.mjs`：将已创建的两行页头测试更新为单行紧凑页头与更多工具测试。
- Modify: `frontend/src/i18n/resources/cn.ts`：增加定位 Drawer 和更多工具中文文案。
- Modify: `frontend/src/i18n/resources/en.ts`：增加定位 Drawer 和更多工具英文文案。

### Task 1: 手机端对话定位 Drawer

**Files:**
- Create: `frontend/test/task-user-input-index-mobile-layout.test.mjs`
- Modify: `frontend/src/components/console/task/task-user-input-index.tsx`
- Modify: `frontend/src/i18n/resources/cn.ts:4133-4138`
- Modify: `frontend/src/i18n/resources/en.ts:4133-4138`

**Interfaces:**
- Consumes: 现有 `TaskUserInputIndexProps`、定位分页状态、`handleJump`、`mergedEntries` 和共享 Drawer 组件。
- Produces: 可选属性 `presentation?: "desktop" | "mobile"`；desktop 保持圆点栏，mobile 输出 44px 触发按钮和最多 70vh 的定位 Drawer。

- [ ] **Step 1: 编写失败的定位器响应式测试**

创建 `frontend/test/task-user-input-index-mobile-layout.test.mjs`：

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/components/console/task/task-user-input-index.tsx", import.meta.url),
  "utf8",
);
const cn = readFileSync(new URL("../src/i18n/resources/cn.ts", import.meta.url), "utf8");
const en = readFileSync(new URL("../src/i18n/resources/en.ts", import.meta.url), "utf8");

test("对话定位器提供手机 Drawer 和桌面圆点栏两种呈现", () => {
  assert.match(source, /presentation\?: "desktop" \| "mobile"/);
  assert.match(source, /presentation = "desktop"/);
  assert.match(source, /if \(presentation === "mobile"\)/);
  assert.match(source, /<Drawer open=\{mobileOpen\} onOpenChange=\{setMobileOpen\}>/);
  assert.match(source, /<DrawerClose asChild>/);
  assert.match(source, /aria-label=\{t\("taskDetail\.common\.close"\)\}/);
  assert.match(source, /className="size-11 shrink-0"/);
  assert.match(source, /className="absolute right-2 top-1\/2 z-20 -translate-y-1\/2"/);
});

test("手机和桌面定位列表复用同一渲染函数", () => {
  assert.match(source, /const renderEntries = \(onSelect: \(entry: UserInputIndexEntry\) => void\) =>/);
  assert.match(source, /renderEntries\(handleMobileJump\)/);
  assert.match(source, /renderEntries\(\(entry\) => \{ void handleJump\(entry\) \}\)/);
});

test("定位 Drawer 具备完整双语可访问文案", () => {
  assert.match(cn, /userInputIndex:\s*\{[\s\S]*?trigger: "对话定位"[\s\S]*?title: "定位到历史对话"[\s\S]*?description: "选择一条用户消息并跳转到对应位置。"/);
  assert.match(en, /userInputIndex:\s*\{[\s\S]*?trigger: "Conversation navigator"[\s\S]*?title: "Jump to a conversation"[\s\S]*?description: "Select a user message to jump to its position\."/);
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```bash
/root/.local/share/pnpm/nodejs/22.23.1/bin/node --test frontend/test/task-user-input-index-mobile-layout.test.mjs
```

Expected: FAIL，当前组件缺少 `presentation`、Drawer、共享列表函数和新文案。

- [ ] **Step 3: 增加定位 Drawer 双语文案**

将中文 `taskDetail.userInputIndex` 更新为：

```ts
userInputIndex: {
  trigger: "对话定位",
  title: "定位到历史对话",
  description: "选择一条用户消息并跳转到对应位置。",
  fetchFailed: "获取对话列表失败",
  notFound: "未找到对应消息",
  locating: "正在定位消息...",
  loadMore: "加载更多",
},
```

将英文 `taskDetail.userInputIndex` 更新为：

```ts
userInputIndex: {
  trigger: "Conversation navigator",
  title: "Jump to a conversation",
  description: "Select a user message to jump to its position.",
  fetchFailed: "Failed to load conversation list",
  notFound: "Matching message not found",
  locating: "Locating message...",
  loadMore: "Load more",
},
```

- [ ] **Step 4: 增加 Drawer 依赖、呈现属性和手机状态**

在 `task-user-input-index.tsx` 增加导入：

```tsx
import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import { IconListSearch, IconX } from "@tabler/icons-react"
```

扩展属性并提供桌面默认值：

```tsx
export interface TaskUserInputIndexProps {
  taskId: string | null | undefined
  liveMessages: MessageType[]
  getScrollContainer: () => HTMLElement | null
  scrollToMessage?: (messageId: string, options?: { align?: "start" | "center" | "end" | "auto"; behavior?: ScrollBehavior; highlight?: boolean }) => boolean
  historyHasMore: boolean
  loadMoreHistory: () => Promise<void>
  presentation?: "desktop" | "mobile"
}

export function TaskUserInputIndex(props: TaskUserInputIndexProps) {
  const {
    taskId,
    liveMessages,
    getScrollContainer,
    scrollToMessage,
    historyHasMore,
    loadMoreHistory,
    presentation = "desktop",
  } = props
  const [mobileOpen, setMobileOpen] = React.useState(false)
```

- [ ] **Step 5: 让跳转结果可用于自动关闭 Drawer**

将 `handleJump` 的所有退出路径改为布尔结果：

```tsx
const handleJump = React.useCallback(async (entry: UserInputIndexEntry) => {
  const scrollVirtualMessage = () => scrollToMessage?.(entry.id, {
    align: "start",
    behavior: "smooth",
    highlight: true,
  }) ?? false

  if (scrollVirtualMessage()) return true

  const container = getScrollContainer()
  if (!container) return false
  const findTarget = () => container.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(entry.id)}"]`)
  let target = findTarget()

  if (!target) {
    setJumpingId(entry.id)
    try {
      const MAX_PAGES = 200
      let pages = 0
      while (!target && historyHasMoreRef.current && pages < MAX_PAGES) {
        await loadMoreHistoryRef.current()
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        if (scrollVirtualMessage()) return true
        target = findTarget()
        pages++
      }
    } finally {
      setJumpingId(null)
    }
    if (!target) {
      toast.info(t("taskDetail.userInputIndex.notFound"))
      return false
    }
  }

  const containerTop = container.getBoundingClientRect().top
  container.scrollTo({
    top: container.scrollTop + target.getBoundingClientRect().top - containerTop - 8,
    behavior: "smooth",
  })
  const bubble = target.querySelector<HTMLElement>(".bg-accent\\/50") ?? target
  bubble.classList.add("jump-highlight")
  bubble.addEventListener("animationend", () => bubble.classList.remove("jump-highlight"), { once: true })
  return true
}, [getScrollContainer, scrollToMessage, t])

const handleMobileJump = React.useCallback(async (entry: UserInputIndexEntry) => {
  if (await handleJump(entry)) {
    setMobileOpen(false)
  }
}, [handleJump])
```

- [ ] **Step 6: 抽取共享定位列表内容**

把当前桌面展开面板内的 sticky 状态区和条目列表提取为：

```tsx
const renderEntries = (onSelect: (entry: UserInputIndexEntry) => void) => (
  <>
    {(jumpingId || hasMore) && (
      <div className="sticky top-0 z-10 border-b bg-popover/95">
        {jumpingId && (
          <div className="flex items-center gap-1.5 px-4 py-2 text-xs text-muted-foreground">
            <Spinner className="size-3" />
            {t("taskDetail.userInputIndex.locating")}
          </div>
        )}
        {hasMore && (
          <div className="p-1.5">
            <button
              type="button"
              onClick={() => fetchPage(cursor ?? undefined)}
              disabled={loading}
              className={cn(
                "flex h-8 w-full items-center justify-center gap-1.5 rounded-md text-sm transition-colors",
                "text-muted-foreground hover:bg-accent hover:text-popover-foreground",
                "disabled:pointer-events-none disabled:opacity-60",
              )}
            >
              {loading && <Spinner className="size-3.5" />}
              {t("taskDetail.userInputIndex.loadMore")}
            </button>
          </div>
        )}
      </div>
    )}
    <div className="flex flex-col py-1.5">
      {mergedEntries.map((entry) => {
        const isJumping = jumpingId === entry.id
        return (
          <button
            type="button"
            key={entry.id}
            onClick={() => onSelect(entry)}
            disabled={isJumping}
            className={cn(
              "min-h-11 w-full min-w-0 truncate px-4 py-2 text-left text-sm transition-colors",
              "text-popover-foreground/80 hover:bg-accent hover:text-popover-foreground",
              isJumping && "opacity-50",
            )}
          >
            {isJumping && <Spinner className="mr-1.5 inline size-3" />}
            {entry.content || "..."}
          </button>
        )
      })}
      {loading && !hasMore && (
        <div className="flex justify-center py-2"><Spinner className="size-4" /></div>
      )}
    </div>
  </>
)
```

桌面面板将原内容替换为：

```tsx
{renderEntries((entry) => { void handleJump(entry) })}
```

- [ ] **Step 7: 渲染手机定位 Drawer**

保留 `if (mergedEntries.length <= 1 && !loading) return null`，随后在桌面圆点栏 return 前增加：

```tsx
if (presentation === "mobile") {
  return (
    <Drawer open={mobileOpen} onOpenChange={setMobileOpen}>
      <DrawerTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-11 shrink-0"
          aria-label={t("taskDetail.userInputIndex.trigger")}
        >
          <IconListSearch className="size-4" />
        </Button>
      </DrawerTrigger>
      <DrawerContent className="max-h-[70vh]">
        <div className="relative">
          <DrawerHeader className="pr-16 text-left">
            <DrawerTitle>{t("taskDetail.userInputIndex.title")}</DrawerTitle>
            <DrawerDescription>{t("taskDetail.userInputIndex.description")}</DrawerDescription>
          </DrawerHeader>
          <DrawerClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-4 top-4 size-11"
              aria-label={t("taskDetail.common.close")}
            >
              <IconX className="size-4" />
            </Button>
          </DrawerClose>
        </div>
        <div className="min-h-0 overflow-y-auto border-t">
          {renderEntries(handleMobileJump)}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
```

桌面 return 保持 `absolute right-2 top-1/2`、圆点摘要和 280px hover 面板。

- [ ] **Step 8: 运行定位器测试并确认 GREEN**

Run:

```bash
/root/.local/share/pnpm/nodejs/22.23.1/bin/node --test frontend/test/task-user-input-index-mobile-layout.test.mjs frontend/test/task-user-input-index-model.test.ts
```

Expected: PASS，定位器结构测试和既有定位模型测试全部通过。

- [ ] **Step 9: 请求授权后提交 Task 1**

报告 RED/GREEN 结果并请求该任务的明确 commit 授权。授权后执行：

```bash
git add -- frontend/src/components/console/task/task-user-input-index.tsx frontend/src/i18n/resources/cn.ts frontend/src/i18n/resources/en.ts frontend/test/task-user-input-index-mobile-layout.test.mjs
git commit -m "修复：优化移动端对话定位交互"
```

### Task 2: 紧凑模型工具栏与更多 Drawer

**Files:**
- Modify: `frontend/src/pages/console/user/task/task-detail.tsx:1212-1553`
- Modify: `frontend/test/task-detail-mobile-header-layout.test.mjs`
- Modify: `frontend/src/i18n/resources/cn.ts:3990-4030`
- Modify: `frontend/src/i18n/resources/en.ts:3990-4030`

**Interfaces:**
- Consumes: Task 1 的 `TaskUserInputIndex presentation="mobile" | "desktop"`、现有模型与上下文状态、技能/文件/预览/发布处理函数。
- Produces: 手机端单行模型组合条、模型品牌图标、定位入口、更多工具 Drawer，以及保持原结构的桌面工具栏和圆点定位器。

- [ ] **Step 1: 将页头测试改为新的失败预期**

将 `frontend/test/task-detail-mobile-header-layout.test.mjs` 内容替换为：

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/pages/console/user/task/task-detail.tsx", import.meta.url),
  "utf8",
);
const cn = readFileSync(new URL("../src/i18n/resources/cn.ts", import.meta.url), "utf8");
const en = readFileSync(new URL("../src/i18n/resources/en.ts", import.meta.url), "utf8");

test("手机端页头使用单行模型组合条、定位和更多入口", () => {
  assert.match(source, /className="flex items-center gap-2 md:justify-between md:gap-3"/);
  assert.match(source, /className="flex min-w-0 flex-1 overflow-hidden rounded-md border md:contents"/);
  assert.match(source, /<Icon name=\{getBrandFromModel\(currentModel\)\} className="size-4 shrink-0" \/>/);
  assert.match(source, /presentation="mobile"/);
  assert.match(source, /presentation="desktop"/);
});

test("手机端常驻入口保持 44px 触控尺寸", () => {
  assert.match(source, /className="h-11 min-w-0 flex-1 gap-2 border-0 px-2 text-xs font-normal md:h-7/);
  assert.match(source, /className="inline-flex size-11 shrink-0 items-center justify-center border-l/);
  assert.match(source, /aria-label=\{t\("taskDetail\.page\.mobileTools\.trigger"\)\}/);
});

test("更多 Drawer 提供四项工具并先关闭再执行", () => {
  assert.match(source, /<Drawer open=\{mobileToolsOpen\} onOpenChange=\{setMobileToolsOpen\}>/);
  assert.match(source, /<DrawerClose asChild>/);
  assert.match(source, /aria-label=\{t\("taskDetail\.common\.close"\)\}/);
  assert.match(source, /const runMobileToolAction = React\.useCallback/);
  assert.match(source, /requestAnimationFrame\(action\)/);
  assert.match(source, /taskDetail\.chat\.skills/);
  assert.match(source, /taskDetail\.panels\.files/);
  assert.match(source, /taskDetail\.panels\.preview/);
  assert.match(source, /taskDetail\.page\.dialogs\.publishWebsite\.button/);
});

test("更多 Drawer 具备完整双语文案", () => {
  assert.match(cn, /mobileTools:\s*\{[\s\S]*?trigger: "更多任务工具"[\s\S]*?title: "任务工具"[\s\S]*?description: "选择要打开的任务工具。"/);
  assert.match(en, /mobileTools:\s*\{[\s\S]*?trigger: "More task tools"[\s\S]*?title: "Task tools"[\s\S]*?description: "Choose a task tool to open\."/);
});
```

- [ ] **Step 2: 运行页头测试并确认 RED**

Run:

```bash
/root/.local/share/pnpm/nodejs/22.23.1/bin/node --test frontend/test/task-detail-mobile-header-layout.test.mjs
```

Expected: FAIL，当前两行实现缺少组合条、模型图标、定位变体和更多 Drawer。

- [ ] **Step 3: 增加更多工具双语文案与 Drawer 依赖**

在中文 `taskDetail.page` 增加：

```ts
mobileTools: {
  trigger: "更多任务工具",
  title: "任务工具",
  description: "选择要打开的任务工具。",
},
```

在英文 `taskDetail.page` 增加：

```ts
mobileTools: {
  trigger: "More task tools",
  title: "Task tools",
  description: "Choose a task tool to open.",
},
```

在 `task-detail.tsx` 增加：

```tsx
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
```

将 Tabler 图标导入扩展为 `IconChevronDown, IconDeviceDesktop, IconDots, IconFile, IconPuzzle, IconReload, IconTerminal2, IconUpload, IconX`。

- [ ] **Step 4: 增加更多 Drawer 状态与动作调度**

在页面状态区增加：

```tsx
const [mobileToolsOpen, setMobileToolsOpen] = React.useState(false)
```

在 `detailHeader` 前增加：

```tsx
const runMobileToolAction = React.useCallback((action: () => void) => {
  setMobileToolsOpen(false)
  requestAnimationFrame(action)
}, [])
```

- [ ] **Step 5: 将页头改为单行组合结构**

将 `detailHeader` 根行和左侧信息区改为：

```tsx
<div className="flex items-center gap-2 md:justify-between md:gap-3">
  <div className="flex min-w-0 flex-1 items-center gap-2">
    <div className="flex min-w-0 flex-1 overflow-hidden rounded-md border md:contents">
```

模型触发按钮改为：

```tsx
<Button
  type="button"
  variant="outline"
  size="sm"
  className="h-11 min-w-0 flex-1 gap-2 border-0 px-2 text-xs font-normal md:h-7 md:max-w-[220px] md:shrink-0 md:flex-none md:border"
  disabled={!canSwitchModel}
>
  {currentModel && (
    <Icon name={getBrandFromModel(currentModel)} className="size-4 shrink-0" />
  )}
  <span className="truncate">{getCurrentModelDisplayName() || t("taskDetail.page.models.unknown")}</span>
  <IconChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
</Button>
```

上下文触发按钮改为组合条右侧独立入口：

```tsx
className="inline-flex size-11 shrink-0 items-center justify-center border-l outline-none focus-visible:ring-2 focus-visible:ring-ring/50 md:size-auto md:border-0"
```

关闭组合条后，在信息区增加手机定位入口和更多 Drawer：

```tsx
</div>
{isMobile && (
  <TaskUserInputIndex
    presentation="mobile"
    taskId={taskId ?? null}
    liveMessages={messages}
    getScrollContainer={getChatScrollContainer}
    scrollToMessage={scrollChatToMessage}
    historyHasMore={!historyLoaded || historyHasMore}
    loadMoreHistory={() => fetchTaskRounds(historyCursorRef.current ?? undefined, 1)}
  />
)}
<Drawer open={mobileToolsOpen} onOpenChange={setMobileToolsOpen}>
  <DrawerTrigger asChild>
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="size-11 shrink-0 md:hidden"
      aria-label={t("taskDetail.page.mobileTools.trigger")}
    >
      <IconDots className="size-4" />
    </Button>
  </DrawerTrigger>
```

- [ ] **Step 6: 增加更多工具 Drawer 内容**

在 DrawerTrigger 后增加：

```tsx
<DrawerContent>
  <div className="relative">
    <DrawerHeader className="pr-16 text-left">
      <DrawerTitle>{t("taskDetail.page.mobileTools.title")}</DrawerTitle>
      <DrawerDescription>{t("taskDetail.page.mobileTools.description")}</DrawerDescription>
    </DrawerHeader>
    <DrawerClose asChild>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute right-4 top-4 size-11"
        aria-label={t("taskDetail.common.close")}
      >
        <IconX className="size-4" />
      </Button>
    </DrawerClose>
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
      className={cn("min-h-16 justify-start gap-2", activeSidePanel === "files" && "text-primary bg-accent")}
      disabled={!taskInteractive}
      onClick={() => runMobileToolAction(() => toggleSidePanel("files"))}
    >
      <IconFile className="size-4 shrink-0" />
      {t("taskDetail.panels.files")}{fileChangesCount > 0 ? ` (${fileChangesCount})` : ""}
    </Button>
    <Button
      type="button"
      variant="secondary"
      className={cn("min-h-16 justify-start gap-2", previewDialogOpen && "text-primary bg-accent")}
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
        className={cn("min-h-16 justify-start gap-2", publishConfirmDialogOpen && "text-primary bg-accent")}
        disabled={!canInput}
        onClick={() => runMobileToolAction(() => setPublishConfirmDialogOpen(true))}
      >
        <IconUpload className="size-4 shrink-0" />
        {t("taskDetail.page.dialogs.publishWebsite.button")}
      </Button>
    )}
  </div>
</DrawerContent>
</Drawer>
```

将现有桌面技能、终端、文件、预览和发布操作组外层改为：

```tsx
<div className="hidden shrink-0 md:block">
  <div className="flex items-center gap-0.5">
```

其内部按钮恢复原有 28px 高度、文字和选中态 class。

- [ ] **Step 7: 仅在消息区挂载桌面定位器**

将消息区现有定位器改为：

```tsx
{!isMobile && (
  <TaskUserInputIndex
    presentation="desktop"
    taskId={taskId ?? null}
    liveMessages={messages}
    getScrollContainer={getChatScrollContainer}
    scrollToMessage={scrollChatToMessage}
    historyHasMore={!historyLoaded || historyHasMore}
    loadMoreHistory={() => fetchTaskRounds(historyCursorRef.current ?? undefined, 1)}
  />
)}
```

该条件确保手机消息区不创建绝对定位圆点栏，横竖屏切换时只有一个定位组件实例。

- [ ] **Step 8: 运行聚焦测试并确认 GREEN**

Run:

```bash
/root/.local/share/pnpm/nodejs/22.23.1/bin/node --test frontend/test/task-detail-mobile-header-layout.test.mjs frontend/test/task-user-input-index-mobile-layout.test.mjs frontend/test/task-user-input-index-model.test.ts frontend/test/task-chat-input-mobile-layout.test.mjs frontend/test/input-group-orientation.test.mjs
```

Expected: PASS，紧凑页头、手机定位 Drawer、桌面定位、输入栏和共享输入组测试全部通过。

- [ ] **Step 9: 运行静态检查与 online build**

worktree 缺少 `node_modules/.bin`，直接使用锁定 CLI：

```bash
/root/.local/share/pnpm/nodejs/22.23.1/bin/node frontend/node_modules/eslint/bin/eslint.js frontend
/root/.local/share/pnpm/nodejs/22.23.1/bin/node frontend/node_modules/typescript/bin/tsc -b -p frontend
```

从 `frontend/` 目录运行 online build：

```bash
/root/.local/share/pnpm/nodejs/22.23.1/bin/node node_modules/typescript/bin/tsc -b
/root/.local/share/pnpm/nodejs/22.23.1/bin/node node_modules/vite/bin/vite.js build --mode online
```

最后运行：

```bash
git diff --check
```

Expected: ESLint、TypeScript、online build 和差异格式检查全部通过；build 无需 `TARGET`。

- [ ] **Step 10: 完成 online 预览和多宽度验收**

复用 4215 online 预览并执行：

```bash
PREVIEW_URL=https://4215-e84020e6e952be3c.monkeycode-ai.online /root/.local/share/pnpm/nodejs/22.23.1/bin/node frontend/scripts/check-online-preview.mjs
```

Expected: 首页、CAP JavaScript、WASM 和 challenge API 健康检查通过。

人工验证 320px、375px、390px、430px 和 1280px：

- 手机页头保持单行，模型图标、名称、上下文、定位和更多均可见。
- 长模型名称受控省略，无横向滚动。
- 定位 Drawer 可加载、跳转、高亮并自动关闭。
- 更多 Drawer 的四项工具状态和点击行为正确。
- 手机消息区无常驻圆点栏和内容遮挡。
- 桌面页头、28px 操作按钮和 hover 圆点定位器保持原样。
- 字体族、字号、字重和行高保持现有样式。

- [ ] **Step 11: 请求授权后提交 Task 2**

报告全部测试、构建、健康检查和人工验收结果，并请求该任务的明确 commit 授权。授权后执行：

```bash
git add -- frontend/src/pages/console/user/task/task-detail.tsx frontend/src/i18n/resources/cn.ts frontend/src/i18n/resources/en.ts frontend/test/task-detail-mobile-header-layout.test.mjs
git commit -m "修复：收紧移动端任务工具栏布局"
```

Expected: Task 2 只提交页头、更多 Drawer、双语文案和页头测试；验证码、字体、MEMORY 与其他计划文件保持原状态。
