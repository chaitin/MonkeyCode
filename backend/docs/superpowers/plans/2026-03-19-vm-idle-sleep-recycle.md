# VM 空闲休眠与回收 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有 TTL 过期机制替换为基于空闲检测的自动休眠（10 分钟）和回收（7 天）策略。

**Architecture:** taskflow 监控 TaskStream 活动并通过 EventReport HTTP 回调上报 MonkeyCode；MonkeyCode 使用三个 Redis DelayQueue（sleep/notify/recycle）管理空闲计时器，用户活跃时刷新所有队列的 score。

**Tech Stack:** Go, Redis DelayQueue (ZSet), gRPC, HTTP callbacks

**Spec:** `docs/superpowers/specs/2026-03-19-vm-idle-sleep-recycle-design.md`

---

## 文件结构

### MonkeyCode (`/Users/yoko/chaitin/ai/MonkeyCode/backend`)

| 操作 | 文件 | 职责 |
|------|------|------|
| 创建 | `pkg/delayqueue/vmidlequeue.go` | 三个空闲队列的工厂函数 |
| 修改 | `domain/host.go:60-66` | 新增 VmIdleInfo，更新 HostUsecase 接口 |
| 修改 | `biz/host/usecase/host.go` | 移除旧 TTL 逻辑，新增 RefreshIdleTimers 和三个消费者 |
| 修改 | `biz/host/handler/v1/host.go` | VM handler 中调用 RefreshIdleTimers |
| 修改 | `biz/host/handler/v1/internal.go` | 新增 VMActivity 回调端点 |
| 修改 | `biz/host/register.go` | 更新路由注册 |
| 修改 | `pkg/taskflow/types.go:47-69` | 新增 sleeping 状态 |

### taskflow (`/Users/yoko/chaitin/ai/taskflow`)

| 操作 | 文件 | 职责 |
|------|------|------|
| 修改 | `types/task.go` | 新增 VMActivity 结构体 |
| 修改 | `internal/connector/eventreport.go` | 新增 ReportVMActivity 方法 |
| 修改 | `internal/agent/handler/grpc/task.go` | TaskStream 消息时上报活跃 |

---

## Task 1: 定义数据结构与接口（MonkeyCode）

**Files:**
- Modify: `domain/host.go`
- Modify: `pkg/taskflow/types.go`

- [ ] **Step 1: 新增 VmIdleInfo 结构体**

在 `domain/host.go` 中，在 `VmExpireInfo` 定义附近新增：

```go
// VmIdleInfo 空闲队列 payload
type VmIdleInfo struct {
	UID    uuid.UUID `json:"uid"`
	VmID   string    `json:"vm_id"`
	HostID string    `json:"host_id"`
	EnvID  string    `json:"env_id"`
}
```

> 注意：通知所需的任务信息（TaskID、Name）不在 payload 中携带，由 notify 消费者触发时从 DB 查询 `vm.Edges.Tasks` 获取，避免 payload 过期导致信息不一致。

- [ ] **Step 2: 新增 sleeping 状态常量**

在 `pkg/taskflow/types.go` 的状态常量区域新增：

```go
const VirtualMachineStatusSleeping VirtualMachineStatus = "sleeping"
```

- [ ] **Step 3: 更新 HostUsecase 接口**

在 `domain/host.go` 的 `HostUsecase` 接口中：
- 新增 `RefreshIdleTimers(ctx context.Context, vmID string, payload *VmIdleInfo) error`
- 注意：`FireExpiredVM` 和 `EnqueueAllCountDownVM` 的删除推迟到 Task 9，避免中间编译错误

- [ ] **Step 4: Commit**

```bash
git add domain/host.go pkg/taskflow/types.go
git commit -m "feat(idle): define VmIdleInfo struct and sleeping status"
```

---

## Task 2: 创建空闲队列基础设施（MonkeyCode）

**Files:**
- Create: `pkg/delayqueue/vmidlequeue.go`

- [ ] **Step 1: 创建 vmidlequeue.go**

