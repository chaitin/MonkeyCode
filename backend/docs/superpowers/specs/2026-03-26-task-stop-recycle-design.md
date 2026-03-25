# 任务停止与 VM 回收设计

## 背景

当前 `Stop` 只停止任务执行并标记 `finished`，不回收 VM 资源。`Delete` 要求 VM 离线才能删除，无法主动回收。需要在停止/删除任务时，通过 lifecycle 机制回收 VM 并清理 Redis 数据。

## 设计

### 1. 新增 VM 状态 `recycled`

`backend/pkg/lifecycle/types.go`:

```go
VMStateRecycled VMState = "recycled"
```

`VMTransitions()` 新增转换规则，所有状态（含初始空状态）均可转到 `recycled`:

```go
"":               {VMStatePending, VMStateCreating, VMStateRecycled},
VMStatePending:   {VMStateCreating, VMStateFailed, VMStateRecycled},
VMStateCreating:  {VMStateRunning, VMStateFailed, VMStateRecycled},
VMStateRunning:   {VMStateSucceeded, VMStateFailed, VMStateRecycled},
VMStateFailed:    {VMStateRunning, VMStateRecycled},
VMStateSucceeded: {VMStateRecycled},
```

### 2. 新增 VMRecycleHook

`backend/pkg/lifecycle/vmrecyclehook.go`:

- 监听 `→ VMStateRecycled` 转换
- 同步执行，优先级 100（高于通知 hook）
- 职责（按顺序执行）：
  1. 从 DB 查询 VM 完整信息（HostID、EnvironmentID 等），用于后续操作和降级入队
  2. 调用 `taskflow.VirtualMachiner().Delete()` 删除 VM
  3. 清理 4 个 delay queue 条目（sleep/notify/recycle/expire）
  4. 清理 task 相关 Redis 键：`task:create_req:{taskID}`、`mcai:task:{taskID}:last_input`
  5. DB 标记 `is_recycled = true`
  6. 清理 lifecycle Redis 键 `lifecycle:{vmID}`（最后执行，确保 is_recycled 已持久化）
- 失败降级：步骤 2 失败时，将 VM 信息（含 HostID、EnvID）投入 `vmRecycleQueue`（runAt=now，payload 为 `*domain.VmIdleInfo`），由已有 `vmRecycleConsumer` 接管重试（最多 5 次，间隔 5s）。步骤 3-6 为清理操作，失败仅记录日志不阻塞。

依赖注入：
- `taskflow.Clienter`
- `*redis.Client`
- `domain.HostRepo`（用于查询 VM 信息和标记 `is_recycled`）
- `*delayqueue.VMRecycleQueue`（降级入队）
- 4 个 delay queue 实例（清理条目）
- `*slog.Logger`

### 3. Stop 改造

`backend/biz/task/usecase/task.go` `Stop()`:

```go
func (a *TaskUsecase) Stop(ctx context.Context, user *domain.User, id uuid.UUID) error {
    t, err := a.repo.Info(ctx, user, id)
    if err != nil {
        return err
    }
    tk := cvt.From(t, &domain.Task{})

    // 1. 停止任务执行 + 更新状态为 finished（保持不变）
    if err := a.repo.Stop(ctx, user, id, func(t *db.Task) error {
        return a.taskflow.TaskManager().Stop(ctx, taskflow.TaskReq{
            VirtualMachine: &taskflow.VirtualMachine{
                ID:            tk.VirtualMachine.ID,
                HostID:        tk.VirtualMachine.Host.ID,
                EnvironmentID: tk.VirtualMachine.EnvironmentID,
            },
            Task: &taskflow.Task{ID: id},
        })
    }); err != nil {
        return err
    }

    // 2. 通过 lifecycle 回收 VM
    if vm := tk.VirtualMachine; vm != nil {
        _ = a.vmLifecycle.Transition(ctx, vm.ID, lifecycle.VMStateRecycled, lifecycle.VMMetadata{
            VMID:   vm.ID,
            TaskID: &id,
            UserID: user.ID,
        })
    }

    return nil
}
```

VM 回收失败不阻塞 Stop 返回（忽略 error），由 hook 内部降级到 delay queue 重试。

### 4. Delete 改造

`backend/biz/task/usecase/task.go` `Delete()`:

```go
func (a *TaskUsecase) Delete(ctx context.Context, user *domain.User, id uuid.UUID) error {
    t, err := a.repo.Info(ctx, user, id)
    if err != nil {
        if db.IsNotFound(err) {
            return errcode.ErrNotFound
        }
        return err
    }

    // 回收 VM（如果有且未回收）
    if vms := t.Edges.Vms; len(vms) > 0 {
        vm := vms[0]
        if !vm.IsRecycled {
            _ = a.vmLifecycle.Transition(ctx, vm.ID, lifecycle.VMStateRecycled, lifecycle.VMMetadata{
                VMID:   vm.ID,
                TaskID: &id,
                UserID: user.ID,
            })
        }
    }

    return a.repo.Delete(ctx, user, id)
}
```

去掉"运行中不允许删除"和"VM 在线不允许删除"的限制。

### 5. 注册 Hook

`backend/pkg/register.go` 中 VM lifecycle manager 注册 `VMRecycleHook`:

```go
lc.Register(
    lifecycle.NewVMNotifyHook(i),
    lifecycle.NewVMRecycleHook(i),
)
```

## 涉及文件

| 文件 | 变更 |
|------|------|
| `backend/pkg/lifecycle/types.go` | 新增 `VMStateRecycled`，更新 `VMTransitions()` |
| `backend/pkg/lifecycle/vmrecyclehook.go` | 新增文件 |
| `backend/biz/task/usecase/task.go` | 改造 `Stop()` 和 `Delete()` |
| `backend/pkg/register.go` | 注册 `VMRecycleHook` |
