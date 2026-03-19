# Lifecycle Package

泛型化的生命周期管理框架，支持自定义状态类型和元数据。

## 架构说明

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

### 核心组件

| 组件 | 说明 |
|------|------|
| `Manager[S, M]` | 泛型生命周期管理器，`S` 为状态类型，`M` 为元数据类型 |
| `Hook[S, M]` | 生命周期钩子接口，支持同步/异步执行 |
| `State` | 状态类型约束（基于 `string`） |

### 设计特点

- **泛型化设计**: 支持任意基于 `string` 的状态类型和任意元数据类型
- **Hook 链**: 支持多个 Hook 按优先级顺序执行
- **异步支持**: Hook 可配置为异步执行，不阻塞状态转换
- **Redis 持久化**: 状态存储使用 Redis Hash 结构

---

## 使用示例

### 1. 定义状态类型

```go
package lifecycle

// 订单状态
type OrderState string

const (
    OrderStatePending   OrderState = "pending"
    OrderStatePaid      OrderState = "paid"
    OrderStateShipped   OrderState = "shipped"
    OrderStateDelivered OrderState = "delivered"
)

// 订单元数据
type OrderMetadata struct {
    OrderID string
    UserID  string
    Amount  float64
}
```

### 2. 创建 Manager 并注册 Hooks

```go
import "github.com/chaitin/MonkeyCode/backend/pkg/lifecycle"

// 创建 Manager
mgr := lifecycle.NewManager[OrderState, OrderMetadata](redisClient)

// 注册 Hooks
mgr.Register(
    &OrderNotifyHook{notify: dispatcher},
    &OrderAuditHook{audit: auditor},
)
```

### 3. 状态转换

```go
ctx := context.Background()
meta := OrderMetadata{
    OrderID: "order-123",
    UserID:  "user-456",
    Amount:  99.99,
}

// 执行状态转换：pending -> paid
err := mgr.Transition(ctx, "order-123", OrderStatePaid, meta)
if err != nil {
    return err
}
// Hooks 自动触发
```

### 4. 获取当前状态

```go
state, err := mgr.GetState(ctx, "order-123")
if err != nil {
    return err
}
fmt.Printf("Current state: %s\n", state)
```

---

## Hook 接口定义

```go
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

### Hook 实现示例

```go
type OrderNotifyHook struct {
    notify *dispatcher.Dispatcher
    logger *slog.Logger
}

func (h *OrderNotifyHook) Name() string     { return "order-notify-hook" }
func (h *OrderNotifyHook) Priority() int    { return 50 }
func (h *OrderNotifyHook) Async() bool      { return true }

func (h *OrderNotifyHook) OnStateChange(ctx context.Context, id string, from, to OrderState, meta OrderMetadata) error {
    // 发送通知逻辑
    event := &NotifyEvent{
        EventType: "order_status_changed",
        Payload:   map[string]any{"status": to},
    }
    return h.notify.Publish(ctx, event)
}
```

---

## 状态转换规则

### 默认状态转换表

| 当前状态 (from) | 允许转换到 (to)       | 说明         |
|-----------------|----------------------|--------------|
| (空)            | pending, running     | 初始状态     |
| pending         | running, failed      | 待处理状态   |
| running         | succeeded, failed    | 执行中状态   |
| failed          | running              | 失败可重试   |
| succeeded       | (无)                 | 终态         |

### 状态转换流程图

```
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
```

### 自定义状态转换

如需自定义状态转换规则，可修改 `allowedTransitions` 映射：

```go
// 在 manager.go 中定义
var allowedTransitions = map[string]map[string]bool{
    "":          {"pending": true, "running": true},
    "pending":   {"running": true, "failed": true},
    "running":   {"succeeded": true, "failed": true},
    "failed":    {"running": true},
    "succeeded": {},
}
```

---

## 内置 Hook

### Task 相关 Hooks

| Hook | 说明 | 执行方式 |
|------|------|---------|
| `TaskNotifyHook` | 任务状态变更时发送通知 | 异步 |

### VM 相关 Hooks

| Hook | 说明 | 执行方式 |
|------|------|---------|
| `VMTaskHook` | VM 状态变更时更新关联任务状态 | 同步 |
| `VMNotifyHook` | VM 状态变更时发送通知 | 异步 |

---

## API 参考

### Manager 方法

| 方法 | 签名 | 说明 |
|------|------|------|
| `NewManager` | `func NewManager[S State, M any](redis *redis.Client, opts ...Opt[S, M]) *Manager[S, M]` | 创建生命周期管理器 |
| `Register` | `func (m *Manager[S, M]) Register(hooks ...Hook[S, M])` | 注册 Hook |
| `Transition` | `func (m *Manager[S, M]) Transition(ctx context.Context, id string, to S, metadata M) error` | 执行状态转换 |
| `GetState` | `func (m *Manager[S, M]) GetState(ctx context.Context, id string) (S, error)` | 获取当前状态 |

### 配置选项

| 选项 | 签名 | 说明 |
|------|------|------|
| `WithLogger` | `func WithLogger[S State, M any](logger *slog.Logger) Opt[S, M]` | 设置日志器 |

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
