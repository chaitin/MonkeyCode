# Task 并发限制 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 限制每个用户同时只能运行一个任务（pending 或 processing 状态），通过 ent hook 在 Task Create mutation 前拦截。

**Architecture:** 在 `pkg/entx/task_hook.go` 中实现 `TaskConcurrencyHook`，使用 PostgreSQL advisory lock 防止并发竞态，在 `pkg/store/entdb.go` 的 `NewEntDBV2` 中注册 hook。同时新增错误码和 i18n 条目，修正 ent schema 中 `user_id` 的错误 UNIQUE 标记。

**Tech Stack:** Go, ent ORM, PostgreSQL advisory lock

**Spec:** `docs/superpowers/specs/2026-03-26-task-concurrency-limit-design.md`

---

### Task 1: 新增错误码和 i18n 条目

**Files:**
- Modify: `errcode/errcode.go:104` (在 `ErrTaskCannotDelete` 后新增)
- Modify: `errcode/locale.en.toml:175` (在 `[err-task-cannot-delete]` 条目后新增)
- Modify: `errcode/locale.zh.toml:182` (在 `[err-task-cannot-delete]` 条目后新增)

- [ ] **Step 1: 在 `errcode/errcode.go` 中新增错误码**

在 `ErrTaskCannotDelete` 下方添加：

```go
	ErrTaskConcurrencyLimit = web.NewErr(http.StatusOK, 10811, "err-task-concurrency-limit")
```

- [ ] **Step 2: 在 `errcode/locale.en.toml` 中新增英文提示**

在 `[err-task-cannot-delete]` 条目后添加：

```toml
[err-task-concurrency-limit]
other = "You already have a running task, please wait for it to finish before creating a new one"
```

- [ ] **Step 3: 在 `errcode/locale.zh.toml` 中新增中文提示**

在 `[err-task-cannot-delete]` 条目后添加：

```toml
[err-task-concurrency-limit]
other = "你已有一个正在运行的任务，请等待完成后再创建新任务"
```

- [ ] **Step 4: 验证编译**

Run: `cd /Users/yoko/chaitin/ai/MonkeyCode/backend && go build ./errcode/...`
Expected: 编译成功，无错误

- [ ] **Step 5: Commit**

```bash
git add errcode/errcode.go errcode/locale.en.toml errcode/locale.zh.toml
git commit -m "feat(task): add ErrTaskConcurrencyLimit error code (10811)"
```

---

### Task 2: 实现 TaskConcurrencyHook

**Files:**
- Create: `pkg/entx/task_hook.go`

- [ ] **Step 1: 创建 `pkg/entx/task_hook.go`**

```go
package entx

import (
	"context"
	"fmt"

	"entgo.io/ent"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/hook"
	"github.com/chaitin/MonkeyCode/backend/db/task"
	"github.com/chaitin/MonkeyCode/backend/errcode"
)

// TaskConcurrencyHook prevents a user from creating more than one active task
// (pending or processing). Uses pg_advisory_xact_lock to serialize concurrent
// create requests for the same user within a transaction.
func TaskConcurrencyHook(next ent.Mutator) ent.Mutator {
	return hook.TaskFunc(func(ctx context.Context, m *db.TaskMutation) (db.Value, error) {
		if !m.Op().Is(db.OpCreate) {
			return next.Mutate(ctx, m)
		}
		userID, ok := m.UserID()
		if !ok {
			return next.Mutate(ctx, m)
		}
		// Advisory lock serializes concurrent creates for the same user.
		_, err := m.Client().ExecContext(ctx,
			"SELECT pg_advisory_xact_lock(hashtext($1))", userID.String())
		if err != nil {
			return nil, fmt.Errorf("acquire task concurrency lock: %w", err)
		}
		count, err := m.Client().Task.Query().
			Where(
				task.UserIDEQ(userID),
				task.StatusIn(consts.TaskStatusPending, consts.TaskStatusProcessing),
			).
			Count(ctx)
		if err != nil {
			return nil, fmt.Errorf("check task concurrency: %w", err)
		}
		if count > 0 {
			return nil, errcode.ErrTaskConcurrencyLimit
		}
		return next.Mutate(ctx, m)
	})
}
```

- [ ] **Step 2: 验证编译**

Run: `cd /Users/yoko/chaitin/ai/MonkeyCode/backend && go build ./pkg/entx/...`
Expected: 编译成功，无错误

- [ ] **Step 3: Commit**

```bash
git add pkg/entx/task_hook.go
git commit -m "feat(task): implement TaskConcurrencyHook with advisory lock"
```

---

### Task 3: 注册 Hook 到 ent client

**Files:**
- Modify: `pkg/store/entdb.go:41-46` (在 `db.NewClient(...)` 之后、return 之前注册 hook)

- [ ] **Step 1: 在 `pkg/store/entdb.go` 的 `NewEntDBV2` 中注册 hook**

在第 41 行 `c := db.NewClient(...)` 之后、第 42 行 `if cfg.Debug` 之前插入：

```go
	c.Task.Use(entx.TaskConcurrencyHook)
```

同时在 import 中添加：

```go
	"github.com/chaitin/MonkeyCode/backend/pkg/entx"
```

- [ ] **Step 2: 验证编译**

Run: `cd /Users/yoko/chaitin/ai/MonkeyCode/backend && go build ./pkg/store/...`
Expected: 编译成功，无错误

- [ ] **Step 3: Commit**

```bash
git add pkg/store/entdb.go
git commit -m "feat(task): register TaskConcurrencyHook on ent client"
```

---

### Task 4: 修正 ent schema 中 user_id 的错误 UNIQUE 标记

**Files:**
- Modify: `ent/schema/task.go:39`

- [ ] **Step 1: 移除 `user_id` 字段定义上的 `.Unique()`**

将第 39 行：

```go
		field.UUID("user_id", uuid.UUID{}).Unique(),
```

改为：

```go
		field.UUID("user_id", uuid.UUID{}),
```

注意：第 55 行 edge 定义中的 `.Unique()` 必须保留（表示 M2O 关系基数）。

- [ ] **Step 2: 验证编译**

Run: `cd /Users/yoko/chaitin/ai/MonkeyCode/backend && go build ./ent/...`
Expected: 编译成功，无错误

- [ ] **Step 3: Commit**

```bash
git add ent/schema/task.go
git commit -m "fix(schema): remove incorrect Unique() on task.user_id field"
```

---

### Task 5: 全量编译验证

- [ ] **Step 1: 全量编译**

Run: `cd /Users/yoko/chaitin/ai/MonkeyCode/backend && go build ./...`
Expected: 编译成功，无错误

- [ ] **Step 2: 如果有编译错误，修复后重新编译并 amend 对应的 commit**
