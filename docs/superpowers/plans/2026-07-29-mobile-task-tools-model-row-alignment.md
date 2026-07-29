# 手机任务工具与模型区块水平对齐实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 仅调整手机任务页三点工具入口的垂直位置，使其中心与模型按钮中心精确处于同一水平线。

**Architecture:** 三点入口继续使用任务详情组件内的固定定位和原有 Popover 状态，将手机端顶距从 68px 调整为 58px。横向 `right-4`、32px 尺寸、40px 页头安全空间和全部工具交互保持现状。

**Tech Stack:** React、TypeScript、Tailwind CSS、Radix UI、Node.js Test Runner、ESLint、Vite

## Global Constraints

- 三点入口仅在手机任务详情页显示。
- 固定入口使用 `right-4 top-[58px] z-30 md:hidden`。
- 60px 顶栏加 28px 模型按钮半高，与 58px 顶距加 32px 三点按钮半高均为 74px。
- 三点按钮继续使用 `size="icon-sm"`。
- 40px 手机页头右侧安全空间和桌面清除规则保持现状。
- Popover 方位、宽度、文件视图、动作时序和关闭行为保持现状。
- 桌面任务页、其他控制台页面、主题按钮和消息定位保持现状。
- 使用 RED-GREEN-REFACTOR；实现提交前获得用户单独明确授权。
- 每次提交仅暂存任务列出的文件，保留工作树中的其他改动。

---

### Task 1: 精确对齐手机工具入口与模型按钮中心

**Files:**
- Modify: `frontend/src/pages/console/user/task/task-detail.tsx:1403`
- Test: `frontend/test/task-detail-mobile-header-layout.test.mjs:16-53`

**Interfaces:**
- Consumes: 现有 `detailHeader`、`mobileToolsOpen`、`Popover` 和 Button `icon-sm` 尺寸契约。
- Produces: 横向位置保持、中心纵坐标为 74px 的手机三点工具入口；组件 props、状态和事件保持不变。

- [ ] **Step 1: 写入 58px 顶距和中心对齐失败测试**

在 `frontend/test/task-detail-mobile-header-layout.test.mjs` 的“手机页头恢复官方紧凑尺寸”测试中，将：

```javascript
assert.match(source, /className="fixed right-4 top-17 z-30 md:hidden"[\s\S]*?size="icon-sm"/);
```

替换为：

```javascript
assert.match(source, /className="fixed right-4 top-\[58px\] z-30 md:hidden"[\s\S]*?size="icon-sm"/);
```

将测试名称：

```javascript
test("手机工具入口位于主题按钮正下方并使用相同尺寸", () => {
```

替换为：

```javascript
test("手机工具入口保持横向位置并与模型按钮中心对齐", () => {
```

在该测试中，将定位手机工具代码块的语句：

```javascript
const mobileToolsStart = source.indexOf('<div className="fixed right-4 top-17 z-30 md:hidden">');
```

替换为：

```javascript
const mobileToolsStart = source.indexOf('<div className="fixed right-4 top-[58px] z-30 md:hidden">');
```

并在 Button 尺寸断言后新增中心对齐契约：

```javascript
assert.match(source, /className="h-7 min-w-0 max-w-\[220px\] shrink gap-1 px-2 text-xs font-normal"/);
assert.equal(60 + 28 / 2, 58 + 32 / 2);
```

保留 `right-4`、`icon-sm`、唯一 Popover、104px 工具菜单和文件视图的全部现有断言。

- [ ] **Step 2: 运行页头聚焦测试确认 RED**

Run:

```bash
cd frontend
/root/.local/share/pnpm/nodejs/22.23.1/bin/node --test test/task-detail-mobile-header-layout.test.mjs
```

Expected: 10 项中 2 项失败，失败原因是源码仍包含 `top-17`，缺少 `top-[58px]`。

- [ ] **Step 3: 仅调整手机工具入口顶距**

在 `frontend/src/pages/console/user/task/task-detail.tsx` 中将：

```tsx
<div className="fixed right-4 top-17 z-30 md:hidden">
```

替换为：

```tsx
<div className="fixed right-4 top-[58px] z-30 md:hidden">
```

保留该元素内的 `Popover`、`Button size="icon-sm"`、ARIA、PopoverContent 和全部处理函数。

- [ ] **Step 4: 运行页头测试确认 GREEN**

Run:

```bash
cd frontend
/root/.local/share/pnpm/nodejs/22.23.1/bin/node --test test/task-detail-mobile-header-layout.test.mjs
```

Expected: 页头测试 10/10 通过。

- [ ] **Step 5: 运行组合测试和目标静态检查**

Run:

```bash
cd frontend
/root/.local/share/pnpm/nodejs/22.23.1/bin/node --test test/task-detail-mobile-header-layout.test.mjs test/task-user-input-index-mobile-layout.test.mjs
/root/.local/share/pnpm/nodejs/22.23.1/bin/node node_modules/eslint/bin/eslint.js src/pages/console/user/task/task-detail.tsx test/task-detail-mobile-header-layout.test.mjs
git diff --check -- src/pages/console/user/task/task-detail.tsx test/task-detail-mobile-header-layout.test.mjs
```

Expected: 组合测试 19/19 通过，ESLint 和差异检查均退出 0。

- [ ] **Step 6: 运行完整回归与 online 构建**

Run:

```bash
cd frontend
/root/.local/share/pnpm/nodejs/22.23.1/bin/node node_modules/eslint/bin/eslint.js .
/root/.local/share/pnpm/nodejs/22.23.1/bin/node node_modules/typescript/bin/tsc -b
/root/.local/share/pnpm/nodejs/22.23.1/bin/node --test
/root/.local/share/pnpm/nodejs/22.23.1/bin/node node_modules/vite/bin/vite.js build --mode online
```

Expected: ESLint、TypeScript 和 online build 退出 0；完整测试保持 305 项中 297 通过、8 项既有失败，失败集合保持一致。

- [ ] **Step 7: 执行 online 健康检查和登录态人工验收**

Run:

```bash
cd frontend
PREVIEW_URL=https://4215-e84020e6e952be3c.monkeycode-ai.online /root/.local/share/pnpm/nodejs/22.23.1/bin/node scripts/check-online-preview.mjs
```

Expected: 输出 `Online preview captcha health check passed.`。

在 320px、375px、390px、430px 和 1280px 下确认：

```text
手机任务页三点按钮横向位置保持在主题按钮正下方。
三点按钮中心与模型按钮中心处于同一水平线。
模型、上下文圆环和三点入口之间无覆盖。
工具菜单和文件视图交互正常。
桌面任务页和其他控制台页面保持现状。
```

- [ ] **Step 8: 请求授权后提交实现**

获得用户对本任务的单独明确授权后运行：

```bash
git add frontend/src/pages/console/user/task/task-detail.tsx frontend/test/task-detail-mobile-header-layout.test.mjs
git diff --cached --check
git commit -m "修复：对齐手机任务工具与模型区块"
```

Expected: 提交仅包含上述两个文件，核心实现差异仅为工具入口顶距从 `top-17` 调整为 `top-[58px]`。
