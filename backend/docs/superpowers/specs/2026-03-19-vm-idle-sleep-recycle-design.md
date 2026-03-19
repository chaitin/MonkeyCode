# 开发环境空闲休眠与回收设计

## 概述

**任务创建的 VM**：使用基于空闲检测的自动休眠和回收策略：
- 10 分钟无活动 → 休眠开发环境
- 7 天无活动 → 回收开发环境（完全删除）
- 回收前 1 小时 → 通知用户（以任务维度呈现）

**手动创建的 VM**：保留原有的 TTL CountDown 过期逻辑（通过 `/api/v1/hosts/{hostID}/vms` 创建）。

区分方式：通过 `TaskVirtualMachine` 关联表判断 VM 是否为任务创建。

## 空闲定义

**空闲 = TaskStream 无数据交互**（无用户输入、无任务结果输出）。

仅监控 TaskStream，不包含 TerminalStream、FileManagerStream 等其他流。

## 整体架构

```
┌─────────┐   TaskStream 消息    ┌──────────┐   EventReport    ┌─────────────┐
│  Agent   │ ◄──────────────────► │ TaskFlow │ ───────────────► │ MonkeyCode  │
└─────────┘                      └──────────┘                  └──────┬──────┘
                                                                      │
                                  ┌───────────────────────────────────┘
                                  │
                                  ▼
                            ┌──────────┐
                            │  Redis   │
                            │          │
                            │ DelayQueue x3:                         │
                            │  ├─ vm:idle:sleep     (now + 10min)    │
                            │  ├─ vm:idle:notify    (now + 6d23h)    │
                            │  └─ vm:idle:recycle   (now + 7d)       │
                            └──────────┘
```

## 生命周期

```
VM 创建 ──► 入队 sleep(+10min) / notify(+6d23h) / recycle(+7d)
              │
              ▼
         ┌─ 活跃事件 ──► 刷新三个队列的 score
         │
         ├─ 10min 无活动 ──► sleep 触发 ──► 标记休眠状态
         │                                    │
         │                    用户再次活跃 ◄───┘ ──► 唤醒 + 刷新三个队列
         │
         ├─ 6d23h 无活动 ──► notify 触发 ──► 发送回收预警通知（任务维度）
         │
         └─ 7d 无活动 ──► recycle 触发 ──► 删除环境和所有资源
```

## 详细设计

### 1. taskflow 侧改动

#### 1.1 TaskStream 活动监控

在 `internal/agent/handler/grpc/task.go` 中，TaskStream 每次收发消息时，直接调用 EventReport 上报：

```go
connector.EventReport.ReportVMActivity(vmID, time.Now())
```

每条消息独立上报，taskflow 与 MonkeyCode 为内网通信，无需批量聚合。

#### 1.2 新增数据结构

```go
// types/agent.go
type VMActivity struct {
    VMID         string    `json:"vm_id"`
    LastActiveAt time.Time `json:"last_active_at"`
}
```

#### 1.3 EventReport 新增方法

```go
// internal/connector/eventreport.go
func (e *EventReport) ReportVMActivity(activity *VMActivity) error
```

#### 1.4 移除 taskflow 侧 TTL 逻辑

现有 `CreateVirtualMachineReq` 中的 TTL 字段传递给 agent 用于管理 VM 生命周期。移除后：
- taskflow 创建 VM 时不再传递 TTL 参数，统一由 MonkeyCode 侧空闲检测管理生命周期
- taskflow `types.TTL` / `types.TTLKind` 类型保留但不再使用，后续可清理
- agent 侧 proto 中的 `AgentTTL` 字段保持兼容，创建时传 `TTLForever`

### 2. MonkeyCode 侧改动

#### 2.1 VmIdleInfo 数据结构

```go
// domain/host.go
type VmIdleInfo struct {
    UID    uuid.UUID `json:"uid"`
    VmID   string    `json:"vm_id"`
    HostID string    `json:"host_id"`
    EnvID  string    `json:"env_id"`
    TaskID string    `json:"task_id"`   // 关联的任务 ID，用于通知
    Name   string    `json:"name"`      // 任务名称，用于通知内容
}
```

**关键改动**：由于手动创建的 VM 保留原有 TTL 逻辑，任务创建的 VM 使用空闲检测策略，因此需要：
1. 在 `RefreshIdleTimers` 中增加判断：只有通过 `TaskVirtualMachine` 关联表关联到任务的 VM 才入队空闲队列
2. 判断方式：查询 `TaskVirtualMachine` 表，若存在记录则为任务创建的 VM

#### 2.2 新增三个 DelayQueue

```go
type HostUsecase struct {
    // ... 现有字段（移除 vmexpireQueue）
    vmSleepQueue   *delayqueue.RedisDelayQueue[*domain.VmIdleInfo]
    vmNotifyQueue  *delayqueue.RedisDelayQueue[*domain.VmIdleInfo]
    vmRecycleQueue *delayqueue.RedisDelayQueue[*domain.VmIdleInfo]
}
```

注意 jobTTL 配置：
- `vmSleepQueue`：默认 jobTTL（7 天）即可
- `vmNotifyQueue`：`WithJobTTL(8 * 24 * time.Hour)`，确保 payload 存活超过 6d23h 延迟
- `vmRecycleQueue`：`WithJobTTL(8 * 24 * time.Hour)`，确保 payload 存活超过 7d 延迟

#### 2.3 刷新计时器（含去抖）

