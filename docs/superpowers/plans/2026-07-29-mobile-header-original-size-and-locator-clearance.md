# 手机页头原始尺寸与消息定位避让实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 恢复手机任务页官方紧凑页头尺寸，并让收起的消息定位圆点条不再遮挡消息内容。

**Architecture:** 页头继续使用现有 Flex 和 Radix Popover，仅将可见控件恢复为官方尺寸，同时用两个 44px 布局槽保留 104px 对齐轨道。消息定位继续保持单一绝对定位实例，圆点条恢复官方紧凑 class，虚拟消息行在手机端增加 44px 右侧安全槽。

**Tech Stack:** React、TypeScript、Tailwind CSS、Radix UI、Node.js Test Runner、ESLint、Vite

## Global Constraints

- 模型按钮高度为 28px，上下文圆环为 20px，三点按钮为 28px × 28px。
- 工具菜单宽度继续为 104px，左边线与模型按钮右边线精确重合。
- 上下文入口缺省时继续保留 44px 布局槽。
- 手机消息内容预留 44px 右侧安全槽；桌面消息宽度保持现状。
- 保留单一 `TaskUserInputIndex`、现有历史加载、消息跳转、回到底部、触摸展开和外部收起行为。
- 不新增依赖、全局状态、Drawer、第二个定位入口或 JavaScript 几何测量。
- 使用 RED-GREEN-REFACTOR；每个实现任务提交前必须获得用户单独明确授权。
- 每次提交只暂存任务列出的文件，保留工作树中的其他改动。

---

### Task 1: 恢复页头官方尺寸并保留 104px 对齐

**Files:**
- Modify: `frontend/src/pages/console/user/task/task-detail.tsx:1257-1425`
- Test: `frontend/test/task-detail-mobile-header-layout.test.mjs:13-42`

**Interfaces:**
- Consumes: 现有 `mobileToolsOpen`、`contextUsagePopoverOpen`、`mobileToolsView` 和 Radix `Popover`。
- Produces: 28px 模型按钮、20px 上下文入口、44px 上下文槽、44px 贴右三点槽和 28px 三点按钮；不新增组件接口。

- [ ] **Step 1: 更新页头尺寸契约测试**

将 `frontend/test/task-detail-mobile-header-layout.test.mjs` 的前两个测试改为以下断言，并在 Popover 测试中继续保留 104px 菜单断言：

```javascript
test("手机页头恢复官方紧凑尺寸", () => {
  assert.match(source, /className="h-7 min-w-0 flex-1 gap-1 px-2 text-xs font-normal md:max-w-\[220px\]/);
  assert.doesNotMatch(source, /getBrandFromModel\(currentModel\)[\s\S]*?md:hidden/);
  assert.doesNotMatch(source, /overflow-hidden rounded-md border md:contents/);
  assert.match(source, /className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm/);
  assert.match(source, /<CircularProgress[\s\S]*?size=\{20\}/);
  assert.match(source, /className="flex w-11 shrink-0 justify-end md:hidden"[\s\S]*?className="size-7 shrink-0"/);
  assert.match(source, /onPointerUp=\{\(event\) => \{[\s\S]*?event\.pointerType === "touch"[\s\S]*?setContextUsagePopoverOpen\(\(open\) => !open\)/);
  assert.doesNotMatch(source, /className="h-11 min-w-0 flex-1/);
  assert.doesNotMatch(source, /className="size-11 shrink-0 md:hidden"/);
});

test("320px 页头保留 104px 尾部对齐轨道", () => {
  assert.match(source, /className="flex min-w-0 flex-1 items-center gap-2"/);
  assert.match(source, /className="flex w-11 shrink-0 flex-wrap items-center/);
  assert.match(source, /className="flex w-11 shrink-0 justify-end md:hidden"/);
  assert.match(source, /mobileToolsView === "tools"[\s\S]*?"w-\[104px\] p-1\.5"/);
});
```

- [ ] **Step 2: 运行聚焦测试确认 RED**

Run:

```bash
cd frontend
/root/.local/share/pnpm/nodejs/22.23.1/bin/node --test test/task-detail-mobile-header-layout.test.mjs
```

Expected: FAIL；当前源码仍包含手机模型 `h-11`、上下文 `size-11` 和三点 `size-11`。

- [ ] **Step 3: 实现官方可见尺寸和两个布局槽**

将模型按钮 class 改为：

```tsx
className="h-7 min-w-0 flex-1 gap-1 px-2 text-xs font-normal md:max-w-[220px] md:shrink-0 md:flex-none"
```

保留现有 44px 上下文容器，将触发按钮 class 从：

```tsx
className="inline-flex size-11 shrink-0 items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 md:size-auto"
```

替换为：

```tsx
className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
```

在现有手机 Popover 外增加贴右的 44px 槽。将：