参考现有 `vmexpirequeue.go` 的模式，创建三个队列的工厂函数：

```go
package delayqueue

import (
	"log/slog"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/chaitin/MonkeyCode/backend/domain"
)

// VMSleepQueue 10 分钟空闲休眠队列
type VMSleepQueue struct {
	*RedisDelayQueue[*domain.VmIdleInfo]
}

// VMNotifyQueue 回收预警通知队列
type VMNotifyQueue struct {
	*RedisDelayQueue[*domain.VmIdleInfo]
}

// VMRecycleQueue 7 天空闲回收队列
type VMRecycleQueue struct {
	*RedisDelayQueue[*domain.VmIdleInfo]
}

func NewVMSleepQueue(rdb *redis.Client, logger *slog.Logger) *VMSleepQueue {
	return &VMSleepQueue{NewRedisDelayQueue[*domain.VmIdleInfo](rdb, logger,
		WithPrefix[*domain.VmIdleInfo]("mcai:vmsleep"),
		WithPollInterval[*domain.VmIdleInfo](5*time.Second),
		WithRequeueDelay[*domain.VmIdleInfo](1*time.Minute),
	)}
}

func NewVMNotifyQueue(rdb *redis.Client, logger *slog.Logger) *VMNotifyQueue {
	return &VMNotifyQueue{NewRedisDelayQueue[*domain.VmIdleInfo](rdb, logger,
		WithPrefix[*domain.VmIdleInfo]("mcai:vmnotify"),
		WithPollInterval[*domain.VmIdleInfo](30*time.Second),
		WithRequeueDelay[*domain.VmIdleInfo](1*time.Minute),
		WithJobTTL[*domain.VmIdleInfo](8*24*time.Hour),
	)}
}

func NewVMRecycleQueue(rdb *redis.Client, logger *slog.Logger) *VMRecycleQueue {
	return &VMRecycleQueue{NewRedisDelayQueue[*domain.VmIdleInfo](rdb, logger,
		WithPrefix[*domain.VmIdleInfo]("mcai:vmrecycle"),
		WithPollInterval[*domain.VmIdleInfo](30*time.Second),
		WithRequeueDelay[*domain.VmIdleInfo](1*time.Minute),
		WithJobTTL[*domain.VmIdleInfo](8*24*time.Hour),
	)}
}
```

> 注意：必须使用命名包装结构体（而非类型别名 `=`），否则 samber/do 会因为三个队列的底层类型相同而产生 DI 注册冲突。

- [ ] **Step 2: Commit**

```bash
git add pkg/delayqueue/vmidlequeue.go
git commit -m "feat(idle): add idle queue factory functions"
```

---

## Task 3: 实现 RefreshIdleTimers 和三个消费者（MonkeyCode）

**Files:**
- Modify: `biz/host/usecase/host.go`

- [ ] **Step 1: 替换 HostUsecase 字段**

在 `HostUsecase` 结构体中：
- 删除 `vmexpireQueue *delayqueue.VMExpireQueue` (line 39)
- 新增三个队列字段：

```go
vmSleepQueue   *delayqueue.VMSleepQueue
vmNotifyQueue  *delayqueue.VMNotifyQueue
vmRecycleQueue *delayqueue.VMRecycleQueue
```

- [ ] **Step 2: 更新 NewHostUsecase 构造函数**

替换 `vmexpireQueue` 的注入为三个新队列，替换 goroutine 启动：

```go
func NewHostUsecase(i *do.Injector) (domain.HostUsecase, error) {
	h := &HostUsecase{
		cfg:            do.MustInvoke[*config.Config](i),
		redis:          do.MustInvoke[*redis.Client](i),
		taskflow:       do.MustInvoke[taskflow.Clienter](i),
		logger:         do.MustInvoke[*slog.Logger](i).With("module", "HostUsecase"),
		repo:           do.MustInvoke[domain.HostRepo](i),
		userRepo:       do.MustInvoke[domain.UserRepo](i),
		vmSleepQueue:   do.MustInvoke[*delayqueue.VMSleepQueue](i),
		vmNotifyQueue:  do.MustInvoke[*delayqueue.VMNotifyQueue](i),
		vmRecycleQueue: do.MustInvoke[*delayqueue.VMRecycleQueue](i),
	}

	if pc, err := do.Invoke[domain.PrivilegeChecker](i); err == nil {
		h.privilegeChecker = pc
	}

	go h.vmSleepConsumer()
	go h.vmNotifyConsumer()
	go h.vmRecycleConsumer()
	return h, nil
}
```

