# Control WebSocket 接口实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 call/call-response 从 task-bound stream WS 迁移到独立的、长生命周期的 control WS，使文件操作在 task 结束后仍可用。

**Architecture:** 新增 `GET /api/v1/users/tasks/control?taskId=<uuid>` 端点，独立于 stream WS。Control handler 挂在现有 `TaskHandler` 上，使用 errgroup 管理 ping + readMessages 两个协程。`ControlConn` 连接池支持同一 taskID 多 tab 并发。

**Tech Stack:** Go 1.25, coder/websocket, golang.org/x/sync/errgroup, GoYoko/web, samber/do (DI)

**Spec:** `docs/superpowers/specs/2026-03-30-control-websocket-design.md`

---

### Task 1: 新增 ControlConn 连接池

**Files:**
- Modify: `pkg/ws/ws.go` (在文件末尾 TaskConn 下方添加)

- [ ] **Step 1: 在 `pkg/ws/ws.go` 末尾新增 ControlConn 类型**

在文件末尾添加：

```go
// ControlConn 控制 WebSocket 连接池，支持同一 taskID 多个并发连接
type ControlConn struct {
	conns map[string][]*WebsocketManager
	mu    sync.RWMutex
}

// NewControlConn 创建控制连接池
func NewControlConn() *ControlConn {
	return &ControlConn{
		conns: make(map[string][]*WebsocketManager),
	}
}

// Add 添加连接
func (cc *ControlConn) Add(id string, conn *WebsocketManager) {
	cc.mu.Lock()
	defer cc.mu.Unlock()
	cc.conns[id] = append(cc.conns[id], conn)
}

// Remove 移除特定连接
func (cc *ControlConn) Remove(id string, conn *WebsocketManager) {
	cc.mu.Lock()
	defer cc.mu.Unlock()
	conns := cc.conns[id]
	for i, c := range conns {
		if c == conn {
			cc.conns[id] = append(conns[:i], conns[i+1:]...)
			break
		}
	}
	if len(cc.conns[id]) == 0 {
		delete(cc.conns, id)
	}
}

// Get 获取指定 taskID 的所有连接
func (cc *ControlConn) Get(id string) ([]*WebsocketManager, bool) {
	cc.mu.RLock()
	defer cc.mu.RUnlock()
	conns, ok := cc.conns[id]
	return conns, ok
}
```

- [ ] **Step 2: 验证编译通过**

Run: `go build ./pkg/ws/...`
Expected: 编译成功，无错误

- [ ] **Step 3: Commit**

```bash
git add pkg/ws/ws.go
git commit -m "feat(ws): add ControlConn connection pool for multi-tab support"
```

---

### Task 2: DI 注册 ControlConn

**Files:**
- Modify: `pkg/register.go` (在 TaskConn 注册下方添加)

- [ ] **Step 1: 在 `pkg/register.go` 的 TaskConn 注册之后添加 ControlConn 注册**

搜索 `ws.NewTaskConn()` 所在的 `do.Provide` 块，在其后添加：

```go
	// WebSocket ControlConn
	do.Provide(i, func(i *do.Injector) (*ws.ControlConn, error) {
		return ws.NewControlConn(), nil
	})
```

- [ ] **Step 2: 验证编译通过**

Run: `go build ./pkg/...`
Expected: 编译成功

- [ ] **Step 3: Commit**

```bash
git add pkg/register.go
git commit -m "feat(register): add ControlConn DI registration"
```

---

### Task 3: 新增 TaskControlReq

**Files:**
- Modify: `domain/task.go` (在 TaskStreamReq 之后添加)

- [ ] **Step 1: 在 `domain/task.go` 的 `TaskStreamReq` 定义之后添加 `TaskControlReq`**

搜索 `TaskStreamReq` struct 的闭合花括号，在其后添加：

```go

// TaskControlReq 控制 WebSocket 请求
type TaskControlReq struct {
	ID uuid.UUID `json:"id" query:"taskId" validate:"required"`
}
```

- [ ] **Step 2: 验证编译通过**

Run: `go build ./domain/...`
Expected: 编译成功

- [ ] **Step 3: Commit**

```bash
git add domain/task.go
git commit -m "feat(domain): add TaskControlReq for control WebSocket endpoint"
```

---

### Task 4: 实现 Control Handler 并注入到 TaskHandler

本任务合并了 TaskHandler 修改和 handler 创建，确保编译始终通过。

**Files:**
- Modify: `biz/task/handler/v1/task.go` (struct 字段、DI、路由注册)
- Create: `biz/task/handler/v1/task_control.go`

- [ ] **Step 1: 创建 `task_control.go` 文件**