```tsx
<Popover modal open={mobileToolsOpen} onOpenChange={handleMobileToolsOpenChange}>
```

替换为：

```tsx
<div className="flex w-11 shrink-0 justify-end md:hidden">
  <Popover modal open={mobileToolsOpen} onOpenChange={handleMobileToolsOpenChange}>
```

将三点按钮 class 从：

```tsx
className="size-11 shrink-0 md:hidden"
```

替换为：

```tsx
className="size-7 shrink-0"
```

最后将 Popover 结尾：

```tsx
          </Popover>
        </div>
        <div className="hidden shrink-0 md:block">
```

替换为包含新增槽位闭合标签的结构：

```tsx
            </Popover>
          </div>
        </div>
        <div className="hidden shrink-0 md:block">
```

格式化后保持嵌套缩进一致，现有 `PopoverContent`、工具视图和文件视图内容不变。

- [ ] **Step 4: 运行页头测试确认 GREEN**

Run:

```bash
cd frontend
/root/.local/share/pnpm/nodejs/22.23.1/bin/node --test test/task-detail-mobile-header-layout.test.mjs
```

Expected: PASS；页头相关测试全部通过。

- [ ] **Step 5: 运行目标静态检查**

Run:

```bash
cd frontend
/root/.local/share/pnpm/nodejs/22.23.1/bin/node node_modules/eslint/bin/eslint.js src/pages/console/user/task/task-detail.tsx test/task-detail-mobile-header-layout.test.mjs
git diff --check -- src/pages/console/user/task/task-detail.tsx test/task-detail-mobile-header-layout.test.mjs
```

Expected: 两条命令均退出 0 且无输出。

- [ ] **Step 6: 请求授权后提交 Task 1**

获得用户对本任务的单独明确授权后运行：

```bash
git add frontend/src/pages/console/user/task/task-detail.tsx frontend/test/task-detail-mobile-header-layout.test.mjs
git diff --cached --check
git commit -m "修复：恢复手机页头官方紧凑尺寸"
```

Expected: 提交仅包含上述两个文件。

### Task 2: 恢复官方定位圆点并增加手机安全槽

**Files:**
- Modify: `frontend/src/components/console/task/task-user-input-index.tsx:282-317`
- Modify: `frontend/src/components/console/task/task-message-virtual-list.tsx:226-243`
- Test: `frontend/test/task-user-input-index-mobile-layout.test.mjs:5-29`

**Interfaces:**
- Consumes: `TaskUserInputIndex` 当前单实例挂载方式和 `TaskMessageVirtualList` 现有虚拟行结构。
- Produces: 官方紧凑圆点条 class，以及只作用于手机虚拟消息行的 44px 右侧安全槽；组件 props 保持不变。

- [ ] **Step 1: 写入圆点尺寸和安全槽失败测试**

在测试文件顶部读取虚拟列表源码：

```javascript
const virtualListSource = readFileSync(
  new URL("../src/components/console/task/task-message-virtual-list.tsx", import.meta.url),
  "utf8",
);
```

在“消息定位器保留官方单一右侧圆点面板”测试后添加：

```javascript
test("手机端恢复官方紧凑圆点并为消息预留右侧安全槽", () => {
  assert.match(source, /"flex flex-col items-center justify-center gap-\[5px\] rounded-full border bg-popover\/90 p-3/);
  assert.doesNotMatch(source, /min-h-11 min-w-11/);
  assert.match(virtualListSource, /className="absolute top-0 left-0 w-full pr-11 md:pr-0"/);
});
```

- [ ] **Step 2: 运行定位聚焦测试确认 RED**

Run:

```bash
cd frontend
/root/.local/share/pnpm/nodejs/22.23.1/bin/node --test test/task-user-input-index-mobile-layout.test.mjs
```

Expected: FAIL；圆点按钮仍含 `min-h-11 min-w-11`，虚拟消息行尚无 `pr-11 md:pr-0`。

- [ ] **Step 3: 恢复圆点条官方 class**

将收起圆点按钮的基础 class 改为：

```tsx
className={cn(
  "flex flex-col items-center justify-center gap-[5px] rounded-full border bg-popover/90 p-3 shadow-md backdrop-blur-sm transition-opacity cursor-pointer",
  expanded ? "opacity-0 pointer-events-none absolute right-0 top-1/2 -translate-y-1/2" : "opacity-60 hover:opacity-100",
)}
```

保留按钮语义、`aria-label`、`aria-expanded`、点击展开和圆点渲染。

- [ ] **Step 4: 为虚拟消息行增加手机安全槽**

将虚拟行容器改为：

```tsx
<div
  key={virtualRow.key}
  ref={virtualizer.measureElement}
  data-index={virtualRow.index}
  className="absolute top-0 left-0 w-full pr-11 md:pr-0"
  style={{ transform: `translateY(${virtualRow.start}px)` }}
>
```

