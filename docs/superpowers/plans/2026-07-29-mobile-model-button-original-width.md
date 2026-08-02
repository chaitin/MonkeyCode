# 手机模型按钮原始宽度修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 恢复手机任务页模型按钮按名称自适应的原始宽度，同时保持 28px 高度、窄屏收缩能力和 104px 工具菜单对齐。

**Architecture:** 继续使用现有页头 Flex 结构和 Radix Popover。模型按钮移除占满剩余空间的 flex grow，恢复最大 220px 的内容自适应宽度，并保留 flex shrink 与文本截断来适配 320px；尾部两个 44px 槽和两个 8px 间距继续构成紧跟按钮的 104px 对齐轨道。

**Tech Stack:** React、TypeScript、Tailwind CSS、Radix UI、Node.js Test Runner、ESLint、Vite

## Global Constraints

- 模型按钮高度保持 28px，宽度按模型名称自适应，最大宽度为 220px。
- 320px 空间不足时模型按钮允许收缩，模型名称使用省略号截断。
- 104px 尾部轨道紧跟模型按钮，工具菜单左边线与模型按钮右边线精确重合。
- 上下文圆环、三点按钮、工具菜单、文件视图和消息定位逻辑保持现状。
- 实现范围限定为现有 Tailwind class 和源码契约测试。
- 使用 RED-GREEN-REFACTOR；实现提交前获得用户单独明确授权。
- 每次提交仅暂存任务列出的文件，保留工作树中的其他改动。

---

### Task 1: 恢复模型按钮内容自适应宽度

**Files:**
- Modify: `frontend/src/pages/console/user/task/task-detail.tsx:1266-1276`
- Test: `frontend/test/task-detail-mobile-header-layout.test.mjs:13-30`

**Interfaces:**
- Consumes: 现有 `getCurrentModelDisplayName()`、模型切换 `DropdownMenu` 和 104px 尾部轨道。
- Produces: 高度 28px、内容自适应、最大 220px、窄屏可收缩的模型按钮；组件 props 和状态保持不变。

- [ ] **Step 1: 写入模型按钮宽度失败测试**

将 `frontend/test/task-detail-mobile-header-layout.test.mjs` 中“手机页头恢复官方紧凑尺寸”测试的首条按钮断言：

```javascript
assert.match(source, /className="h-7 min-w-0 flex-1 gap-1 px-2 text-xs font-normal md:max-w-\[220px\]/);
```

替换为以下两条断言：

```javascript
assert.match(source, /className="h-7 min-w-0 max-w-\[220px\] shrink gap-1 px-2 text-xs font-normal"/);
assert.doesNotMatch(source, /className="h-7 min-w-0 flex-1 gap-1 px-2 text-xs font-normal/);
```

保留该测试中上下文圆环、三点按钮和触摸行为的全部现有断言，并保留“320px 页头保留 104px 尾部对齐轨道”测试。

- [ ] **Step 2: 运行聚焦测试确认 RED**

Run:

```bash
cd frontend
/root/.local/share/pnpm/nodejs/22.23.1/bin/node --test test/task-detail-mobile-header-layout.test.mjs
```

Expected: “手机页头恢复官方紧凑尺寸”失败，错误显示源码仍包含 `flex-1` 且缺少 `max-w-[220px] shrink`。

- [ ] **Step 3: 实现内容自适应宽度**

在 `frontend/src/pages/console/user/task/task-detail.tsx` 中将模型按钮 class：

```tsx
className="h-7 min-w-0 flex-1 gap-1 px-2 text-xs font-normal md:max-w-[220px] md:shrink-0 md:flex-none"
```

替换为：

```tsx
className="h-7 min-w-0 max-w-[220px] shrink gap-1 px-2 text-xs font-normal"
```

`max-w-[220px]` 恢复原始上限，缺省的内容宽度让短名称保持紧凑，`shrink` 与 `min-w-0` 让长名称在窄屏按需缩短，现有内部 `truncate` 负责文本省略。

- [ ] **Step 4: 运行页头测试确认 GREEN**

Run:

```bash
cd frontend
/root/.local/share/pnpm/nodejs/22.23.1/bin/node --test test/task-detail-mobile-header-layout.test.mjs
```

Expected: 页头测试 9/9 通过。

- [ ] **Step 5: 运行组合聚焦测试和目标静态检查**

Run:

```bash
cd frontend
/root/.local/share/pnpm/nodejs/22.23.1/bin/node --test test/task-detail-mobile-header-layout.test.mjs test/task-user-input-index-mobile-layout.test.mjs
/root/.local/share/pnpm/nodejs/22.23.1/bin/node node_modules/eslint/bin/eslint.js src/pages/console/user/task/task-detail.tsx test/task-detail-mobile-header-layout.test.mjs
git diff --check -- src/pages/console/user/task/task-detail.tsx test/task-detail-mobile-header-layout.test.mjs
```

Expected: 组合聚焦测试 18/18 通过，ESLint 和差异检查均退出 0。

- [ ] **Step 6: 运行完整回归和 online 构建**

Run:

```bash
cd frontend
/root/.local/share/pnpm/nodejs/22.23.1/bin/node node_modules/eslint/bin/eslint.js .
/root/.local/share/pnpm/nodejs/22.23.1/bin/node node_modules/typescript/bin/tsc -b
/root/.local/share/pnpm/nodejs/22.23.1/bin/node --test
/root/.local/share/pnpm/nodejs/22.23.1/bin/node node_modules/vite/bin/vite.js build --mode online
```

Expected: ESLint、TypeScript 和 online build 退出 0；完整测试保持 304 项中 296 通过、8 项既有失败，失败集合保持一致。

- [ ] **Step 7: 执行 online 健康检查和登录态人工验收**

Run:

```bash
cd frontend
PREVIEW_URL=https://4215-e84020e6e952be3c.monkeycode-ai.online /root/.local/share/pnpm/nodejs/22.23.1/bin/node scripts/check-online-preview.mjs
```

Expected: 输出 `Online preview captcha health check passed.`。

在 320px、375px、390px、430px 和 1280px 下确认：

```text
短模型名称按钮保持接近文本内容的紧凑宽度。
长模型名称按钮最大为 220px，窄屏空间不足时文本省略。
模型按钮高度保持 28px，页头保持单行且无页面级横向滚动。
104px 工具菜单左边线与模型按钮右边线精确重合。
上下文入口、三点工具、消息定位、跳转消息和回到底部正常。
```

- [ ] **Step 8: 请求授权后提交实现**

获得用户对本任务的单独明确授权后运行：

```bash
git add frontend/src/pages/console/user/task/task-detail.tsx frontend/test/task-detail-mobile-header-layout.test.mjs
git diff --cached --check
git commit -m "修复：恢复手机模型按钮原始宽度"
```

Expected: 提交仅包含上述两个文件。