- [ ] **Step 3: 实现 RefreshIdleTimers（含去抖）**

```go
const (
	VM_SLEEP_QUEUE_KEY   = "vm:idle:sleep"
	VM_NOTIFY_QUEUE_KEY  = "vm:idle:notify"
	VM_RECYCLE_QUEUE_KEY = "vm:idle:recycle"
)

func (h *HostUsecase) RefreshIdleTimers(ctx context.Context, vmID string, payload *domain.VmIdleInfo) error {
	debounceKey := fmt.Sprintf("vm:idle:debounce:%s", vmID)
	if ok, _ := h.redis.SetNX(ctx, debounceKey, "1", 30*time.Second).Result(); !ok {
		return nil
	}

	now := time.Now()
	if _, err := h.vmSleepQueue.Enqueue(ctx, VM_SLEEP_QUEUE_KEY, payload, now.Add(10*time.Minute), vmID); err != nil {
		h.logger.ErrorContext(ctx, "failed to enqueue sleep", "error", err, "vmID", vmID)
	}
	if _, err := h.vmNotifyQueue.Enqueue(ctx, VM_NOTIFY_QUEUE_KEY, payload, now.Add(7*24*time.Hour-1*time.Hour), vmID); err != nil {
		h.logger.ErrorContext(ctx, "failed to enqueue notify", "error", err, "vmID", vmID)
	}
	if _, err := h.vmRecycleQueue.Enqueue(ctx, VM_RECYCLE_QUEUE_KEY, payload, now.Add(7*24*time.Hour), vmID); err != nil {
		h.logger.ErrorContext(ctx, "failed to enqueue recycle", "error", err, "vmID", vmID)
	}
	return nil
}
```

- [ ] **Step 4: 实现 vmSleepConsumer**

```go
func (h *HostUsecase) vmSleepConsumer() {
	logger := h.logger.With("fn", "vmSleepConsumer")
	for {
		err := h.vmSleepQueue.StartConsumer(context.Background(), VM_SLEEP_QUEUE_KEY,
			func(ctx context.Context, job *delayqueue.Job[*domain.VmIdleInfo]) error {
				logger.InfoContext(ctx, "vm idle sleep triggered", "vmID", job.Payload.VmID)
				// Phase 1: 仅标记状态为 sleeping
				// Phase 2: 调用 agent gRPC 休眠接口
				if err := h.repo.UpdateVirtualMachine(ctx, job.Payload.VmID, func(vmuo *db.VirtualMachineUpdateOne) error {
					vmuo.SetStatus(string(taskflow.VirtualMachineStatusSleeping))
					return nil
				}); err != nil {
					logger.ErrorContext(ctx, "failed to mark vm sleeping", "error", err)
					return err
				}
				return nil
			})
		logger.Warn("sleep consumer error, retrying...", "error", err)
		time.Sleep(10 * time.Second)
	}
}
```

- [ ] **Step 5: 实现 vmNotifyConsumer**

```go
func (h *HostUsecase) vmNotifyConsumer() {
	logger := h.logger.With("fn", "vmNotifyConsumer")
	for {
		err := h.vmNotifyQueue.StartConsumer(context.Background(), VM_NOTIFY_QUEUE_KEY,
			func(ctx context.Context, job *delayqueue.Job[*domain.VmIdleInfo]) error {
				logger.InfoContext(ctx, "vm recycle notify triggered", "vmID", job.Payload.VmID)
				// 通过 Notify 模块发送回收预警（任务维度）
				// TODO: 对接现有 Notify 模块
				return nil
			})
		logger.Warn("notify consumer error, retrying...", "error", err)
		time.Sleep(10 * time.Second)
	}
}
```