该 class 让每一行在手机端保留 44px 右侧空间，并在 `md` 断点恢复零右内边距。

- [ ] **Step 5: 运行两个聚焦测试确认 GREEN**

Run:

```bash
cd frontend
/root/.local/share/pnpm/nodejs/22.23.1/bin/node --test test/task-detail-mobile-header-layout.test.mjs test/task-user-input-index-mobile-layout.test.mjs
```

Expected: PASS；页头与消息定位聚焦测试全部通过。

- [ ] **Step 6: 运行目标静态检查**

Run:

```bash
cd frontend
/root/.local/share/pnpm/nodejs/22.23.1/bin/node node_modules/eslint/bin/eslint.js src/components/console/task/task-user-input-index.tsx src/components/console/task/task-message-virtual-list.tsx test/task-user-input-index-mobile-layout.test.mjs
git diff --check -- src/components/console/task/task-user-input-index.tsx src/components/console/task/task-message-virtual-list.tsx test/task-user-input-index-mobile-layout.test.mjs
```

Expected: 两条命令均退出 0 且无输出。

- [ ] **Step 7: 请求授权后提交 Task 2**

获得用户对本任务的单独明确授权后运行：

```bash
git add frontend/src/components/console/task/task-user-input-index.tsx frontend/src/components/console/task/task-message-virtual-list.tsx frontend/test/task-user-input-index-mobile-layout.test.mjs
git diff --cached --check
git commit -m "修复：避免手机消息定位遮挡内容"
```

Expected: 提交仅包含上述三个文件。

### Task 3: 完整验证与人工验收

**Files:**
- Verify: `frontend/src/pages/console/user/task/task-detail.tsx`
- Verify: `frontend/src/components/console/task/task-user-input-index.tsx`
- Verify: `frontend/src/components/console/task/task-message-virtual-list.tsx`
- Verify: `frontend/test/task-detail-mobile-header-layout.test.mjs`
- Verify: `frontend/test/task-user-input-index-mobile-layout.test.mjs`

**Interfaces:**
- Consumes: Task 1 的紧凑页头和 Task 2 的消息安全槽。
- Produces: 自动验证结果、online 预览健康结果和用户登录态人工验收结论。

- [ ] **Step 1: 运行聚焦测试和差异检查**

Run:

```bash
cd frontend
/root/.local/share/pnpm/nodejs/22.23.1/bin/node --test test/task-detail-mobile-header-layout.test.mjs test/task-user-input-index-mobile-layout.test.mjs
git diff --check
```

Expected: 聚焦测试全部通过；差异检查退出 0。

- [ ] **Step 2: 运行完整 ESLint 和 TypeScript**

Run:

```bash
cd frontend
/root/.local/share/pnpm/nodejs/22.23.1/bin/node node_modules/eslint/bin/eslint.js .
/root/.local/share/pnpm/nodejs/22.23.1/bin/node node_modules/typescript/bin/tsc -b
```

Expected: 两条命令均退出 0。

- [ ] **Step 3: 运行完整测试**

Run:

```bash
cd frontend
/root/.local/share/pnpm/nodejs/22.23.1/bin/node --test
```

Expected: 本任务新增和修改的测试全部通过；修改前基线为 303 项中 295 通过、8 项既有失败，新增一个测试后预计为 304 项中 296 通过、8 项既有失败，失败集合不得扩大。

- [ ] **Step 4: 构建 online 版本**

Run:

```bash
cd frontend
/root/.local/share/pnpm/nodejs/22.23.1/bin/node node_modules/vite/bin/vite.js build --mode online
```

Expected: 构建退出 0 并输出成功产物。

- [ ] **Step 5: 验证 online 预览健康状态**

Run:

```bash
curl --fail --silent --show-error --max-time 20 "http://127.0.0.1:4215/" -o /dev/null
```

Expected: 命令退出 0。

- [ ] **Step 6: 请求只读代码审查**

审查范围限定为本计划的五个文件，要求报告 Critical、Important、Minor 和 `Ready to merge` 结论。所有 Critical 和 Important 问题必须在进入人工验收前修复并重新验证。

- [ ] **Step 7: 执行登录态人工验收**

在 320px、375px、390px、430px 和 1280px 下确认：

```text
手机端模型按钮和三点按钮为 28px，上下文圆环为 20px。
页头保持单行，无页面级横向滚动。
104px 工具菜单左边线与模型按钮右边线精确重合。
上下文入口显示和缺省时对齐一致。
收起的消息定位圆点条不覆盖消息文字或气泡。
展开、跳转消息、加载历史、回到底部和外部收起正常。
桌面端页头、消息宽度和定位面板保持现状。
```

Expected: 用户明确确认人工验收通过。
