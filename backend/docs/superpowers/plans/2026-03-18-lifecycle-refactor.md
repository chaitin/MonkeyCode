# 生命周期重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构任务和虚拟机的生命周期管理，将生命周期与业务逻辑解耦，使用泛型的 LifecycleManager 和 Hook 机制实现可扩展的状态管理。

**Architecture:**
- 创建完全泛型化的 `LifecycleManager[S State, M any]`，支持自定义状态类型和元数据类型
- 任务和 VM 各自拥有独立的 Manager 实例，分别使用 `TaskState/TaskMetadata` 和 `VMState/VMMetadata`
- Hook 机制支持同步/异步执行，按优先级排序

**Tech Stack:** Go 1.21+ 泛型，Redis 作为状态存储，samber/do 依赖注入

---

## 文件结构总览

### 新建文件
```
pkg/lifecycle/
├── manager.go          # 泛型 LifecycleManager 实现
├── types.go            # State 接口、Metadata 定义
├── task_types.go       # TaskState, TaskMetadata
├── vm_types.go         # VMState, VMMetadata
├── task_hooks.go       # Task 相关 Hooks
└── vm_hooks.go         # VM 相关 Hooks
```

### 修改文件
```
pkg/register.go              # 注册新的 LifecycleManager
biz/task/usecase/task.go     # 使用新的 Manager 替代 tasker
biz/task/repo/task.go        # 可能需要调整接口
domain/task.go               # 添加新的状态类型定义
domain/domain.go             # 可能添加新的接口
```

---

## 任务分解

### Task 1: 创建生命周期核心类型定义

**Files:**
- Create: `pkg/lifecycle/types.go`
- Create: `pkg/lifecycle/task_types.go`
- Create: `pkg/lifecycle/vm_types.go`

- [ ] **Step 1: 创建 pkg/lifecycle/types.go 定义 State 接口**

```go
// Package lifecycle 提供泛型化的生命周期管理
package lifecycle

import "context"

// State 状态类型约束（支持 string, int, uint8 等）
type State interface {
    ~string | ~int | ~uint8
}

// Hook 生命周期钩子接口
type Hook[S State, M any] interface {
    // Name 返回 Hook 名称
    Name() string
    // Priority 返回优先级（数字越大优先级越高，先执行）
    Priority() int
    // Async 返回是否异步执行
    Async() bool
    // OnStateChange 状态变更回调
    OnStateChange(ctx context.Context, id string, from, to S, metadata M) error
}
```

- [ ] **Step 2: 创建 pkg/lifecycle/task_types.go**

```go
package lifecycle

// TaskState 任务状态
type TaskState string

const (
    TaskStatePending     TaskState = "pending"
    TaskStateRunning     TaskState = "running"
    TaskStateSucceeded   TaskState = "succeeded"
    TaskStateFailed      TaskState = "failed"
)

// TaskMetadata 任务元数据
type TaskMetadata struct {
    TaskID  string `json:"task_id"`
    UserID  string `json:"user_id"`
    Project string `json:"project,omitempty"`
}
```

- [ ] **Step 3: 创建 pkg/lifecycle/vm_types.go**

```go
package lifecycle

// VMState 虚拟机状态
type VMState string

const (
    VMStatePending    VMState = "pending"
    VMStateCreating   VMState = "creating"
    VMStateRunning    VMState = "running"
    VMStateSucceeded  VMState = "succeeded"
    VMStateFailed     VMState = "failed"
)

// VMMetadata 虚拟机元数据
type VMMetadata struct {
    VMID   string `json:"vm_id"`
    TaskID string `json:"task_id"`
    UserID string `json:"user_id"`
    Region string `json:"region,omitempty"`
}
```

- [ ] **Step 4: 提交**

```bash
git add pkg/lifecycle/types.go pkg/lifecycle/task_types.go pkg/lifecycle/vm_types.go
git commit -m "feat(lifecycle): add type definitions for generic lifecycle manager"
```

---

### Task 2: 实现泛型 LifecycleManager

**Files:**
- Create: `pkg/lifecycle/manager.go`
- Test: `pkg/lifecycle/manager_test.go`

- [ ] **Step 1: 编写 manager 测试用例**

