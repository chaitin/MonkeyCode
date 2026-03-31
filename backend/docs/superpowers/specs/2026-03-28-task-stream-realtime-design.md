# Task Stream 实时流改造设计

## 背景

当前 stream 接口（`mode=new` 和 `mode=attach`）都从 loki 读取任务日志数据。loki 中的数据经过 aggregator 聚合（合并连续同类型 chunk），存在延迟且丢失了原始粒度。

需求：
- `mode=new`：使用 taskflow 的实时数据流（原始未聚合的 TaskChunk），不再从 loki 读取
- `mode=attach`：从 loki 读历史 + 实时流拼接（任务运行中时）

## 架构概览

```
Agent (gRPC)
    ↓
taskflow taskRecv
    ├─ TaskLiveStream.Broadcast(chunk)  ← 新增：原始 chunk 实时广播
    ├─ aggregator.OnTaskRunning()       ← 不变：聚合后写 loki
    └─ EventReport (task-ended 等)      ← 不变

MonkeyCode backend (stream handler)
    ├─ mode=new:  订阅 TaskLiveStream 实时流
    └─ mode=attach: loki 历史 → flush aggregator → 订阅 TaskLiveStream
```

## 详细设计

### 1. taskflow 侧

#### 1.1 新建 TaskLiveStream

在 `connector.go` 中新增独立的 Stream，专门用于实时 TaskChunk 广播：

```go
// connector.go
type Connector struct {
    // ... 现有字段
    TaskLiveStream  *stream.Stream[struct{}, *types.TaskChunk]  // 新增
    taskAggregators sync.Map // map[string]*RoundAggregator
}

// NewConnector 中初始化：
TaskLiveStream: stream.NewStream[struct{}, *types.TaskChunk]("task-live"),
// 设置足够大的订阅缓冲区，避免高频 chunk 时丢消息
c.TaskLiveStream.SetSubBuffer(256)
```

`TaskLiveStream` 的 key 为 `taskID`（即 `token.SessionID`），与 `TaskStream` 的注册/注销生命周期一致。

#### 1.2 taskRecv 中广播原始 chunk

在 `task.go` 的 `taskRecv` 中，收到以下事件时，先 Broadcast 原始 chunk，再执行原有逻辑：

```go
case *agent.TaskRequest_TaskStarted:
    chunk := &types.TaskChunk{
        Event:     "task-started",
        Kind:      "acp_event",
        Timestamp: time.Now().UnixNano(),
    }
    a.connector.TaskLiveStream.Broadcast(token.SessionID, chunk)
    aggregator.OnTaskStarted(c.GetCtx())

case *agent.TaskRequest_TaskRunning:
    chunk := &types.TaskChunk{
        Data:      msg.TaskRunning.GetPayload(),
        Event:     "task-running",
        Kind:      msg.TaskRunning.Kind,
        Timestamp: time.Now().UnixNano(),
    }
    a.connector.TaskLiveStream.Broadcast(token.SessionID, chunk)
    aggregator.OnTaskRunning(c.GetCtx(), msg.TaskRunning.GetPayload(), msg.TaskRunning.Kind)

case *agent.TaskRequest_TaskEnded:
    chunk := &types.TaskChunk{
        Data:      []byte(msg.TaskEnded.Payload),
        Event:     "task-ended",
        Kind:      msg.TaskEnded.GetKind(),
        Timestamp: time.Now().UnixNano(),
    }
    a.connector.TaskLiveStream.Broadcast(token.SessionID, chunk)
    // ... 原有 loki 写入和 EventReport 逻辑不变

case *agent.TaskRequest_TaskError:
    chunk := &types.TaskChunk{
        Data:      []byte(msg.TaskError.Payload),
        Event:     "task-error",
        Kind:      msg.TaskError.Kind,
        Timestamp: time.Now().UnixNano(),
    }
    a.connector.TaskLiveStream.Broadcast(token.SessionID, chunk)
    // ... 原有逻辑不变
```

#### 1.3 新增 WebSocket 接口 `/internal/ws/task-live`

在 `server.go` 中新增 handler，供 MonkeyCode 订阅实时流：

请求参数：
- `id`: taskID（必填）
- `flush`: 是否在订阅前触发 aggregator flush（可选，默认 false）