高频 TaskStream 消息场景下，每条消息触发 `RefreshIdleTimers` 会产生 6 次 Redis 操作。通过 Redis key 去抖，同一 VM 在 30 秒内只刷新一次：

```go
func (h *HostUsecase) RefreshIdleTimers(ctx context.Context, vmID string, payload *domain.VmIdleInfo) {
    // 去抖：30 秒内同一 VM 只刷新一次
    debounceKey := fmt.Sprintf("vm:idle:debounce:%s", vmID)
    if ok, _ := h.redis.SetNX(ctx, debounceKey, "1", 30*time.Second).Result(); !ok {
        return // 30 秒内已刷新过
    }

    now := time.Now()
    h.vmSleepQueue.Enqueue(ctx, SLEEP_KEY, payload, now.Add(10*time.Minute), vmID)
    h.vmNotifyQueue.Enqueue(ctx, NOTIFY_KEY, payload, now.Add(7*24*time.Hour - 1*time.Hour), vmID)
    h.vmRecycleQueue.Enqueue(ctx, RECYCLE_KEY, payload, now.Add(7*24*time.Hour), vmID)
}
```

活跃事件的两个来源都调用 `RefreshIdleTimers`：
1. taskflow EventReport 上报 VMActivity 事件
2. MonkeyCode 收到用户 VM 相关请求（终端连接、文件操作等）

#### 2.3 三个消费者

| 队列 | 触发时机 | 行为 |
|------|---------|------|
| `vmSleepQueue` | 10 分钟无活动 | 标记 VM 状态为 `sleeping`（后续对接 agent 休眠 gRPC 接口） |
| `vmNotifyQueue` | 6 天 23 小时无活动 | 发送回收预警通知（以任务维度呈现） |
| `vmRecycleQueue` | 7 天无活动 | 删除 VM、任务状态等全部资源 |

#### 2.6 VM 状态扩展

新增状态 `sleeping`，需要在两侧同步定义：

```go
// MonkeyCode: pkg/taskflow/types.go（MonkeyCode 的 taskflow client 包）
const (
    VirtualMachineStatusSleeping VirtualMachineStatus = "sleeping"
)

// taskflow: types/orchestrator.go
const (
    VirtualMachineStatusSleeping VirtualMachineStatus = "sleeping"
)
```

#### 2.7 休眠后唤醒流程（Phase 2，当前仅标记状态）

> 注意：agent 侧的休眠/唤醒 gRPC 接口尚未实现。当前阶段仅做状态标记，
> 后续 Phase 2 需要定义 proto 接口（如 `SleepEnvironment` / `WakeEnvironment`）
> 并在 taskflow 侧实现路由到对应 VM 的 agent。

```
用户发起 VM 请求（如连接终端）
  │
  ▼
MonkeyCode 检查 VM 状态
  │
  ├─ 状态 = sleeping
  │    ├─ [Phase 2] 调用 agent 唤醒接口
  │    ├─ [当前] 标记状态为 online
  │    └─ RefreshIdleTimers()
  │
  └─ 状态 = online
       └─ RefreshIdleTimers()
```

### 3. 移除旧 TTL 机制

| 文件 | 改动 |
|------|------|
| `HostUsecase.periodicEnqueueVm()` | 删除 |
| `HostUsecase.vmexpireConsumer()` | 删除，由三个新消费者替代 |
| `HostUsecase.CreateVM()` | 移除 TTL 逻辑和 vmexpireQueue，改为 RefreshIdleTimers |
| `HostUsecase.UpdateVM()` | 移除 vmexpireQueue 更新逻辑 |
| `HostUsecase.DeleteVM()` | 移除 vmexpireQueue 清理，改为清理三个新队列 |
| `HostUsecase.FireExpiredVM()` | 删除 |
| `HostUsecase.EnqueueAllCountDownVM()` | 删除 |
| `vmexpireQueue` 字段 | 删除 |
| `CreateVirtualMachineReq.TTL` | 移除 |

### 4. 通知机制

- 通知以任务维度呈现，用户不需要关心开发环境
- 通知内容示例："你的任务 XXX 由于长时间未活动，将在 1 小时后被清理"
- 通过现有 Notify 模块发送

### 5. 边界情况

| 场景 | 处理方式 |
|------|---------|
| 通知发出后用户活跃了 | 三个队列 score 刷新，recycle 不会触发 |
| 通知发出后用户未活跃 | 1 小时后 recycle 触发，正常回收 |
| VM 已休眠，用户再次访问 | 唤醒 VM + 刷新三个队列 |
| VM 已休眠，7 天无活动 | recycle 触发，直接回收（无需先唤醒） |
| VM 被手动删除 | DeleteVM 中清理三个队列 |
| taskflow 重启 | MonkeyCode 侧队列在 Redis 中持久化，不受影响 |
| MonkeyCode 重启 | 消费者重新启动，继续消费 Redis 中的队列 |
| MonkeyCode 多实例部署 | DelayQueue 的 claimScript 是 Redis Lua 原子操作，同一 job 不会被多实例重复 claim，多实例安全 |
| 去抖窗口内的活跃事件 | 30 秒去抖窗口内的后续活跃事件不会刷新队列，最大误差 30 秒，对 10 分钟/7 天阈值可忽略 |

## 涉及项目

- **MonkeyCode** (`/Users/yoko/chaitin/ai/MonkeyCode/backend`)：服务端，DelayQueue 消费、状态管理、通知
- **taskflow** (`/Users/yoko/chaitin/ai/taskflow`)：TaskStream 活动监控、EventReport 上报