```go
// pkg/lifecycle/manager_test.go
package lifecycle

import (
    "context"
    "testing"
    "github.com/redis/go-redis/v9"
    "github.com/stretchr/testify/assert"
)

func TestManager_Transition(t *testing.T) {
    rdb := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
    defer rdb.Close()

    mgr := NewManager[TaskState, TaskMetadata](rdb)

    ctx := context.Background()
    meta := TaskMetadata{TaskID: "task-1", UserID: "user-1"}

    // Transition: pending -> running
    err := mgr.Transition(ctx, "task-1", TaskStateRunning, meta)
    assert.NoError(t, err)

    state, err := mgr.GetState(ctx, "task-1")
    assert.NoError(t, err)
    assert.Equal(t, TaskStateRunning, state)
}

func TestManager_InvalidTransition(t *testing.T) {
    rdb := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
    defer rdb.Close()

    mgr := NewManager[TaskState, TaskMetadata](rdb)
    ctx := context.Background()
    meta := TaskMetadata{TaskID: "task-1", UserID: "user-1"}

    // Transition: pending -> succeeded (invalid)
    err := mgr.Transition(ctx, "task-1", TaskStateSucceeded, meta)
    assert.Error(t, err)
    assert.Contains(t, err.Error(), "invalid transition")
}

func TestManager_HookExecution(t *testing.T) {
    rdb := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
    defer rdb.Close()

    mgr := NewManager[TaskState, TaskMetadata](rdb)

    var executed bool
    hook := &mockHook[TaskState, TaskMetadata]{
        onStateChange: func(ctx context.Context, id string, from, to TaskState, meta TaskMetadata) error {
            executed = true
            return nil
        },
    }
    mgr.Register(hook)

    ctx := context.Background()
    meta := TaskMetadata{TaskID: "task-1", UserID: "user-1"}
    err := mgr.Transition(ctx, "task-1", TaskStateRunning, meta)
    assert.NoError(t, err)
    assert.True(t, executed)
}

type mockHook[S State, M any] struct {
    onStateChange func(ctx context.Context, id string, from, to S, meta M) error
}

func (h *mockHook[S, M]) Name() string { return "mock-hook" }
func (h *mockHook[S, M]) Priority() int { return 0 }
func (h *mockHook[S, M]) Async() bool { return false }
func (h *mockHook[S, M]) OnStateChange(ctx context.Context, id string, from, to S, meta M) error {
    return h.onStateChange(ctx, id, from, to, meta)
}
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd /Users/yoko/chaitin/ai/MonkeyCode/backend
go test ./pkg/lifecycle/... -v
# Expected: FAIL - package does not exist
```

- [ ] **Step 3: 创建 pkg/lifecycle/manager.go 实现核心逻辑**

```go
package lifecycle

import (
    "context"
    "fmt"
    "log/slog"
    "sort"
    "sync"
    "time"

    "github.com/redis/go-redis/v9"
)

// Manager 泛型生命周期管理器
type Manager[S State, M any] struct {
    redis  *redis.Client
    hooks  []Hook[S, M]
    logger *slog.Logger
    mu     sync.RWMutex
}

// Opt 配置选项
type Opt[S State, M any] func(*Manager[S, M])

// WithLogger 设置日志器
func WithLogger[S State, M any](logger *slog.Logger) Opt[S, M] {
    return func(m *Manager[S, M]) {
        m.logger = logger
    }
}

// NewManager 创建生命周期管理器
func NewManager[S State, M any](redis *redis.Client, opts ...Opt[S, M]) *Manager[S, M] {
    m := &Manager[S, M]{
        redis:  redis,
        hooks:  make([]Hook[S, M], 0),
        logger: slog.Default(),
    }
    for _, opt := range opts {
        opt(m)
    }
    return m
}

// Register 注册 Hook（按优先级排序）
func (m *Manager[S, M]) Register(hooks ...Hook[S, M]) {
    m.mu.Lock()
    defer m.mu.Unlock()
    m.hooks = append(m.hooks, hooks...)
    sort.Slice(m.hooks, func(i, j int) bool {
        return m.hooks[i].Priority() > m.hooks[j].Priority()
    })
}

// Transition 状态转换
func (m *Manager[S, M]) Transition(ctx context.Context, id string, to S, metadata M) error {
    key := m.stateKey(id)

    // 1. 获取当前状态
    fromRaw, _ := m.redis.HGet(ctx, key, "state").Result()
    from := S(fromRaw)
    if from == "" {
        from = m.defaultState()
    }

    // 2. 验证状态转换合法性
    if !m.isValidTransition(from, to) {
        return fmt.Errorf("invalid transition: %s -> %s", from, to)
    }

    // 3. 更新状态
    now := time.Now()
    if err := m.redis.HSet(ctx, key, map[string]any{
        "state":      fmt.Sprintf("%v", to),
        "from_state": fmt.Sprintf("%v", from),
        "updated_at": now.UnixMilli(),
    }).Err(); err != nil {
        return err
    }

    // 4. 触发 Hook 链
    m.mu.RLock()
    hooks := m.hooks
    m.mu.RUnlock()

    for _, hook := range hooks {
        if hook.Async() {
            go m.execHook(ctx, hook, id, from, to, metadata)
        } else {
            if err := m.execHook(ctx, hook, id, from, to, metadata); err != nil {
                m.logger.Error("hook failed", "hook", hook.Name(), "error", err)
                return fmt.Errorf("hook %s failed: %w", hook.Name(), err)
            }
        }
    }

    m.logger.Info("state transitioned", "id", id, "from", from, "to", to)
    return nil
}

// GetState 获取当前状态
func (m *Manager[S, M]) GetState(ctx context.Context, id string) (S, error) {
    state, err := m.redis.HGet(ctx, m.stateKey(id), "state").Result()
    if err != nil {
        var zero S
        return zero, err
    }
    return S(state), nil
}

func (m *Manager[S, M]) execHook(ctx context.Context, hook Hook[S, M], id string, from, to S, metadata M) error {
    defer func() {
        if r := recover(); r != nil {
            m.logger.Error("hook panic", "hook", hook.Name(), "recover", r)
        }
    }()
    return hook.OnStateChange(ctx, id, from, to, metadata)
}

func (m *Manager[S, M]) stateKey(id string) string {
    return fmt.Sprintf("lifecycle:%s", id)
}

func (m *Manager[S, M]) defaultState() S {
    var zero S
    return zero
}

// isValidTransition 验证状态转换合法性
var allowedTransitions = map[string]map[string]bool{
    "":          {"pending": true, "running": true}, // 空状态可转到 pending 或 running
    "pending":   {"running": true, "failed": true},
    "running":   {"succeeded": true, "failed": true},
    "failed":    {"running": true}, // 失败后可重试
    "succeeded": {},
}

func (m *Manager[S, M]) isValidTransition(from, to S) bool {
    fromStr := fmt.Sprintf("%v", from)
    toStr := fmt.Sprintf("%v", to)
    nexts := allowedTransitions[fromStr]
    return nexts != nil && nexts[toStr]
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
cd /Users/yoko/chaitin/ai/MonkeyCode/backend
go test ./pkg/lifecycle/... -v
# Expected: PASS
```