- [ ] **Step 6: 实现 vmRecycleConsumer**

```go
func (h *HostUsecase) vmRecycleConsumer() {
	logger := h.logger.With("fn", "vmRecycleConsumer")
	for {
		err := h.vmRecycleQueue.StartConsumer(context.Background(), VM_RECYCLE_QUEUE_KEY,
			func(ctx context.Context, job *delayqueue.Job[*domain.VmIdleInfo]) error {
				innerLogger := logger.With("job", job)
				innerLogger.InfoContext(ctx, "vm recycle triggered")

				ctx = entx.SkipSoftDelete(ctx)
				vm, err := h.repo.GetVirtualMachine(ctx, job.Payload.VmID)
				if err != nil {
					innerLogger.ErrorContext(ctx, "failed to get vm", "error", err)
					return nil
				}

				if err := h.taskflow.VirtualMachiner().Delete(ctx, &taskflow.DeleteVirtualMachineReq{
					UserID: vm.UserID.String(),
					HostID: vm.HostID,
					ID:     vm.EnvironmentID,
				}); err != nil {
					innerLogger.ErrorContext(ctx, "failed to delete vm", "error", err)
				}

				if err := h.repo.UpdateVirtualMachine(ctx, vm.ID, func(vmuo *db.VirtualMachineUpdateOne) error {
					vmuo.SetIsRecycled(true)
					return nil
				}); err != nil {
					innerLogger.ErrorContext(ctx, "failed to update vm", "error", err)
					return err
				}
				return nil
			})
		logger.Warn("recycle consumer error, retrying...", "error", err)
		time.Sleep(10 * time.Second)
	}
}
```

- [ ] **Step 7: Commit**

```bash
git add biz/host/usecase/host.go
git commit -m "feat(idle): implement RefreshIdleTimers and idle consumers"
```

---

## Task 4: taskflow 侧 VMActivity 上报（taskflow）

**Files:**
- Modify: `types/task.go`
- Modify: `internal/connector/eventreport.go`

- [ ] **Step 1: 新增 VMActivity 结构体**

在 `types/task.go` 中新增：

```go
type VMActivity struct {
	VMID         string `json:"vm_id"`
	LastActiveAt int64  `json:"last_active_at"` // Unix timestamp
}
```

- [ ] **Step 2: EventReport 新增 ReportVMActivity 方法**

在 `internal/connector/eventreport.go` 中，参考现有 `ReportHostInfo` 模式新增（使用硬编码路径，与其他方法一致）：

```go
func (e *EventReport) ReportVMActivity(activity *types.VMActivity) error {
	_, err := request.Post[any](e.client, context.Background(), "/internal/vm/activity", activity)
	return err
}
```

无需新增 config 字段。

- [ ] **Step 3: Commit**

```bash
git add types/task.go internal/connector/eventreport.go
git commit -m "feat(idle): add VMActivity reporting in taskflow"
```

---

## Task 5: TaskStream 活动监控（taskflow）

**Files:**
- Modify: `internal/agent/handler/grpc/task.go`

- [ ] **Step 1: 在 TaskStream recv 回调中上报活跃**

在 `task.go` 的 `Task()` 方法中，recv 回调处理消息后调用 EventReport：

```go
// 在 recv handler 中，每次收到消息时上报
go func() {
	if err := t.connector.EventReport.ReportVMActivity(&types.VMActivity{
		VMID:         token.Token,
		LastActiveAt: time.Now().Unix(),
	}); err != nil {
		logger.Warn("failed to report vm activity", "error", err)
	}
}()
```

- [ ] **Step 2: 在 send 回调中也上报活跃**

在 send handler 中同样添加上报逻辑（任务输出也算活跃）。

- [ ] **Step 3: Commit**

```bash
git add internal/agent/handler/grpc/task.go
git commit -m "feat(idle): report VM activity on TaskStream messages"
```