```go
package v1

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/GoYoko/web"
	"golang.org/x/sync/errgroup"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/middleware"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
	"github.com/chaitin/MonkeyCode/backend/pkg/ws"
)

// Control 控制 WebSocket 接口
//
//	@Summary		控制 WebSocket
//	@Description	长生命周期的 WebSocket 连接，用于文件操作等同步请求。
//	@Description	生命周期绑定在用户会话上（页面打开期间保持），不随 task 执行结束而断开。
//	@Description	支持的消息类型：
//	@Description	- call: 同步请求（repo_file_changes, repo_file_list, repo_read_file, repo_file_diff, restart）
//	@Description	- call-response: 同步请求响应
//	@Description	- ping: 心跳
//	@Tags			【用户】任务管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			taskId	query		string		true	"任务 ID"
//	@Success		200		{object}	web.Resp{}	"成功"
//	@Failure		500		{object}	web.Resp	"服务器内部错误"
//	@Router			/api/v1/users/tasks/control [get]
func (h *TaskHandler) Control(c *web.Context, req domain.TaskControlReq) error {
	user := middleware.GetUser(c)
	task, _, err := h.usecase.Info(c.Request().Context(), user, req.ID)
	if err != nil {
		return err
	}

	logger := h.logger.With("task_id", task.ID, "fn", "task.control")

	wsConn, err := ws.Accept(c.Response().Writer, c.Request())
	if err != nil {
		logger.ErrorContext(c.Request().Context(), "failed to upgrade to websocket", "error", err)
		return err
	}
	defer wsConn.Close()

	taskID := task.ID.String()

	h.controlConns.Add(taskID, wsConn)
	defer h.controlConns.Remove(taskID, wsConn)

	ctx, cancel := context.WithCancelCause(c.Request().Context())
	defer cancel(fmt.Errorf("control close"))

	g, gctx := errgroup.WithContext(ctx)

	g.Go(func() error {
		h.controlPing(gctx, wsConn, taskID)
		return fmt.Errorf("ping stopped")
	})

	g.Go(func() error {
		return h.controlReadMessages(gctx, wsConn, logger, task)
	})

	_ = g.Wait()
	return nil
}

// controlPing 控制连接心跳
func (h *TaskHandler) controlPing(ctx context.Context, wsConn *ws.WebsocketManager, taskID string) {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := wsConn.WriteJSON(domain.TaskStream{
				Type: consts.TaskStreamTypePing,
			}); err != nil {
				h.logger.With("error", err, "task_id", taskID).Warn("failed to ping ws control")
				return
			}
		}
	}
}

// controlReadMessages 读取控制连接消息并处理 call 请求
func (h *TaskHandler) controlReadMessages(ctx context.Context, wsConn *ws.WebsocketManager, logger *slog.Logger, task *domain.Task) error {
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		d, err := wsConn.ReadMessage()
		if err != nil {
			return err
		}

		var m domain.TaskStream
		if err := json.Unmarshal(d, &m); err != nil {
			logger.With("error", err, "data", string(d)).WarnContext(ctx, "failed to unmarshal control message")
			continue
		}

		if m.Type != consts.TaskStreamTypeCall {
			continue
		}

		h.handleControlCall(ctx, wsConn, logger, task, m)
	}
}

// handleControlCall 处理控制连接的同步调用
func (h *TaskHandler) handleControlCall(ctx context.Context, wsConn *ws.WebsocketManager, logger *slog.Logger, task *domain.Task, m domain.TaskStream) {
	taskID := task.ID.String()

	if m.Kind == "restart" {
		var req taskflow.RestartTaskReq
		if err := json.Unmarshal(m.Data, &req); err != nil {
			logger.With("error", err).WarnContext(ctx, "failed to unmarshal restart task")
			return
		}
		req.ID = task.ID
		if err := h.taskflow.TaskManager().Restart(ctx, req); err != nil {
			logger.With("error", err).WarnContext(ctx, "failed to restart task")
		}
		return
	}

	var result any
	var err error

	switch m.Kind {
	case "repo_file_diff":
		var req taskflow.RepoFileDiffReq
		if err := json.Unmarshal(m.Data, &req); err != nil {
			logger.With("error", err).WarnContext(ctx, "failed to unmarshal request")
			return
		}
		req.TaskId = taskID
		result, err = h.taskflow.TaskManager().FileDiff(ctx, req)

	case "repo_file_list":
		var req taskflow.RepoListFilesReq
		if err := json.Unmarshal(m.Data, &req); err != nil {
			logger.With("error", err).WarnContext(ctx, "failed to unmarshal request")
			return
		}
		req.TaskId = taskID
		result, err = h.taskflow.TaskManager().ListFiles(ctx, req)

	case "repo_read_file":
		var req taskflow.RepoReadFileReq
		if err := json.Unmarshal(m.Data, &req); err != nil {
			logger.With("error", err).WarnContext(ctx, "failed to unmarshal request")
			return
		}
		req.TaskId = taskID
		result, err = h.taskflow.TaskManager().ReadFile(ctx, req)

	case "repo_file_changes":
		var req taskflow.RepoFileChangesReq
		if err := json.Unmarshal(m.Data, &req); err != nil {
			logger.With("error", err).WarnContext(ctx, "failed to unmarshal request")
			return
		}
		req.TaskId = taskID
		result, err = h.taskflow.TaskManager().FileChanges(ctx, req)

	default:
		return
	}

	if err != nil {
		logger.With("error", err, "kind", m.Kind).WarnContext(ctx, "control sync call failed")
		errData, _ := json.Marshal(map[string]string{"error": err.Error()})
		_ = wsConn.WriteJSON(domain.TaskStream{
			Type:      consts.TaskStreamTypeCallResponse,
			Data:      errData,
			Kind:      m.Kind,
			Timestamp: time.Now().UnixMilli(),
		})
		return
	}

	b, err := json.Marshal(result)
	if err != nil {
		logger.With("error", err, "kind", m.Kind).WarnContext(ctx, "failed to marshal response")
		return
	}

	if err := wsConn.WriteJSON(domain.TaskStream{
		Type:      consts.TaskStreamTypeCallResponse,
		Data:      b,
		Timestamp: time.Now().UnixMilli(),
		Kind:      m.Kind,
	}); err != nil {
		logger.With("error", err, "kind", m.Kind).WarnContext(ctx, "failed to write response to websocket")
	}
}
```