- [ ] **Step 5: 提交**

```bash
git add pkg/lifecycle/manager.go pkg/lifecycle/manager_test.go
git commit -m "feat(lifecycle): implement generic lifecycle manager with Hook support"
```

---

### Task 3: 实现 VM 生命周期 Hooks

**Files:**
- Create: `pkg/lifecycle/vm_hooks.go`
- Test: `pkg/lifecycle/vm_hooks_test.go`

- [ ] **Step 1: 创建 VMTaskHook 更新任务状态**

```go
// pkg/lifecycle/vm_hooks.go
package lifecycle

import (
    "context"
    "log/slog"

    "github.com/chaitin/MonkeyCode/backend/consts"
    "github.com/chaitin/MonkeyCode/backend/domain"
)

// VMTaskHook VM 状态变更时更新关联任务状态
type VMTaskHook struct {
    taskRepo domain.TaskRepo
    logger   *slog.Logger
}

// NewVMTaskHook 创建 VM 任务 Hook
func NewVMTaskHook(taskRepo domain.TaskRepo, logger *slog.Logger) *VMTaskHook {
    return &VMTaskHook{
        taskRepo: taskRepo,
        logger:   logger.With("hook", "vm-task-hook"),
    }
}

func (h *VMTaskHook) Name() string     { return "vm-task-hook" }
func (h *VMTaskHook) Priority() int    { return 100 } // 高优先级
func (h *VMTaskHook) Async() bool      { return false } // 同步执行，确保任务状态正确更新

func (h *VMTaskHook) OnStateChange(ctx context.Context, id string, from, to VMState, metadata VMMetadata) error {
    if metadata.TaskID == "" {
        return nil
    }

    var targetStatus consts.TaskStatus
    switch to {
    case VMStateRunning:
        targetStatus = consts.TaskStatusProcessing
    case VMStateFailed:
        targetStatus = consts.TaskStatusError
    case VMStateSucceeded:
        targetStatus = consts.TaskStatusFinished
    default:
        return nil
    }

    h.logger.InfoContext(ctx, "updating task status", "task_id", metadata.TaskID, "status", targetStatus)
    return h.taskRepo.UpdateStatus(ctx, metadata.TaskID, targetStatus)
}
```

- [ ] **Step 2: 创建 VMNotifyHook 发送通知**

