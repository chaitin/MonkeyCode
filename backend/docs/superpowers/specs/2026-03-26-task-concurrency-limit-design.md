# Task Concurrency Limit Design

## Problem

MonkeyCode 当前没有机制阻止用户同时创建多个任务。ent schema 中 `task.user_id` 的 UNIQUE 约束是定义失误，实际数据库表中并非 unique。需要在业务层实现每个用户同时只能运行一个任务的限制。

## Requirements

- 每个用户同时只能有一个活跃任务（pending 或 processing 状态）
- 当用户已有活跃任务时，拒绝创建新任务并返回明确的错误码
- 不影响已完成（finished）或失败（error）状态的任务

## Design

### Approach: Ent Hook on Task Create

使用 ent hook 在 Task 的 Create mutation 前拦截，检查用户是否有活跃任务。

选择 ent hook 而非其他方案的原因：
- 比 ent policy 更轻量，不需要 `go generate` 重新生成代码
- 项目已有 ent hook 使用先例（SoftDeleteMixin2）
- 在 mutation 层面拦截，所有创建 Task 的代码路径都会经过
- hook 在事务内执行（repo.Create 已在事务中），配合 PostgreSQL advisory lock 保证并发安全

### Components

#### 1. Error Code

在 `errcode/errcode.go` 中新增：

```go
ErrTaskConcurrencyLimit = web.NewErr(http.StatusOK, 10811, "err-task-concurrency-limit")
```

错误码 10811，紧跟现有的 10810（ErrTaskCannotDelete）。

#### 2. Ent Hook

创建 `pkg/entx/task_hook.go`，定义 hook 函数：

```go
func TaskConcurrencyHook(next ent.Mutator) ent.Mutator {
    return hook.TaskFunc(func(ctx context.Context, m *db.TaskMutation) (db.Value, error) {
        if !m.Op().Is(db.OpCreate) {
            return next.Mutate(ctx, m)
        }
        userID, ok := m.UserID()
        if !ok {
            return next.Mutate(ctx, m)
        }
        // Advisory lock 防止并发创建竞态
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

#### 3. Hook Registration

在 ent client 初始化处注册 hook：

```go
client.Task.Use(entx.TaskConcurrencyHook)
```

### Data Flow

```
HTTP POST /api/v1/users/tasks
  → handler.Create()
    → usecase.Create()
      → repo.Create() [开启事务]
        → tx.Task.Create().Save(ctx)
          → [ent hook 触发]
            → 查询 user_id 的 pending/processing 任务数
            → count > 0 → 返回 ErrTaskConcurrencyLimit
            → count == 0 → 继续创建
```

### Edge Cases

- **user_id 未设置**：跳过检查，让后续的数据库约束处理
- **查询失败**：返回 wrapped error，不允许创建（fail-closed）
- **并发请求**：使用 `pg_advisory_xact_lock(hashtext(user_id))` 在事务内对用户加 advisory lock，确保同一用户的并发创建请求串行化，避免 READ COMMITTED 下的竞态

### Ent Schema Cleanup

移除 `ent/schema/task.go` 中 `user_id` 字段定义（第 39 行）的 `.Unique()` 标记，使 schema 与实际数据库一致。注意：edge 定义（第 55 行）中的 `.Unique()` 表示 M2O 关系基数（每个 task 只有一个 user），必须保留。

## Files to Modify

| File | Change |
|------|--------|
| `errcode/errcode.go` | 新增 `ErrTaskConcurrencyLimit` 错误码 |
| `errcode/locale.en.toml` | 新增 `err-task-concurrency-limit` 英文提示 |
| `errcode/locale.zh.toml` | 新增 `err-task-concurrency-limit` 中文提示 |
| `pkg/entx/task_hook.go` | 新建，实现 `TaskConcurrencyHook`（含 advisory lock） |
| `pkg/store/entdb.go` | 在 `NewEntDBV2` 中注册 hook `client.Task.Use(...)` |
| `ent/schema/task.go` | 移除 `user_id` 字段定义的 `.Unique()`（保留 edge 上的） |

## Testing

- 创建任务成功（无活跃任务时）
- 创建任务被拒绝（有 pending 任务时）
- 创建任务被拒绝（有 processing 任务时）
- 旧任务 finished/error 后可以创建新任务
- 并发创建请求只有一个成功