- [ ] **Step 2: 在 `task.go` 的 TaskHandler struct 中添加 controlConns 字段**

搜索 `taskConns *ws.TaskConn`，在其下方添加：

```go
	controlConns *ws.ControlConn
```

- [ ] **Step 3: 在 `task.go` 的 NewTaskHandler 中注入 ControlConn**

搜索 `tc := do.MustInvoke[*ws.TaskConn](i)`，在其下方添加：

```go
	cc := do.MustInvoke[*ws.ControlConn](i)
```

搜索 `taskConns:   tc,`，在其下方添加：

```go
		controlConns: cc,
```

- [ ] **Step 4: 在 `task.go` 的路由注册中添加 `/control` 端点**

搜索 `v1.GET("/rounds", web.BindHandler(h.TaskRounds))`，在其下方添加：

```go
	v1.GET("/control", web.BindHandler(h.Control))
```

- [ ] **Step 5: 验证编译通过**

Run: `go build ./biz/task/handler/...`
Expected: 编译成功

- [ ] **Step 6: Commit**

```bash
git add biz/task/handler/v1/task.go biz/task/handler/v1/task_control.go
git commit -m "feat(task): add Control WebSocket handler with call/call-response support"
```

---

### Task 5: 从 Stream Handler 移除 call 处理

**Files:**
- Modify: `biz/task/handler/v1/task.go`

- [ ] **Step 1: 在 `handleClientMessage()` 中删除 call 分支**

搜索 `handleClientMessage` 函数，删除以下两行：

```go
	case consts.TaskStreamTypeCall:
		h.handleSyncCall(ctx, wsConn, logger, task, m)
```

- [ ] **Step 2: 删除 `handleSyncCall()` 函数**

搜索 `func (h *TaskHandler) handleSyncCall`，删除整个函数（从函数签名到最后一个闭合花括号）。该函数已迁移到 `task_control.go` 中的 `handleControlCall`。

- [ ] **Step 3: 更新 Stream 端点的 Swagger 注释**

搜索 `Stream` 函数上方的 Swagger 注释块中关于 `call` 和 `call-response` 的 `@Description` 行，将其移除或标注已迁移到 `/control` 端点。

- [ ] **Step 4: 验证编译通过**

Run: `go build ./biz/task/handler/...`
Expected: 编译成功

- [ ] **Step 5: Commit**

```bash
git add biz/task/handler/v1/task.go
git commit -m "refactor(task): remove call handling from stream handler (moved to control WS)"
```

---

### Task 6: 验证与编译检查

**Files:** 无新增改动

- [ ] **Step 1: 完整编译整个项目**

Run: `go build ./...`
Expected: 编译成功，无错误

- [ ] **Step 2: 运行现有测试**

Run: `go test ./... -count=1 -short`
Expected: 所有测试通过（或与本次改动无关的已知失败）

- [ ] **Step 3: 检查 Swagger 文档生成（如有）**

Run: `swag init`（如果项目使用 swag）
Expected: 新的 `/control` 端点出现在生成的文档中

- [ ] **Step 4: Commit（如有 swagger 文件变更）**

```bash
git add docs/
git commit -m "docs: update swagger for control WebSocket endpoint"
```