```go
// pkg/lifecycle/vm_hooks.go (追加)

// VMNotifyHook VM 状态变更时发送通知
type VMNotifyHook struct {
    notify *dispatcher.Dispatcher
    logger *slog.Logger
}

// NewVMNotifyHook 创建 VM 通知 Hook
func NewVMNotifyHook(notify *dispatcher.Dispatcher, logger *slog.Logger) *VMNotifyHook {
    return &VMNotifyHook{
        notify: notify,
        logger: logger.With("hook", "vm-notify-hook"),
    }
}

func (h *VMNotifyHook) Name() string     { return "vm-notify-hook" }
func (h *VMNotifyHook) Priority() int    { return 50 }
func (h *VMNotifyHook) Async() bool      { return true } // 异步执行，不阻塞状态转换

func (h *VMNotifyHook) OnStateChange(ctx context.Context, vmID string, from, to VMState, metadata VMMetadata) error {
    var eventType string
    switch to {
    case VMStateRunning:
        eventType = domain.NotifyEventVMReady
    case VMStateFailed:
        eventType = domain.NotifyEventVMFailed
    case VMStateSucceeded:
        eventType = domain.NotifyEventVMCompleted
    default:
        return nil
    }

    event := &domain.NotifyEvent{
        EventType:     eventType,
        SubjectUserID: metadata.UserID,
        RefID:         vmID,
        Payload: domain.NotifyEventPayload{
            VMID:   vmID,
            Status: string(to),
        },
    }

    h.logger.InfoContext(ctx, "publishing notify event", "event", eventType, "vm_id", vmID)
    return h.notify.Publish(ctx, event)
}
```

- [ ] **Step 3: 编写 VM Hooks 测试**

```go
// pkg/lifecycle/vm_hooks_test.go
package lifecycle

import (
    "context"
    "testing"
    "github.com/stretchr/assert"
    "github.com/chaitin/MonkeyCode/backend/domain"
)

func TestVMTaskHook_OnStateChange(t *testing.T) {
    mockRepo := &mockTaskRepo{}
    hook := NewVMTaskHook(mockRepo, nil)

    ctx := context.Background()
    meta := VMMetadata{TaskID: "task-1", UserID: "user-1"}

    // VM Running -> 任务状态应为 Processing
    err := hook.OnStateChange(ctx, "vm-1", VMStatePending, VMStateRunning, meta)
    assert.NoError(t, err)
    assert.Equal(t, consts.TaskStatusProcessing, mockRepo.lastStatus)

    // VM Failed -> 任务状态应为 Error
    err = hook.OnStateChange(ctx, "vm-1", VMStateRunning, VMStateFailed, meta)
    assert.NoError(t, err)
    assert.Equal(t, consts.TaskStatusError, mockRepo.lastStatus)
}

type mockTaskRepo struct {
    lastStatus consts.TaskStatus
}

func (m *mockTaskRepo) UpdateStatus(ctx context.Context, taskID string, status consts.TaskStatus) error {
    m.lastStatus = status
    return nil
}
```

- [ ] **Step 4: 运行测试验证**

```bash
cd /Users/yoko/chaitin/ai/MonkeyCode/backend
go test ./pkg/lifecycle/... -v -run TestVM
# Expected: PASS
```

- [ ] **Step 5: 提交**

```bash
git add pkg/lifecycle/vm_hooks.go pkg/lifecycle/vm_hooks_test.go
git commit -m "feat(lifecycle): add VM hooks for task status update and notifications"
```

---

### Task 4: 实现 Task 生命周期 Hooks

**Files:**
- Create: `pkg/lifecycle/task_hooks.go`
- Test: `pkg/lifecycle/task_hooks_test.go`

- [ ] **Step 1: 创建 TaskNotifyHook**

```go
// pkg/lifecycle/task_hooks.go
package lifecycle

import (
    "context"
    "log/slog"

    "github.com/chaitin/MonkeyCode/backend/domain"
    "github.com/chaitin/MonkeyCode/backend/pkg/notify/dispatcher"
)

// TaskNotifyHook 任务状态变更时发送通知
type TaskNotifyHook struct {
    notify *dispatcher.Dispatcher
    logger *slog.Logger
}

// NewTaskNotifyHook 创建任务通知 Hook
func NewTaskNotifyHook(notify *dispatcher.Dispatcher, logger *slog.Logger) *TaskNotifyHook {
    return &TaskNotifyHook{
        notify: notify,
        logger: logger.With("hook", "task-notify-hook"),
    }
}

func (h *TaskNotifyHook) Name() string     { return "task-notify-hook" }
func (h *TaskNotifyHook) Priority() int    { return 50 }
func (h *TaskNotifyHook) Async() bool      { return true }

func (h *TaskNotifyHook) OnStateChange(ctx context.Context, taskID string, from, to TaskState, metadata TaskMetadata) error {
    var eventType string
    switch to {
    case TaskStatePending:
        eventType = domain.NotifyEventTaskCreated
    case TaskStateRunning:
        eventType = domain.NotifyEventTaskStarted
    case TaskStateSucceeded:
        eventType = domain.NotifyEventTaskCompleted
    case TaskStateFailed:
        eventType = domain.NotifyEventTaskFailed
    default:
        return nil
    }

    event := &domain.NotifyEvent{
        EventType:     eventType,
        SubjectUserID: metadata.UserID,
        RefID:         taskID,
        Payload: domain.NotifyEventPayload{
            TaskID: taskID,
            Status: string(to),
        },
    }

    h.logger.InfoContext(ctx, "publishing notify event", "event", eventType, "task_id", taskID)
    return h.notify.Publish(ctx, event)
}
```