流程：
1. 如果 `flush=true`，触发对应 task 的 aggregator flush
2. 调用 `TaskLiveStream.Subscribe(taskID)` 获取 Sub channel
3. 从 channel 读取 `*TaskChunk`，序列化为 JSON 写入 WebSocket
4. 连接关闭时 `UnSubscribe`

```go
func (s *ServerHandler) TaskLive(c *web.Context, req TaskLiveReq) error {
    conn, err := websocket.Accept(c.Response(), c.Request(), &websocket.AcceptOptions{})
    if err != nil {
        return err
    }
    defer conn.CloseNow()
    ctx := c.Request().Context()

    if req.Flush {
        s.connector.FlushTaskAggregator(ctx, req.ID)
    }

    sub, err := s.connector.TaskLiveStream.Subscribe(req.ID)
    if err != nil {
        return err
    }
    defer s.connector.TaskLiveStream.UnSubscribe(req.ID, sub.ID)

    for {
        select {
        case <-ctx.Done():
            return nil
        case chunk, ok := <-sub.Ch:
            if !ok {
                return nil
            }
            b, _ := json.Marshal(chunk)
            if err := conn.Write(ctx, websocket.MessageText, b); err != nil {
                return err
            }
        }
    }
}
```

#### 1.4 Aggregator flush 机制

需要让外部能触发指定 task 的 aggregator flush。方案：

在 connector 中维护一个 `taskID → *RoundAggregator` 的映射：

```go
// connector.go
type Connector struct {
    // ... 现有字段
    taskAggregators sync.Map // map[string]*RoundAggregator
}

func (c *Connector) RegisterTaskAggregator(taskID string, agg *RoundAggregator) {
    c.taskAggregators.Store(taskID, agg)
}

func (c *Connector) UnregisterTaskAggregator(taskID string) {
    c.taskAggregators.Delete(taskID)
}

func (c *Connector) FlushTaskAggregator(ctx context.Context, taskID string) {
    if v, ok := c.taskAggregators.Load(taskID); ok {
        v.(*RoundAggregator).Flush(ctx)
    }
}
```

在 `task.go` 的 `taskRecv` 中注册/注销 aggregator：

```go
aggregator := NewRoundAggregator(token.TaskID.String(), a.logger, a.loki)
a.connector.RegisterTaskAggregator(token.TaskID.String(), aggregator)
defer a.connector.UnregisterTaskAggregator(token.TaskID.String())
```

RoundAggregator 需要导出一个 `Flush()` 方法（当前 `flush()` 是小写的）：

```go
func (ra *RoundAggregator) Flush(ctx context.Context) {
    if ra.buffer.Len() > 0 {
        ra.flush(ctx)
    }
}
```

### 2. MonkeyCode 侧

#### 2.1 taskflow client 新增 TaskLive 方法

在 `pkg/taskflow/` 中新增接口和实现：

```go
// client.go - Clienter 接口新增
type Clienter interface {
    // ... 现有方法
    TaskLive(ctx context.Context, taskID string, flush bool, fn func(*TaskChunk) error) error
}
```

实现：连接 taskflow 的 `/internal/ws/task-live`，持续读取 TaskChunk 并回调。

#### 2.2 stream handler 改造

**mode=new 改造：**

`readClientMessages` 中，收到第一条 `user-input` 后，启动 `taskflow.TaskLive(taskID, false, ...)` 订阅实时流，替代原来的 `tailLogs`：

```go
if !realtimeStarted && m.Type == consts.TaskStreamTypeUserInput {
    realtimeStarted = true
    go h.subscribeRealtimeStream(ctx, cancel, wsConn, logger, task.ID.String())
}
```

`subscribeRealtimeStream` 调用 `taskflow.TaskLive(ctx, taskID, false, fn)` ，在回调中将 TaskChunk 转为 TaskStream 写入 WebSocket。

**mode=attach 改造：**

```go
// 1. 先订阅实时流（flush=true，触发 aggregator flush）
//    订阅后实时数据开始缓冲在 channel 中
// 2. 从 loki 读历史（聚合后的数据）
// 3. 如果 loki 中没有 task-ended，开始消费实时流 channel
```

