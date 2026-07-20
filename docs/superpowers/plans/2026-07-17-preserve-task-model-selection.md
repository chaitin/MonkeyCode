# Preserve Task Model Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 保证侧边栏启动任务弹窗在数据刷新后仍提交用户最后选择的模型。

**Architecture:** 使用 `modelTouchedRef` 区分系统默认初始化与用户手动选择，并将模型初始化从主机、镜像默认配置中拆分。用户尚未操作时同步套餐默认模型；用户选择有效时保持该选择；选择失效时清空并要求重新选择。

**Tech Stack:** React 19、TypeScript、Node.js test、ESLint、Vite

## Global Constraints

- 仅修改前端任务创建弹窗及对应测试。
- 后端 API、数据库和任务执行链路保持不变。
- 不增加运行时或测试依赖。

---

### Task 1: 增加模型选择保持回归测试

**Files:**
- Create: `frontend/test/create-default-task-dialog-model-selection.test.mjs`

**Interfaces:**
- Consumes: `CreateDefaultTaskDialog` 源码契约。
- Produces: 用户 touched 标记、可执行选择状态规则、受保护默认初始化和请求字段的回归约束。

- [ ] **Step 1: 编写失败测试**

测试应执行模型选择状态规则并断言：用户选择后数据刷新保留有效模型；已选模型失效时要求重新选择；关闭时清除 touched；请求提交 `selectedModelId`。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/create-default-task-dialog-model-selection.test.mjs`

Expected: FAIL，提示源码缺少 `modelTouchedRef`。

- [ ] **Step 3: 提交失败测试**

```bash
git add frontend/test/create-default-task-dialog-model-selection.test.mjs
git commit -m "增加启动任务模型选择回归测试"
```

### Task 2: 保护用户模型选择

**Files:**
- Modify: `frontend/src/components/console/task/create-default-task-dialog.tsx`
- Test: `frontend/test/create-default-task-dialog-model-selection.test.mjs`

**Interfaces:**
- Consumes: `selectPreferredTaskModel(models, subscription)`。
- Produces: `handleModelChange(modelId: string)` 和受 touched 状态保护的默认模型初始化。

- [ ] **Step 1: 增加 touched 状态和用户选择回调**

新增 `modelTouchedRef`，并让 `ModelSelect` 使用 `handleModelChange` 设置用户选择。

- [ ] **Step 2: 拆分默认初始化**

从 `setDefaultConfig` 移除模型写入，新增 effect：弹窗打开、用户尚未操作且模型列表已就绪时设置推荐模型。

- [ ] **Step 3: 重置生命周期状态**

弹窗关闭时将 `modelTouchedRef.current` 设为 `false` 并清空 `selectedModelId`。

- [ ] **Step 4: 运行专项测试**

Run: `node --test test/create-default-task-dialog-model-selection.test.mjs`

Expected: PASS。

- [ ] **Step 5: 运行质量检查**

Run: `pnpm lint`

Expected: exit code 0。

Run: `pnpm run build:online`

Expected: exit code 0。

- [ ] **Step 6: 提交修复**

```bash
git add frontend/src/components/console/task/create-default-task-dialog.tsx
git commit -m "修复启动任务模型选择被覆盖"
```

### Task 3: 启动人工验收环境

**Files:**
- Verify: `frontend/vite.config.ts`

**Interfaces:**
- Consumes: `pnpm run dev:online`。
- Produces: SaaS 人工验收预览地址。

- [ ] **Step 1: 启动在线模式开发服务器**

Run: `pnpm run dev:online -- --host 0.0.0.0`

Expected: Vite 输出本地监听端口。

- [ ] **Step 2: 验收关键路径**

选择一个非推荐模型，等待超过 30 秒后创建任务，确认界面选择及任务实际模型均保持用户选择。