- [ ] **Step 2: 编写 Task Hooks 测试**

```go
// pkg/lifecycle/task_hooks_test.go
package lifecycle

import (
    "context"
    "testing"
    "github.com/stretchr/assert"
)

func TestTaskNotifyHook_OnStateChange(t *testing.T) {
    mockNotify := &mockDispatcher{}
    hook := NewTaskNotifyHook(mockNotify, nil)

    ctx := context.Background()
    meta := TaskMetadata{TaskID: "task-1", UserID: "user-1"}

    // Task Pending -> TaskCreated 通知
    err := hook.OnStateChange(ctx, "task-1", "", TaskStatePending, meta)
    assert.NoError(t, err)
    assert.Contains(t, mockNotify.events, domain.NotifyEventTaskCreated)

    // Task Running -> TaskStarted 通知
    err = hook.OnStateChange(ctx, "task-1", TaskStatePending, TaskStateRunning, meta)
    assert.NoError(t, err)
    assert.Contains(t, mockNotify.events, domain.NotifyEventTaskStarted)
}

type mockDispatcher struct {
    events []string
}

func (m *mockDispatcher) Publish(ctx context.Context, event *domain.NotifyEvent) error {
    m.events = append(m.events, event.EventType)
    return nil
}
```

- [ ] **Step 3: 运行测试验证**

```bash
cd /Users/yoko/chaitin/ai/MonkeyCode/backend
go test ./pkg/lifecycle/... -v -run TestTask
# Expected: PASS
```

- [ ] **Step 4: 提交**

```bash
git add pkg/lifecycle/task_hooks.go pkg/lifecycle/task_hooks_test.go
git commit -m "feat(lifecycle): add Task hooks for notifications"
```

---

### Task 5: 注册 LifecycleManager 到 DI 容器

**Files:**
- Modify: `pkg/register.go`

- [ ] **Step 1: 修改 pkg/register.go 添加生命周期管理器注册**

在 `RegisterInfra` 函数中添加（在 `// Tasker` 注释后）：

```go
// Lifecycle Manager（泛型版本）
do.Provide(i, func(i *do.Injector) (*lifecycle.Manager[lifecycle.TaskState, lifecycle.TaskMetadata], error) {
    r := do.MustInvoke[*redis.Client](i)
    l := do.MustInvoke[*slog.Logger](i)
    return lifecycle.NewManager[lifecycle.TaskState, lifecycle.TaskMetadata](r, lifecycle.WithLogger(l)), nil
})

do.Provide(i, func(i *do.Injector) (*lifecycle.Manager[lifecycle.VMState, lifecycle.VMMetadata], error) {
    r := do.MustInvoke[*redis.Client](i)
    l := do.MustInvoke[*slog.Logger](i)
    return lifecycle.NewManager[lifecycle.VMState, lifecycle.VMMetadata](r, lifecycle.WithLogger(l)), nil
})
```

- [ ] **Step 2: 添加必要的 import**

```go
import (
    // ... existing imports
    "github.com/chaitin/MonkeyCode/backend/pkg/lifecycle"
)
```

- [ ] **Step 3: 验证编译通过**

```bash
cd /Users/yoko/chaitin/ai/MonkeyCode/backend
go build ./...
# Expected: PASS
```

- [ ] **Step 4: 提交**

```bash
git add pkg/register.go
git commit -m "feat: register lifecycle managers in DI container"
```

---

### Task 6: 重构 TaskUsecase 使用新架构

**Files:**
- Modify: `biz/task/usecase/task.go`

- [ ] **Step 1: 更新 TaskUsecase 结构**

```go
// biz/task/usecase/task.go

type TaskUsecase struct {
    cfg              *config.Config
    repo             domain.TaskRepo
    modelRepo        domain.ModelRepo
    logger           *slog.Logger
    taskflow         taskflow.Clienter
    loki             *loki.Client
    redis            *redis.Client
    notifyDispatcher *dispatcher.Dispatcher
    taskHook         domain.TaskHook

    // 新增：生命周期管理器
    taskLifecycle *lifecycle.Manager[lifecycle.TaskState, lifecycle.TaskMetadata]
    vmLifecycle   *lifecycle.Manager[lifecycle.VMState, lifecycle.VMMetadata]
}
```

