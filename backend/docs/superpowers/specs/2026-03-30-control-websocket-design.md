# Control WebSocket 接口设计

## 背景

当前 stream 接口（`GET /api/v1/users/tasks/stream`）的生命周期绑定在 task 执行上：task 结束后连接断开。但 `call` / `call-response`（文件浏览、diff 查看等同步请求）需要在 task 结束后仍然可用。

需求：将 `call` / `call-response` 从 stream 接口迁移到一个独立的、长期保持的 WebSocket 控制接口。

## 设计决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 迁移动机 | stream 生命周期问题 | task 结束后仍需文件操作能力 |
| 控制连接生命周期 | 用户会话级别 | 页面开着就保持，刷新重连 |
| call 路由目标 | 仍路由到 taskflow（通过 taskID） | 后端处理逻辑不变 |
| 与 stream 的关系 | 完全独立 | 两条连接各自管理生命周期 |
| 端点参数 | 连接时带 taskId | `GET /api/v1/users/tasks/control?taskId=<uuid>` |
| 架构方案 | 独立 Handler（方案 A） | 完全解耦，不引入共享状态 |

## 架构概览

```
Frontend
    ├─ stream WS ──→ StreamHandler   (task 执行期间，task-ended 后断开)
    └─ control WS ─→ ControlHandler  (页面期间保持，task 结束不断开)
                          │
                          ├─ 读 call 消息 → HTTP 调 taskflow → 写 call-response
                          └─ ping 心跳
```

两条连接完全独立：
- stream 仍按原有逻辑运作（TaskLive 订阅、task-ended 断开）
- control 不订阅 TaskLive，不感知 task 轮次

## 详细设计

### 1. 端点

```
GET /api/v1/users/tasks/control?taskId=<uuid>
```

- 认证：复用现有 JWT 中间件
- 参数：`taskId` 必填
- 路由注册位置：`biz/task/handler/v1/task.go` 的 `Register()` 方法，与 `/stream`、`/rounds` 同级

### 2. 请求参数

新增 `TaskControlReq`，不复用 `TaskStreamReq`（后者带有无关的 `Mode` 字段）：

```go
// domain/task.go
type TaskControlReq struct {
    ID uuid.UUID `json:"id" query:"taskId" validate:"required"`
}
```

### 3. 消息协议

复用现有 `domain.TaskStream` 结构，不引入新的数据类型：

```go
type TaskStream struct {
    Type      consts.TaskStreamType `json:"type"`
    Data      []byte                `json:"data"`
    Kind      string                `json:"kind"`
    Timestamp int64                 `json:"timestamp"`
}
```

**上行（前端 → 服务端）：**

| Type | Kind | 说明 |
|------|------|------|
| `call` | `repo_file_changes` | 查询变更文件列表 |
| `call` | `repo_file_list` | 列出目录文件 |
| `call` | `repo_read_file` | 读取文件内容 |
| `call` | `repo_file_diff` | 获取文件 diff |
| `call` | `restart` | 重启任务（**无 call-response 返回**） |

**下行（服务端 → 前端）：**

| Type | Kind | 说明 |
|------|------|------|
| `call-response` | `repo_*` 系列 | 同步请求响应（`restart` 除外） |
| `call-response`（错误） | 同上 | taskflow 调用失败时返回错误信息 |
| `ping` | — | 心跳 |

**注意**：`restart` 是一个特殊的 fire-and-forget 调用，不返回 `call-response`。这是从现有 stream handler 继承的行为。

### 4. 文件组织

```
biz/task/handler/v1/
├── task.go             // 现有，移除 call 处理
├── task_control.go     // 新增，Control() handler
```

新文件 `task_control.go` 挂在现有 `TaskHandler` struct 上，复用 `h.taskflow`、`h.logger` 等依赖。

### 5. Control Handler 实现

```go
func (h *TaskHandler) Control(c *web.Context, req domain.TaskControlReq) error {
    // 1. 获取当前用户
    // 2. 验证 task 归属（调用 h.usecase.Info()）
    //    ↑ 必须在 ws.Accept() 之前完成，失败直接返回 HTTP 错误
    // 3. ws.Accept() 升级连接
    // 4. 注册到 ControlConn 连接池
    // 5. 使用 errgroup.WithContext 启动协程组：
    //    a. ping()          — 心跳保活
    //    b. readMessages()  — 读取 call → HTTP 调 taskflow → 写回 call-response
    //    任意协程返回 error → errgroup cancel context → 另一个协程退出
    // 6. 等待 errgroup.Wait() → 从连接池移除 → 关闭连接
}
```

**关键点**：task 归属验证必须在 `ws.Accept()` 之前执行。先升级再校验会导致非法连接占用资源。这与现有 stream handler 的做法一致。

#### 5.1 readMessages

从 stream handler 的 `handleSyncCall()` **迁移**（move，非 copy），逻辑调整如下：

