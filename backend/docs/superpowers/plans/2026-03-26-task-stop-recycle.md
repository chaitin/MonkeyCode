# 任务停止与 VM 回收实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop/Delete 任务时通过 lifecycle 机制回收 VM 并清理 Redis 数据，失败时降级到 delay queue 重试。

**Architecture:** 新增 `VMStateRecycled` 状态和 `VMRecycleHook`。Stop/Delete 触发 VM lifecycle 转换到 `recycled`，hook 负责删除 VM、清理 delay queue 和 Redis 键、标记 DB。删除 VM 失败时投入 `vmRecycleQueue` 由已有 consumer 重试。

**Tech Stack:** Go, Ent ORM, Redis, samber/do DI

**Spec:** `backend/docs/superpowers/specs/2026-03-26-task-stop-recycle-design.md`

---

## File Map

| 文件 | 操作 | 职责 |
|------|------|------|
| `backend/pkg/lifecycle/types.go` | 修改 | 新增 `VMStateRecycled` 常量，更新 `VMTransitions()` |
| `backend/pkg/lifecycle/vmrecyclehook.go` | 新建 | VM 回收 hook：删除 VM、清理队列/Redis、标记 DB、失败降级 |
| `backend/pkg/register.go` | 修改 | 注册 `VMRecycleHook` 到 VM lifecycle manager |
| `backend/biz/task/usecase/task.go` | 修改 | `Stop()` 新增 VM 回收，`Delete()` 去掉限制并回收 VM |

---

### Task 1: 新增 VMStateRecycled 状态和转换规则

**Files:**
- Modify: `backend/pkg/lifecycle/types.go:40-46` (常量) 和 `backend/pkg/lifecycle/manager.go:180-188` (VMTransitions)

- [ ] **Step 1: 在 `types.go` 新增 `VMStateRecycled` 常量**

在 `VMStateSucceeded` 下方新增：

```go
VMStateRecycled  VMState = "recycled"
```

- [ ] **Step 2: 更新 `manager.go` 中的 `VMTransitions()`**

将整个函数体替换为：

```go
func VMTransitions() map[VMState][]VMState {
	return map[VMState][]VMState{
		"":               {VMStatePending, VMStateCreating, VMStateRecycled},
		VMStatePending:   {VMStateCreating, VMStateFailed, VMStateRecycled},
		VMStateCreating:  {VMStateRunning, VMStateFailed, VMStateRecycled},
		VMStateRunning:   {VMStateSucceeded, VMStateFailed, VMStateRecycled},
		VMStateFailed:    {VMStateRunning, VMStateRecycled},
		VMStateSucceeded: {VMStateRecycled},
	}
}
```

- [ ] **Step 3: 编译验证**

Run: `cd /Users/yoko/chaitin/ai/MonkeyCode/backend && go build ./...`
Expected: 编译通过，无错误

- [ ] **Step 4: Commit**

```bash
git add backend/pkg/lifecycle/types.go backend/pkg/lifecycle/manager.go
git commit -m "feat: add VMStateRecycled and update VM transition rules"
```

---

### Task 2: 实现 VMRecycleHook

**Files:**
- Create: `backend/pkg/lifecycle/vmrecyclehook.go`

**Reference files:**
- `backend/pkg/lifecycle/vmnotifyhook.go` — hook 结构模板
- `backend/pkg/lifecycle/taskhook.go` — 复杂 hook 示例
- `backend/biz/host/usecase/host.go:610-630` — DeleteVM 中的清理逻辑
- `backend/domain/host.go:45-53` — HostRepo 接口（GetVirtualMachine, UpdateVirtualMachine）
- `backend/pkg/delayqueue/vmidlequeue.go` — VMRecycleQueue 类型定义
- `backend/biz/host/usecase/host.go:81-84` — delay queue key 常量

- [ ] **Step 1: 创建 `vmrecyclehook.go`**