- [ ] **Step 2: 更新 NewTaskUsecase 注入 Manager**

```go
func NewTaskUsecase(i *do.Injector) (domain.TaskUsecase, error) {
    u := &TaskUsecase{
        cfg:              do.MustInvoke[*config.Config](i),
        repo:             do.MustInvoke[domain.TaskRepo](i),
        modelRepo:        do.MustInvoke[domain.ModelRepo](i),
        logger:           do.MustInvoke[*slog.Logger](i).With("module", "usecase.TaskUsecase"),
        taskflow:         do.MustInvoke[taskflow.Clienter](i),
        loki:             do.MustInvoke[*loki.Client](i),
        redis:            do.MustInvoke[*redis.Client](i),
        notifyDispatcher: do.MustInvoke[*dispatcher.Dispatcher](i),

        // 新增
        taskLifecycle: do.MustInvoke[*lifecycle.Manager[lifecycle.TaskState, lifecycle.TaskMetadata]](i),
        vmLifecycle:   do.MustInvoke[*lifecycle.Manager[lifecycle.VMState, lifecycle.VMMetadata]](i),
    }

    // 注册 VM Hooks
    u.vmLifecycle.Register(
        lifecycle.NewVMTaskHook(u.repo, u.logger),
        lifecycle.NewVMNotifyHook(u.notifyDispatcher, u.logger),
    )

    // 注册 Task Hooks
    u.taskLifecycle.Register(
        lifecycle.NewTaskNotifyHook(u.notifyDispatcher, u.logger),
    )

    // 移除旧的 tasker 回调注册
    // u.tasker.On(tasker.PhaseCreated, u.onCreated)
    // ...

    return u, nil
}
```

- [ ] **Step 3: 重构 Create 方法**

```go
func (a *TaskUsecase) Create(ctx context.Context, user *domain.User, req domain.CreateTaskReq, token string) (*domain.ProjectTask, error) {
    // 1. 检查 Host 在线状态
    r, err := a.taskflow.Host().IsOnline(ctx, &taskflow.IsOnlineReq[string]{
        IDs: []string{req.HostID},
    })
    if err != nil {
        return nil, errcode.ErrHostOffline.Wrap(err)
    }
    if !r.OnlineMap[req.HostID] {
        return nil, errcode.ErrHostOffline
    }

    req.Now = time.Now()

    // 2. 获取系统提示词
    if a.taskHook != nil && req.SystemPrompt == "" {
        if prompt, err := a.taskHook.GetSystemPrompt(ctx, req.Type, req.SubType); err == nil && prompt != "" {
            req.SystemPrompt = prompt
        }
    }

    var res *db.ProjectTask
    err = entx.WithTx2(ctx, a.db, func(tx *db.Tx) error {
        // ... 现有逻辑：获取 Host, Model, Image

        // 3. 创建任务（状态：pending）
        tk, err := tx.Task.Create().
            SetID(id).
            SetKind(req.Type).
            SetSubType(req.SubType).
            SetContent(req.Content).
            SetUserID(u.ID).
            SetStatus(consts.TaskStatusPending).  // 初始状态
            Save(ctx)
        if err != nil {
            return err
        }

        // 4. 创建 VM
        vm, err := a.taskflow.VirtualMachiner().Create(ctx, &taskflow.CreateVirtualMachineReq{
            // ... 现有参数
        })
        if err != nil {
            return err
        }
        if vm == nil {
            return fmt.Errorf("vm is nil")
        }

        // 5. 转换任务状态到 Running（触发 Task Hooks）
        taskMeta := lifecycle.TaskMetadata{
            TaskID:  tk.ID.String(),
            UserID:  user.ID.String(),
            Project: req.Extra.ProjectID.String(),
        }
        if err := a.taskLifecycle.Transition(ctx, tk.ID.String(), lifecycle.TaskStateRunning, taskMeta); err != nil {
            a.logger.WarnContext(ctx, "task lifecycle transition failed", "error", err)
        }

        // 6. 转换 VM 状态到 Running（触发 VM Hooks，自动更新任务状态）
        vmMeta := lifecycle.VMMetadata{
            VMID:   vm.ID,
            TaskID: tk.ID.String(),
            UserID: user.ID.String(),
        }
        if err := a.vmLifecycle.Transition(ctx, vm.ID, lifecycle.VMStateRunning, vmMeta); err != nil {
            a.logger.WarnContext(ctx, "vm lifecycle transition failed", "error", err)
        }

        // 7. 创建 MCP 配置并启动 Tasker（保持现有逻辑）
        mcps := []taskflow.McpServerConfig{...}
        if err := a.tasker.CreateTask(ctx, t.ID.String(), &domain.TaskSession{...}); err != nil {
            return err
        }

        return nil
    })

    if err != nil {
        a.logger.With("error", err, "req", req).ErrorContext(ctx, "failed to create task")
        return nil, err
    }

    result := cvt.From(res, &domain.ProjectTask{})

    // 8. 通知 TaskHook
    if a.taskHook != nil {
        if err := a.taskHook.OnTaskCreated(ctx, result); err != nil {
            a.logger.WarnContext(ctx, "taskHook.OnTaskCreated failed", "error", err)
        }
    }

    return result, nil
}
```