```
循环读取前端消息 →
  解析为 TaskStream
  if Type != "call" → 忽略
  if Kind == "restart" → 调用 taskflow.TaskManager().Restart()，无响应
  else → 根据 Kind 调用对应 taskflow HTTP 接口：
    "repo_file_diff"    → h.taskflow.TaskManager().FileDiff()
    "repo_file_list"    → h.taskflow.TaskManager().ListFiles()
    "repo_read_file"    → h.taskflow.TaskManager().ReadFile()
    "repo_file_changes" → h.taskflow.TaskManager().FileChanges()
  → 成功：将结果序列化，写回 call-response
  → 失败：写回错误 call-response（见下方错误处理）
```

#### 5.2 错误处理

现有 stream handler 中，taskflow 调用失败时静默丢弃（仅日志）。在长生命周期的控制连接上，这会导致前端无限等待。

改进：taskflow 调用失败时，返回一条错误 `call-response`：

```go
if err != nil {
    logger.With("error", err, "kind", m.Kind).WarnContext(ctx, "sync call failed")
    errData, _ := json.Marshal(map[string]string{"error": err.Error()})
    wsConn.WriteJSON(domain.TaskStream{
        Type:      consts.TaskStreamTypeCallResponse,
        Data:      errData,
        Kind:      m.Kind,
        Timestamp: time.Now().UnixMilli(),
    })
    return
}
```

#### 5.3 ping

复用现有 `ping()` 逻辑，定期发送 `TaskStreamTypePing` 消息保持连接。

### 6. 连接管理

在 `pkg/ws/ws.go` 中新增 `ControlConn`。

由于用户可能在多个浏览器 tab 打开同一个 task，ControlConn 需要支持同一 taskID 的多个并发连接，使用 slice 而非单值：

```go
type ControlConn struct {
    conns map[string][]*WebsocketManager  // key: taskID
    mu    sync.RWMutex
}

func NewControlConn() *ControlConn { ... }
func (cc *ControlConn) Add(id string, conn *WebsocketManager) { ... }     // append 到 slice
func (cc *ControlConn) Remove(id string, conn *WebsocketManager) { ... }  // 从 slice 中移除特定连接
func (cc *ControlConn) Get(id string) ([]*WebsocketManager, bool) { ... } // 返回所有连接
```

`ControlConn` 实例通过 DI 注入到 `TaskHandler`，与现有 `TaskConn` 并列。

### 7. 对 Stream Handler 的改动

在 `handleClientMessage()` 中**移除** `TaskStreamTypeCall` 分支：

```go
// 删除以下两行：
case consts.TaskStreamTypeCall:
    h.handleSyncCall(ctx, wsConn, logger, task, m)
```

`handleSyncCall()` 函数从 `task.go` 中**删除**，迁移到 `task_control.go`（同时加入错误响应逻辑）。

stream handler 的其他逻辑（TaskLive 订阅、mode=new/attach、user-input/user-stop 等）完全不变。

## 改动清单

| 文件 | 改动 |
|------|------|
| `biz/task/handler/v1/task_control.go` | **新增**：`Control()` handler、`readMessages()`、`handleSyncCall()`（含错误响应） |
| `biz/task/handler/v1/task.go` | `Register()` 新增 `/control` 路由；`handleClientMessage()` 移除 call 分支；**删除** `handleSyncCall()` 函数 |
| `pkg/ws/ws.go` | 新增 `ControlConn` 类型（支持多连接） |
| `pkg/register.go` | 新增 `ControlConn` 的 DI 注册（`do.Provide`） |
| `domain/task.go` | 新增 `TaskControlReq` 结构体 |
| `consts/task.go` | 无改动（复用 `TaskStreamTypeCall`、`TaskStreamTypeCallResponse`） |

## 连接生命周期对比

```
时间线：  ──────────────────────────────────────────→

用户打开 task 页面
          │
          ├─ control WS 建立 ─────────────────────── control WS 保持 ──→ 用户离开页面，断开
          │
          ├─ 用户发起 task
          │   ├─ stream WS 建立 ── task 执行中 ── task-ended ── stream WS 断开
          │   │
          │   └─ (control WS 不受影响，call 仍可用)
          │
          ├─ 用户再次发起 task
          │   ├─ stream WS 建立 ── task 执行中 ── task-ended ── stream WS 断开
          │   │
          │   └─ (control WS 仍保持)
```

## 未来扩展

当 `file-change` 事件在 Agent 侧实现后，在 control handler 中新增 `subscribeLoop()` 协程：

```
subscribeLoop:
  for {
      订阅 taskflow TaskLive(taskID)
      for chunk := range chunks {
          if chunk.Event == "file-change" → 写到 control 连接
          else → 跳过
      }
      // TaskLive 断开不退出，等待后重新订阅
      select {
      case <-ctx.Done(): return
      case <-time.After(重连间隔): continue
      }
  }
```

这不在本次实现范围内。