```go
package lifecycle

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/delayqueue"
	"github.com/chaitin/MonkeyCode/backend/pkg/entx"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

const (
	vmSleepQueueKey   = "vm:idle:sleep"
	vmNotifyQueueKey  = "vm:idle:notify"
	vmRecycleQueueKey = "vm:idle:recycle"
	vmExpireQueueKey  = "vm:expire"
)

// VMRecycleHook VM 回收 Hook，负责删除 VM、清理队列和 Redis 键、标记 DB
type VMRecycleHook struct {
	taskflow       taskflow.Clienter
	redis          *redis.Client
	hostRepo       domain.HostRepo
	vmSleepQueue   *delayqueue.VMSleepQueue
	vmNotifyQueue  *delayqueue.VMNotifyQueue
	vmRecycleQueue *delayqueue.VMRecycleQueue
	vmExpireQueue  *delayqueue.VMExpireQueue
	logger         *slog.Logger
}

// NewVMRecycleHook 创建 VM 回收 Hook
func NewVMRecycleHook(i *do.Injector) *VMRecycleHook {
	return &VMRecycleHook{
		taskflow:       do.MustInvoke[taskflow.Clienter](i),
		redis:          do.MustInvoke[*redis.Client](i),
		hostRepo:       do.MustInvoke[domain.HostRepo](i),
		vmSleepQueue:   do.MustInvoke[*delayqueue.VMSleepQueue](i),
		vmNotifyQueue:  do.MustInvoke[*delayqueue.VMNotifyQueue](i),
		vmRecycleQueue: do.MustInvoke[*delayqueue.VMRecycleQueue](i),
		vmExpireQueue:  do.MustInvoke[*delayqueue.VMExpireQueue](i),
		logger:         do.MustInvoke[*slog.Logger](i).With("hook", "vm-recycle-hook"),
	}
}

func (h *VMRecycleHook) Name() string  { return "vm-recycle-hook" }
func (h *VMRecycleHook) Priority() int { return 100 }
func (h *VMRecycleHook) Async() bool   { return false }

func (h *VMRecycleHook) OnStateChange(ctx context.Context, vmID string, from, to VMState, metadata VMMetadata) error {
	if to != VMStateRecycled {
		return nil
	}

	logger := h.logger.With("vm_id", vmID, "task_id", metadata.TaskID)
	logger.InfoContext(ctx, "recycling VM")

	// 1. 查询 VM 完整信息
	ctx = entx.SkipSoftDelete(ctx)
	vm, err := h.hostRepo.GetVirtualMachine(ctx, vmID)
	if err != nil {
		logger.ErrorContext(ctx, "failed to get VM info", "error", err)
		return nil // VM 不存在则跳过
	}

	if vm.IsRecycled {
		logger.InfoContext(ctx, "VM already recycled, skipping")
		return nil
	}

	// 2. 删除 VM
	if err := h.taskflow.VirtualMachiner().Delete(ctx, &taskflow.DeleteVirtualMachineReq{
		UserID: metadata.UserID.String(),
		HostID: vm.HostID,
		ID:     vm.EnvironmentID,
	}); err != nil {
		logger.ErrorContext(ctx, "failed to delete VM, falling back to recycle queue", "error", err)
		h.enqueueRetry(ctx, vm, metadata)
		return nil
	}

	// 3-6. 清理操作（失败仅记录日志）
	h.cleanup(ctx, logger, vm, metadata)

	return nil
}

// enqueueRetry 将 VM 投入 vmRecycleQueue 进行重试
func (h *VMRecycleHook) enqueueRetry(ctx context.Context, vm *db.VirtualMachine, metadata VMMetadata) {
	taskID := ""
	if metadata.TaskID != nil {
		taskID = metadata.TaskID.String()
	}
	payload := &domain.VmIdleInfo{
		UID:    metadata.UserID,
		VmID:   vm.ID,
		HostID: vm.HostID,
		EnvID:  vm.EnvironmentID,
		TaskID: taskID,
	}
	if _, err := h.vmRecycleQueue.Enqueue(ctx, vmRecycleQueueKey, payload, time.Now(), vm.ID); err != nil {
		h.logger.ErrorContext(ctx, "failed to enqueue VM for retry", "vm_id", vm.ID, "error", err)
	}
}

// cleanup 清理 delay queue、Redis 键、标记 DB
func (h *VMRecycleHook) cleanup(ctx context.Context, logger *slog.Logger, vm *db.VirtualMachine, metadata VMMetadata) {
	// 3. 清理 delay queue 条目
	_ = h.vmSleepQueue.Remove(ctx, vmSleepQueueKey, vm.ID)
	_ = h.vmNotifyQueue.Remove(ctx, vmNotifyQueueKey, vm.ID)
	_ = h.vmRecycleQueue.Remove(ctx, vmRecycleQueueKey, vm.ID)
	_ = h.vmExpireQueue.Remove(ctx, vmExpireQueueKey, vm.ID)

	// 4. 清理 task 相关 Redis 键
	if metadata.TaskID != nil {
		taskIDStr := metadata.TaskID.String()
		if err := h.redis.Del(ctx,
			fmt.Sprintf("task:create_req:%s", taskIDStr),
			fmt.Sprintf("mcai:task:%s:last_input", taskIDStr),
		).Err(); err != nil {
			logger.WarnContext(ctx, "failed to clean task redis keys", "error", err)
		}
	}

	// 5. DB 标记 is_recycled = true
	if err := h.hostRepo.UpdateVirtualMachine(ctx, vm.ID, func(vmuo *db.VirtualMachineUpdateOne) error {
		vmuo.SetIsRecycled(true)
		return nil
	}); err != nil {
		logger.WarnContext(ctx, "failed to mark VM as recycled", "error", err)
	}

	// 6. 清理 lifecycle Redis 键（最后执行）
	lifecycleKey := fmt.Sprintf("lifecycle:%s", vm.ID)
	if err := h.redis.Del(ctx, lifecycleKey).Err(); err != nil {
		logger.WarnContext(ctx, "failed to clean lifecycle key", "error", err)
	}

	logger.InfoContext(ctx, "VM recycled successfully")
}
```