- [ ] **Step 4: 移除旧的回调方法**

删除以下方法（因为 Hook 接管了这些职责）：
- `onCreated`
- `onStarted`
- `onRunning`
- `onFinished`
- `onFailed`

- [ ] **Step 5: 验证编译通过**

```bash
cd /Users/yoko/chaitin/ai/MonkeyCode/backend
go build ./...
# Expected: PASS
```

- [ ] **Step 6: 提交**

```bash
git add biz/task/usecase/task.go
git commit -m "refactor(task): use lifecycle manager instead of tasker callbacks"
```

---

### Task 7: 清理旧代码

**Files:**
- Modify: `biz/task/usecase/task.go`
- Modify: `pkg/register.go`
- Delete: (可选) `pkg/tasker/tasker.go` - 如果确认不再需要

- [ ] **Step 1: 移除 pkg/register.go 中的 Tasker 注册**

```go
// 删除或注释掉:
// do.Provide(i, func(i *do.Injector) (*tasker.Tasker[*domain.TaskSession], error) {
//     r := do.MustInvoke[*redis.Client](i)
//     l := do.MustInvoke[*slog.Logger](i)
//     return tasker.NewTasker(r, tasker.WithLogger[*domain.TaskSession](l)), nil
// })
```

- [ ] **Step 2: 验证无其他模块依赖 Tasker**

```bash
cd /Users/yoko/chaitin/ai/MonkeyCode/backend
grep -r "tasker\.Tasker" --include="*.go" .
# Expected: 只在 biz/task/usecase/task.go 中可能还有引用
```

- [ ] **Step 3: 移除 TaskUsecase 中对 tasker 的引用**

```go
// 删除 TaskUsecase 结构中的:
// tasker *tasker.Tasker[*domain.TaskSession]
```

- [ ] **Step 4: 提交**

```bash
git add pkg/register.go biz/task/usecase/task.go
git commit -m "chore: remove deprecated tasker dependency"
```

---

### Task 8: 集成测试

**Files:**
- Create: `pkg/lifecycle/integration_test.go`

- [ ] **Step 1: 编写集成测试**

```go
// pkg/lifecycle/integration_test.go
package lifecycle

import (
    "context"
    "testing"
    "github.com/redis/go-redis/v9"
    "github.com/stretchr/testify/assert"
)

// TestIntegration_VMToTaskStatus 测试 VM 状态变更自动更新任务状态
func TestIntegration_VMToTaskStatus(t *testing.T) {
    rdb := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
    defer rdb.Close()
    rdb.FlushAll(context.Background())

    // 创建 VM Manager（带 VMTaskHook）
    taskRepo := &mockTaskRepo{}
    mgr := NewManager[VMState, VMMetadata](rdb)
    mgr.Register(&VMTaskHook{taskRepo: taskRepo})

    ctx := context.Background()
    meta := VMMetadata{TaskID: "task-1", UserID: "user-1"}

    // VM: pending -> running
    err := mgr.Transition(ctx, "vm-1", VMStateRunning, meta)
    assert.NoError(t, err)

    // 验证：任务状态被更新为 Processing
    assert.Equal(t, consts.TaskStatusProcessing, taskRepo.lastStatus)

    // VM: running -> succeeded
    err = mgr.Transition(ctx, "vm-1", VMStateSucceeded, meta)
    assert.NoError(t, err)

    // 验证：任务状态被更新为 Finished
    assert.Equal(t, consts.TaskStatusFinished, taskRepo.lastStatus)
}

// TestIntegration_TaskNotifications 测试任务状态变更发送通知
func TestIntegration_TaskNotifications(t *testing.T) {
    rdb := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
    defer rdb.Close()
    rdb.FlushAll(context.Background())

    notify := &mockDispatcher{}
    mgr := NewManager[TaskState, TaskMetadata](rdb)
    mgr.Register(&TaskNotifyHook{notify: notify})

    ctx := context.Background()
    meta := TaskMetadata{TaskID: "task-1", UserID: "user-1"}

    // Task: (empty) -> pending
    err := mgr.Transition(ctx, "task-1", TaskStatePending, meta)
    assert.NoError(t, err)

    // 验证：发送了 TaskCreated 通知
    assert.Contains(t, notify.events, domain.NotifyEventTaskCreated)
}
```

