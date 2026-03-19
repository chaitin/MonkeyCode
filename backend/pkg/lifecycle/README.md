# Lifecycle Package

泛型化的生命周期管理框架，支持自定义状态类型和元数据。

## 架构说明

```
┌─────────────────────────────────────────┐
│      Manager[I, S, M]                   │
│  - Transition(ctx, id, to, metadata)    │
│  - GetState(ctx, id)                    │
│  - Register(hooks...)                   │
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

### 核心组件

| 组件 | 说明 |
|------|------|
| `Manager[I, S, M]` | 泛型生命周期管理器，`I` 为 ID 类型（comparable），`S` 为状态类型（基于 string），`M` 为元数据类型 |
| `Hook[I, S, M]` | 生命周期钩子接口，支持同步/异步执行 |
| `State` | 状态类型约束（`~string`，支持 string 及其派生类型） |

### 设计特点

- **完全泛型化**: 支持任意 `comparable` 的 ID 类型（`string`/`uuid.UUID`/`int` 等）、任意基于 `string` 的状态类型、任意元数据类型
- **Hook 链**: 支持多个 Hook 按优先级排序执行（优先级数字越大越先执行）
- **异步支持**: Hook 可配置为异步执行，不阻塞状态转换
- **Redis 持久化**: 状态和元数据存储使用 Redis Hash 结构
- **状态转换验证**: 内置状态转换规则验证，防止非法状态跳转

---

## 使用示例

### 1. 定义状态类型和元数据

```go
package lifecycle

// 任务状态
type TaskState string

const (
    TaskStatePending   TaskState = "pending"
    TaskStateRunning   TaskState = "running"
    TaskStateFailed    TaskState = "failed"
    TaskStateSucceeded TaskState = "succeeded"
)

// 任务元数据
type TaskMetadata struct {
    TaskID uuid.UUID `json:"task_id"`
    UserID string    `json:"user_id"`
}
```

### 2. 创建 Manager 并注册 Hooks

```go
import "github.com/chaitin/MonkeyCode/backend/pkg/lifecycle"

// 创建 Manager（Task 用 uuid.UUID 作 ID）
taskMgr := lifecycle.NewManager[uuid.UUID, TaskState, TaskMetadata](
    redisClient,
    lifecycle.WithTransitions[uuid.UUID, TaskState, TaskMetadata](lifecycle.TaskTransitions()),
    lifecycle.WithLogger(logger),
)

// 注册 Hooks（按优先级自动排序）
taskMgr.Register(
    lifecycle.NewTaskNotifyHook(notifyDispatcher, logger),
    lifecycle.NewTaskCreateHook(redisClient, taskflowClient, logger),
)
```

### 3. 状态转换

```go
ctx := context.Background()

// 执行状态转换：pending -> running
meta := TaskMetadata{
    TaskID: taskID,
    UserID: "user-456",
}
err := taskMgr.Transition(ctx, taskID, TaskStateRunning, meta)
if err != nil {
    return err
}
// Hooks 自动触发（按优先级：TaskCreateHook -> TaskNotifyHook）
```

### 4. 获取当前状态

```go
state, err := taskMgr.GetState(ctx, taskID)
if err != nil {
    return err
}
```

---

## Hook 接口定义

```go
type Hook[I comparable, S State, M any] interface {
    // Name 返回 Hook 名称
    Name() string

    // Priority 返回优先级（数字越大优先级越高，先执行）
    Priority() int

    // Async 返回是否异步执行
    Async() bool

    // OnStateChange 状态变更回调
    OnStateChange(ctx context.Context, id I, from, to S, metadata M) error
}
```

### Hook 实现示例

```go
type TaskNotifyHook struct {
    notify *dispatcher.Dispatcher
    logger *slog.Logger
}

func (h *TaskNotifyHook) Name() string     { return "task-notify-hook" }
func (h *TaskNotifyHook) Priority() int    { return 50 }
func (h *TaskNotifyHook) Async() bool      { return true }