- [ ] **Step 2: 编译验证**

Run: `cd /Users/yoko/chaitin/ai/MonkeyCode/backend && go build ./...`
Expected: 编译通过

- [ ] **Step 3: Commit**

```bash
git add backend/pkg/lifecycle/vmrecyclehook.go
git commit -m "feat: add VMRecycleHook for VM cleanup on recycled state"
```

---

### Task 3: 注册 VMRecycleHook

**Files:**
- Modify: `backend/pkg/register.go:200-214`

- [ ] **Step 1: 在 VM lifecycle manager 注册 VMRecycleHook**

将 `register.go` 中 VM lifecycle 的 hook 注册部分：

```go
		lc.Register(
			lifecycle.NewVMNotifyHook(i),
		)
```

替换为：

```go
		lc.Register(
			lifecycle.NewVMNotifyHook(i),
			lifecycle.NewVMRecycleHook(i),
		)
```

- [ ] **Step 2: 编译验证**

Run: `cd /Users/yoko/chaitin/ai/MonkeyCode/backend && go build ./...`
Expected: 编译通过

- [ ] **Step 3: Commit**

```bash
git add backend/pkg/register.go
git commit -m "feat: register VMRecycleHook in VM lifecycle manager"
```

---

### Task 4: 改造 Stop 和 Delete

**Files:**
- Modify: `backend/biz/task/usecase/task.go:175-193` (Stop) 和 `backend/biz/task/usecase/task.go:504-532` (Delete)

**Reference files:**
- `backend/pkg/lifecycle/types.go` — VMStateRecycled, VMMetadata

- [ ] **Step 1: 改造 `Stop()` — 新增 VM 回收**

将 `task.go` 中的 `Stop` 方法：