关键：先订阅再读 loki，确保 flush 后的数据写入 loki，且订阅后的新数据不会丢失。

```go
func (h *TaskHandler) attachStream(ctx, cancel, wsConn, logger, task) {
    taskCreatedAt := time.Unix(task.CreatedAt, 0)
    tailStart := h.findTailStart(ctx, task.ID.String(), taskCreatedAt)
    hasMore := tailStart.After(taskCreatedAt)
    h.writeCursor(wsConn, tailStart, hasMore)

    // 步骤1：先订阅实时流（flush=true）
    liveCh, cleanup, err := h.taskflow.TaskLiveSubscribe(ctx, task.ID.String(), true)
    if err != nil {
        // 降级：仍然用 loki tail
        h.tailLogs(ctx, cancel, wsConn, logger, task.ID.String(), tailStart)
        return
    }
    defer cleanup()

    // 步骤2：从 loki 读历史
    ended := h.replayLokiHistory(ctx, wsConn, logger, task.ID.String(), tailStart)
    if ended {
        return
    }

    // 步骤3：消费实时流
    h.consumeLiveStream(ctx, cancel, wsConn, logger, liveCh)
}
```

#### 2.3 数据格式转换

实时流的 TaskChunk 转为前端 TaskStream：

```go
domain.TaskStream{
    Type:      consts.TaskStreamType(chunk.Event),  // "task-running", "task-started" 等
    Data:      chunk.Data,
    Kind:      chunk.Kind,
    Timestamp: chunk.Timestamp / 1e6,  // 纳秒 → 毫秒
}
```

注意：实时流的 event 是 `"task-running"`，而 loki 聚合后的 event 是 `"message"`。前端需要能处理这两种 event type，或者在转换时统一。

## 数据流对比

### mode=new（改造后）

```
用户输入 → MonkeyCode → taskflow (创建任务)
                ↓
MonkeyCode 订阅 /internal/ws/task-live?id=xxx&flush=false
                ↓
Agent 执行 → gRPC → taskflow taskRecv
                ├─ Broadcast 原始 chunk → WebSocket → MonkeyCode → 前端
                └─ aggregator → loki（后台存储，不影响实时推送）
```

### mode=attach（改造后）

```
MonkeyCode 订阅 /internal/ws/task-live?id=xxx&flush=true
    ↓ (触发 aggregator flush，实时数据开始缓冲)
MonkeyCode 从 loki 读历史（包含刚 flush 的数据）
    ↓ (如果没有 task-ended)
MonkeyCode 开始消费实时流缓冲
    ↓
Agent 继续执行 → 实时 chunk → MonkeyCode → 前端
```

## 改动清单

### taskflow 项目

| 文件 | 改动 |
|------|------|
| `types/task.go` | 无需改动，复用 `TaskChunk` |
| `internal/connector/connector.go` | 新增 `TaskLiveStream` 字段、aggregator 注册/flush 方法 |
| `internal/agent/handler/grpc/task.go` | taskRecv 中各事件增加 Broadcast；注册/注销 aggregator |
| `internal/agent/handler/grpc/aggregator.go` | 导出 `Flush()` 方法 |
| `internal/server/handler/v1/server.go` | 新增 `/internal/ws/task-live` handler |

### MonkeyCode 项目

| 文件 | 改动 |
|------|------|
| `pkg/taskflow/client.go` | Clienter 接口新增 `TaskLive` 方法 |
| `pkg/taskflow/task.go` (或新文件) | 实现 TaskLive WebSocket 客户端 |
| `biz/task/handler/v1/task.go` | stream handler 改造：new 模式用实时流，attach 模式拼接 |

## 降级策略

如果 taskflow 的 `/internal/ws/task-live` 连接失败（taskflow 版本不支持、网络问题等），降级回原来的 loki tail 模式，确保向后兼容。

## 注意事项

1. `TaskLiveStream` 的 SubBuffer 需要设置足够大（建议 256+），避免高频 chunk 时 Broadcast 丢消息
2. attach 模式的顺序必须是：先订阅 → flush → 读 loki → 消费实时流，否则 flush 到读 loki 之间的数据可能丢失
3. 实时流的 event type 是 `"task-running"`，loki 聚合后是 `"message"`，前端需兼容或后端统一转换