func (h *TaskNotifyHook) OnStateChange(ctx context.Context, taskID uuid.UUID, from, to TaskState, meta TaskMetadata) error {
    // 发送通知逻辑
    event := &NotifyEvent{
        EventType: consts.NotifyEventTaskCompleted,
        Payload:   map[string]any{"status": to, "task_id": taskID},
    }
    return h.notify.Publish(ctx, event)
}
```

---

## 状态转换规则

### 默认状态转换规则

#### Task 状态转换

| 当前状态 (from) | 允许转换到 (to)       | 说明         |
|-----------------|----------------------|--------------|
| (空)            | pending, running     | 初始创建     |
| pending         | running, failed      | 待处理状态   |
| running         | succeeded, failed    | 执行中状态   |
| failed          | running              | 失败可重试   |
| succeeded       | (无)                 | 终态         |

#### VM 状态转换

| 当前状态 (from) | 允许转换到 (to)       | 说明         |
|-----------------|----------------------|--------------|
| (空)            | pending, creating    | 初始创建     |
| pending         | creating, failed     | 待处理状态   |
| creating        | running, failed      | 创建中状态   |
| running         | succeeded, failed    | 运行中状态   |
| failed          | running              | 失败可重试   |
| succeeded       | (无)                 | 终态         |

### 状态转换流程图

```
Task 生命周期：
    (empty)
       │
       ├─────────────┐
       ▼             ▼
   pending       running
       │             │
       │             ├─────────────┐
       ▼             ▼             ▼
    running       succeeded    failed
       │                           │
       ├─────────────┐             │
       ▼             ▼             │
   succeeded      failed ──────────┘

VM 生命周期：
    (empty)
       │
       ├─────────────┐
       ▼             ▼
   pending       creating
       │             │
       │             ├─────────────┐
       ▼             ▼             ▼
    creating     running      failed
       │             │             │
       │             ├─────────────┤
       ▼             ▼             │
   succeeded     failed ───────────┘
```

### 自定义状态转换

使用 `WithTransitions` 选项自定义状态转换规则：

```go
// 订单状态示例
type OrderState string

const (
    OrderStatePending   OrderState = "pending"
    OrderStatePaid      OrderState = "paid"
    OrderStateShipped   OrderState = "shipped"
    OrderStateDelivered OrderState = "delivered"
)

customTransitions := map[OrderState][]OrderState{
    OrderStatePending:   {OrderStatePaid},
    OrderStatePaid:      {OrderStateShipped, OrderStateRefunded},
    OrderStateShipped:   {OrderStateDelivered},
    OrderStateDelivered: {},
}

mgr := lifecycle.NewManager[string, OrderState, OrderMetadata](
    redisClient,
    lifecycle.WithTransitions(customTransitions),
)
```

---

## 内置 Hook

### Task 相关 Hooks

| Hook | 说明 | 优先级 | 执行方式 |
|------|------|--------|---------|
| `TaskNotifyHook` | 任务状态变更时发送通知 | 50 | 异步 |
| `TaskCreateHook` | TaskStateRunning 时从 Redis 读取 CreateTaskReq 创建 taskflow 任务 | 80 | 同步 |

### VM 相关 Hooks

| Hook | 说明 | 优先级 | 执行方式 |
|------|------|--------|---------|
| `VMTaskHook` | VM 状态变更时更新关联任务状态 | 100 | 同步 |
| `VMNotifyHook` | VM 状态变更时发送通知 | 50 | 异步 |

### Hook 执行顺序示例

当 VM 状态变为 `Running` 时：

```
1. VMTaskHook (Priority=100, sync)
   └─→ 更新任务状态为 Processing

2. TaskCreateHook (Priority=80, sync)
   └─→ 从 Redis 读取 CreateTaskReq，创建 taskflow 任务

3. VMNotifyHook (Priority=50, async)
   └─→ 发送 VMReady 通知
```

---

## 典型使用场景：任务 + VM 生命周期管理

### 完整流程

```
1. TaskUsecase.Create()
   ├─ 创建任务记录（数据库）
   ├─ 创建 VM（taskflow）
   ├─ 存储 CreateTaskReq 到 Redis（10 分钟过期）
   │   key: task:create_req:{taskID}
   ├─ taskMgr.Transition(taskID, TaskStatePending, meta)
   └─ vmMgr.Transition(vmID, VMStatePending, meta)

2. VM 就绪（InternalHandler.VmReady）
   └─ vmMgr.Transition(vmID, VMStateRunning, meta)
       ├─ VMTaskHook: 更新任务状态为 Processing
       ├─ TaskCreateHook: 从 Redis 读取 CreateTaskReq → 创建 taskflow 任务 → 删除 key
       └─ VMNotifyHook: 发送 VMReady 通知

3. 任务完成
   └─ taskMgr.Transition(taskID, TaskStateSucceeded, meta)
       └─ TaskNotifyHook: 发送 TaskCompleted 通知