- [ ] **Step 2: 运行集成测试**

```bash
cd /Users/yoko/chaitin/ai/MonkeyCode/backend
go test ./pkg/lifecycle/... -v -run Integration
# Expected: PASS
```

- [ ] **Step 3: 提交**

```bash
git add pkg/lifecycle/integration_test.go
git commit -m "test(lifecycle): add integration tests for hooks"
```

---

### Task 9: 更新文档和验证

**Files:**
- Create: `pkg/lifecycle/README.md`

- [ ] **Step 1: 创建 README 文档**

```markdown
# Lifecycle Package

泛型化的生命周期管理框架，支持自定义状态类型和元数据。

## 架构

```
┌─────────────────────────────────────────┐
│         LifecycleManager[S, M]          │
│  - Register(hooks...)                   │
│  - Transition(ctx, id, to, metadata)    │
│  - GetState(ctx, id)                    │
└─────────────────────────────────────────┘
           │
           │ 触发
           ▼
┌─────────────────────────────────────────┐
│         Hook Pipeline                   │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│  │ Hook 1  │→│ Hook 2  │→│ Hook 3  │   │
│  │ (sync)  │ │ (async) │ │ (async) │   │
│  └─────────┘ └─────────┘ └─────────┘   │
└─────────────────────────────────────────┘
```

## 使用示例

### 定义状态类型

```go
type OrderState string
const (
    OrderStatePending     OrderState = "pending"
    OrderStatePaid        OrderState = "paid"
    OrderStateShipped     OrderState = "shipped"
    OrderStateDelivered   OrderState = "delivered"
)

type OrderMetadata struct {
    OrderID string
    UserID  string
    Amount  float64
}
```

### 创建 Manager 并注册 Hooks

```go
mgr := lifecycle.NewManager[OrderState, OrderMetadata](redis)

mgr.Register(
    &OrderNotifyHook{notify: dispatcher},
    &OrderAuditHook{audit: auditor},
)
```

### 状态转换

```go
meta := OrderMetadata{OrderID: "123", UserID: "user-1", Amount: 99.99}
err := mgr.Transition(ctx, "order-123", OrderStatePaid, meta)
// Hooks 自动触发
```

## Hook 接口

```go
type Hook[S State, M any] interface {
    Name() string
    Priority() int      // 数字越大优先级越高
    Async() bool        // 是否异步执行
    OnStateChange(ctx context.Context, id string, from, to S, metadata M) error
}
```

## 状态转换规则

| 当前状态 | 允许转换到         |
|---------|-------------------|
| (空)    | pending, running  |
| pending | running, failed   |
| running | succeeded, failed |
| failed  | running (重试)    |
| succeeded | (终态)          |
```

- [ ] **Step 2: 验证所有测试通过**

```bash
cd /Users/yoko/chaitin/ai/MonkeyCode/backend
go test ./pkg/lifecycle/... ./biz/task/... -v
# Expected: 所有测试 PASS
```

- [ ] **Step 3: 完整功能验证**

```bash
# 启动服务并创建任务，验证：
# 1. 任务创建后状态正确
# 2. VM 创建成功后任务状态自动更新
# 3. 通知正确发送
```

- [ ] **Step 4: 提交**

```bash
git add pkg/lifecycle/README.md
git commit -m "docs(lifecycle): add README documentation"
```

---

## 总结

完成以上所有任务后，你将拥有：

1. ✅ **泛型化的 LifecycleManager** - 支持任意状态类型和元数据
2. ✅ **VM 生命周期管理** - 独立的 Manager 和 Hooks
3. ✅ **Task 生命周期管理** - 独立的 Manager 和 Hooks
4. ✅ **解耦的业务逻辑** - TaskUsecase 不再直接耦合 tasker 回调
5. ✅ **完整的测试覆盖** - 单元测试 + 集成测试
6. ✅ **文档齐全** - README 和使用示例

---

## 风险点

| 风险 | 缓解措施 |
|------|---------|
| 状态转换失败导致业务中断 | Hook 失败记录日志但不回滚状态 |
| Redis 连接问题 | 确保 Redis 高可用，添加重试机制 |
| 异步 Hook 丢失 | 考虑添加 Hook 执行日志表持久化 |
| 与现有 tasker 冲突 | 逐步迁移，先并行运行再移除旧代码 |

---

**Plan complete.** 两个执行选项：

1. **Subagent-Driven (recommended)** - 每个 Task 由独立 subagent 执行，Task 间 review  checkpoint
2. **Inline Execution** - 在当前 session 使用 executing-plans 批量执行

选择哪种方式？