---

## Task 6: MonkeyCode 接收 VMActivity 回调

**Files:**
- Modify: `biz/host/handler/v1/internal.go`

- [ ] **Step 1: InternalHostHandler 新增 hostUsecase 字段**

在 `InternalHostHandler` 结构体中新增：

```go
type InternalHostHandler struct {
	// ... 现有字段
	hostUsecase   domain.HostUsecase
}
```

在 `NewInternalHostHandler` 中注入：

```go
hostUsecase: do.MustInvoke[domain.HostUsecase](i),
```

- [ ] **Step 2: 新增 VMActivity handler（使用 web.BindHandler 模式）**

定义请求结构体和 handler，与现有 `ReportHostInfo` 等方法风格一致：

```go
type VMActivityReq struct {
	VMID         string `json:"vm_id"`
	LastActiveAt int64  `json:"last_active_at"`
}

func (h *InternalHostHandler) VMActivity(c *web.Context, req VMActivityReq) error {
	vm, err := h.repo.GetVirtualMachine(c.Request().Context(), req.VMID)
	if err != nil {
		h.logger.ErrorContext(c.Request().Context(), "vm activity: vm not found", "vmID", req.VMID, "error", err)
		return err
	}

	payload := &domain.VmIdleInfo{
		UID:    vm.UserID,
		VmID:   vm.ID,
		HostID: vm.HostID,
		EnvID:  vm.EnvironmentID,
	}
	return h.hostUsecase.RefreshIdleTimers(c.Request().Context(), req.VMID, payload)
}
```

- [ ] **Step 3: 注册路由（在 NewInternalHostHandler 内部）**

在 `NewInternalHostHandler` 的路由注册区域（line 55-64）新增：

```go
g.POST("/vm/activity", web.BindHandler(h.VMActivity))
```

- [ ] **Step 4: Commit**

```bash
git add biz/host/handler/v1/internal.go
git commit -m "feat(idle): add VMActivity callback endpoint"
```

---

## Task 7: VM Handler 中调用 RefreshIdleTimers（MonkeyCode）

**Files:**
- Modify: `biz/host/handler/v1/host.go`

- [ ] **Step 1: 在终端连接时刷新**

在 `ConnectVMTerminal` handler 中，连接成功后调用 RefreshIdleTimers。

- [ ] **Step 2: 在其他 VM 操作时刷新**

在以下 handler 中添加 RefreshIdleTimers 调用：
- `TerminalList` - 查看终端列表
- `ApplyPort` - 申请端口
- `GetPorts` - 获取端口列表

- [ ] **Step 3: 休眠唤醒逻辑**

在 `ConnectVMTerminal` 和 `VMInfo` 中检查 VM 状态，如果是 sleeping 则标记为 online 并刷新：

```go
// 检查 VM 状态，如果是 sleeping 则唤醒
if vm.Status == string(taskflow.VirtualMachineStatusSleeping) {
	_ = h.repo.UpdateVirtualMachine(ctx, vm.ID, func(vmuo *db.VirtualMachineUpdateOne) error {
		vmuo.SetStatus(string(taskflow.VirtualMachineStatusOnline))
		return nil
	})
}
h.hostUsecase.RefreshIdleTimers(ctx, vm.ID, payload)
```

- [ ] **Step 4: Commit**

```bash
git add biz/host/handler/v1/host.go
git commit -m "feat(idle): refresh idle timers on VM interactions"
```

---

## Task 8: CreateVM/DeleteVM 对接空闲队列（MonkeyCode）

**Files:**
- Modify: `biz/host/usecase/host.go`

- [ ] **Step 1: CreateVM 中入队空闲队列**

在 `CreateVM()` 方法中，VM 创建成功后替换原有 vmexpireQueue 入队逻辑：

```go
// 替换原有 TTL 入队逻辑
h.RefreshIdleTimers(ctx, tfvm.ID, &domain.VmIdleInfo{
	UID:    user.ID,
	VmID:   tfvm.ID,
	HostID: req.HostID,
	EnvID:  tfvm.EnvironmentID,
})
```