```

### 代码示例

```go
// 创建任务
func (a *TaskUsecase) Create(ctx context.Context, user *domain.User, req domain.CreateTaskReq, token string) (*domain.ProjectTask, error) {
    // 1. 创建任务记录
    pt, err := a.repo.Create(ctx, user, req, token, func(...) {
        // 2. 创建 VM
        vm := a.taskflow.VirtualMachiner().Create(...)

        // 3. 临时存储 CreateTaskReq（10 分钟过期）
        reqKey := fmt.Sprintf("task:create_req:%s", task.ID)
        a.redis.Set(ctx, reqKey, createReq, 10*time.Minute)

        // 4. 初始化状态（Transition 会自动触发 Hook）
        taskMeta := lifecycle.TaskMetadata{TaskID: t.ID, UserID: user.ID.String()}
        a.taskLifecycle.Transition(ctx, t.ID, lifecycle.TaskStatePending, taskMeta)

        vmMeta := lifecycle.VMMetadata{VMID: vm.ID, TaskID: t.ID.String(), UserID: user.ID.String()}
        a.vmLifecycle.Transition(ctx, vm.ID, lifecycle.VMStatePending, vmMeta)

        return vm, nil
    })

    return pt, nil
}

// VM 就绪回调
func (h *InternalHandler) VmReady(vmID string) error {
    // 转换 VM 状态，自动触发 Hook 链
    meta := lifecycle.VMMetadata{...}
    return h.vmLifecycle.Transition(ctx, vmID, lifecycle.VMStateRunning, meta)
}
```

---

## API 参考

### Manager 方法

| 方法 | 签名 | 说明 |
|------|------|------|
| `NewManager` | `func NewManager[I comparable, S State, M any](redis *redis.Client, opts ...Opt) *Manager[I, S, M]` | 创建生命周期管理器 |
| `Transition` | `func (m *Manager) Transition(ctx context.Context, id I, to S, metadata M) error` | 执行状态转换（触发 Hook 链） |
| `GetState` | `func (m *Manager) GetState(ctx context.Context, id I) (S, error)` | 获取当前状态 |
| `Register` | `func (m *Manager[I, S, M]) Register(hooks ...Hook[I, S, M])` | 注册 Hook（按优先级自动排序） |

### 配置选项

| 选项 | 签名 | 说明 |
|------|------|------|
| `WithLogger` | `func WithLogger[I, S, M](logger *slog.Logger) Opt[I, S, M]` | 设置日志器 |
| `WithTransitions` | `func WithTransitions[I, S, M](transitions map[S][]S) Opt[I, S, M]` | 设置状态转换规则 |

### 内置工具函数

| 函数 | 签名 | 说明 |
|------|------|------|
| `TaskTransitions` | `func TaskTransitions() map[TaskState][]TaskState` | 获取 Task 默认状态转换规则 |
| `VMTransitions` | `func VMTransitions() map[VMState][]VMState` | 获取 VM 默认状态转换规则 |

---

## Redis 存储结构

```
Key: lifecycle:{id}
Type: Hash
Fields:
  - state: 当前状态（string）
  - from_state: 前一个状态（string）
  - updated_at: 更新时间戳（毫秒）

示例:
lifecycle:task-uuid-123
  state: "running"
  from_state: "pending"
  updated_at: 1710891245678
```

**注意**: 元数据（metadata）目前未持久化存储，由调用方通过 `Transition` 方法传入，供 Hook 使用。

---

## 类型定义

### TaskState

```go
type TaskState string

const (
    TaskStatePending   TaskState = "pending"
    TaskStateRunning   TaskState = "running"
    TaskStateFailed    TaskState = "failed"
    TaskStateSucceeded TaskState = "succeeded"
)
```

### VMState

```go
type VMState string

const (
    VMStatePending  VMState = "pending"
    VMStateCreating VMState = "creating"
    VMStateRunning  VMState = "running"
    VMStateFailed   VMState = "failed"
    VMStateSucceeded VMState = "succeeded"
)
```

### TaskMetadata

```go
type TaskMetadata struct {
    TaskID uuid.UUID `json:"task_id"`
    UserID string    `json:"user_id"`
}
```

### VMMetadata

```go
type VMMetadata struct {
    VMID   string `json:"vm_id"`
    TaskID string `json:"task_id"`
    UserID string `json:"user_id"`
}
```

---

## 测试

运行单元测试：

```bash
go test ./pkg/lifecycle/... -v
```

运行集成测试：

```bash
go test ./pkg/lifecycle/... -v -run Integration
```

运行特定 Hook 测试：

```bash
go test ./pkg/lifecycle/... -v -run TestTaskCreateHook
```