```go
func (a *TaskUsecase) Stop(ctx context.Context, user *domain.User, id uuid.UUID) error {
	t, err := a.repo.Info(ctx, user, id)
	if err != nil {
		return err
	}
	tk := cvt.From(t, &domain.Task{})
	return a.repo.Stop(ctx, user, id, func(t *db.Task) error {
		return a.taskflow.TaskManager().Stop(ctx, taskflow.TaskReq{
			VirtualMachine: &taskflow.VirtualMachine{
				ID:            tk.VirtualMachine.ID,
				HostID:        tk.VirtualMachine.Host.ID,
				EnvironmentID: tk.VirtualMachine.EnvironmentID,
			},
			Task: &taskflow.Task{
				ID: id,
			},
		})
	})
}
```

替换为：

```go
func (a *TaskUsecase) Stop(ctx context.Context, user *domain.User, id uuid.UUID) error {
	t, err := a.repo.Info(ctx, user, id)
	if err != nil {
		return err
	}
	tk := cvt.From(t, &domain.Task{})

	if err := a.repo.Stop(ctx, user, id, func(t *db.Task) error {
		return a.taskflow.TaskManager().Stop(ctx, taskflow.TaskReq{
			VirtualMachine: &taskflow.VirtualMachine{
				ID:            tk.VirtualMachine.ID,
				HostID:        tk.VirtualMachine.Host.ID,
				EnvironmentID: tk.VirtualMachine.EnvironmentID,
			},
			Task: &taskflow.Task{
				ID: id,
			},
		})
	}); err != nil {
		return err
	}

	// 通过 lifecycle 回收 VM
	if vm := tk.VirtualMachine; vm != nil {
		if err := a.vmLifecycle.Transition(ctx, vm.ID, lifecycle.VMStateRecycled, lifecycle.VMMetadata{
			VMID:   vm.ID,
			TaskID: &id,
			UserID: user.ID,
		}); err != nil {
			a.logger.WarnContext(ctx, "vm recycle transition failed", "error", err, "vm_id", vm.ID)
		}
	}

	return nil
}
```

注意：需要在文件顶部 import 中确认已有 `lifecycle` 包的导入（`"github.com/chaitin/MonkeyCode/backend/pkg/lifecycle"`），当前文件已导入。

- [ ] **Step 2: 改造 `Delete()` — 去掉限制并回收 VM**

将 `task.go` 中的 `Delete` 方法：

```go
func (a *TaskUsecase) Delete(ctx context.Context, user *domain.User, id uuid.UUID) error {
	t, err := a.repo.Info(ctx, user, id)
	if err != nil {
		if db.IsNotFound(err) {
			return errcode.ErrNotFound
		}
		return err
	}

	// 运行中不允许删除
	if t.Status == consts.TaskStatusPending || t.Status == consts.TaskStatusProcessing {
		return errcode.ErrTaskCannotDelete
	}

	// VM 在线不允许删除
	if vms := t.Edges.Vms; len(vms) > 0 {
		resp, err := a.taskflow.VirtualMachiner().IsOnline(ctx, &taskflow.IsOnlineReq[string]{
			IDs: []string{vms[0].ID},
		})
		if err != nil {
			return err
		}
		if resp.OnlineMap[vms[0].ID] {
			return errcode.ErrTaskCannotDelete
		}
	}

	return a.repo.Delete(ctx, user, id)
}
```

替换为：

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
			if err := a.vmLifecycle.Transition(ctx, vm.ID, lifecycle.VMStateRecycled, lifecycle.VMMetadata{
				VMID:   vm.ID,
				TaskID: &id,
				UserID: user.ID,
			}); err != nil {
				a.logger.WarnContext(ctx, "vm recycle transition failed on delete", "error", err, "vm_id", vm.ID)
			}
		}
	}

	return a.repo.Delete(ctx, user, id)
}
```

- [ ] **Step 3: 编译验证**

Run: `cd /Users/yoko/chaitin/ai/MonkeyCode/backend && go build ./...`
Expected: 编译通过

- [ ] **Step 4: Commit**

```bash
git add backend/biz/task/usecase/task.go
git commit -m "feat: recycle VM on task stop and delete via lifecycle"
```