同时移除 `req.Life` 相关的 TTL 逻辑和 `TTLCountDown`/`TTLForever` 判断。创建时统一传 `TTLForever` 给 taskflow。

- [ ] **Step 2: DeleteVM 中清理三个队列**

在 `DeleteVM()` 方法中，替换 `vmexpireQueue.Remove` 为：

```go
_ = h.vmSleepQueue.Remove(ctx, VM_SLEEP_QUEUE_KEY, vm.ID)
_ = h.vmNotifyQueue.Remove(ctx, VM_NOTIFY_QUEUE_KEY, vm.ID)
_ = h.vmRecycleQueue.Remove(ctx, VM_RECYCLE_QUEUE_KEY, vm.ID)
```

- [ ] **Step 3: Commit**

```bash
git add biz/host/usecase/host.go
git commit -m "feat(idle): wire idle queues into CreateVM/DeleteVM"
```

---

## Task 9: 移除旧 TTL 机制（MonkeyCode）

**Files:**
- Modify: `biz/host/usecase/host.go`
- Modify: `biz/host/handler/v1/host.go`
- Modify: `domain/host.go`

- [ ] **Step 1: 删除旧方法**

从 `biz/host/usecase/host.go` 中删除：
- `periodicEnqueueVm()` (lines 64-88)
- `vmexpireConsumer()` (lines 90-128)
- `FireExpiredVM()` (lines 544-591)
- `EnqueueAllCountDownVM()` (lines 593-620)

- [ ] **Step 2: 清理 UpdateVM 中的 TTL 逻辑**

从 `UpdateVM()` 中移除 vmexpireQueue 相关代码。

- [ ] **Step 3: 删除 HTTP 端点**

从 `biz/host/handler/v1/host.go` 中移除 `/internal/vm/fire` 端点（line 45）及其 handler `fireExpiredVM`。

- [ ] **Step 4: 清理 domain 接口**

从 `domain/host.go` 中移除：
- `FireExpiredVM(ctx context.Context, fire bool) ([]FireExpiredVMItem, error)` 接口方法
- `EnqueueAllCountDownVM(ctx context.Context) ([]string, error)` 接口方法
- `FireExpiredVMItem` 类型定义

> 注意：接口删除推迟到此 Task 是为了避免 Task 1 到 Task 9 之间的编译错误。

- [ ] **Step 5: Commit**

```bash
git add biz/host/usecase/host.go biz/host/handler/v1/host.go domain/host.go
git commit -m "refactor(idle): remove legacy TTL expiration mechanism"
```

---

## Task 10: DI 注册更新（MonkeyCode）

**Files:**
- Modify: `pkg/register.go:101-106`

- [ ] **Step 1: 替换 VMExpireQueue 注册为三个新队列**

在 `pkg/register.go` 中，将 lines 101-106 的 VMExpireQueue 注册替换为：

```go
// VM Idle Sleep Queue
do.Provide(i, func(i *do.Injector) (*delayqueue.VMSleepQueue, error) {
	r := do.MustInvoke[*redis.Client](i)
	l := do.MustInvoke[*slog.Logger](i)
	return delayqueue.NewVMSleepQueue(r, l), nil
})

// VM Idle Notify Queue
do.Provide(i, func(i *do.Injector) (*delayqueue.VMNotifyQueue, error) {
	r := do.MustInvoke[*redis.Client](i)
	l := do.MustInvoke[*slog.Logger](i)
	return delayqueue.NewVMNotifyQueue(r, l), nil
})

// VM Idle Recycle Queue
do.Provide(i, func(i *do.Injector) (*delayqueue.VMRecycleQueue, error) {
	r := do.MustInvoke[*redis.Client](i)
	l := do.MustInvoke[*slog.Logger](i)
	return delayqueue.NewVMRecycleQueue(r, l), nil
})
```

- [ ] **Step 2: Commit**

```bash
git add pkg/register.go
git commit -m "feat(idle): update DI registration for idle queues"
```
