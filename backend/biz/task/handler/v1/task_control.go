package v1

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"golang.org/x/sync/errgroup"

	"github.com/GoYoko/web"
	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/biz/task/service"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/middleware"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
	"github.com/chaitin/MonkeyCode/backend/pkg/ws"
)

// Control 任务控制流 WebSocket 端点
//
//	@Summary		任务控制流 WebSocket
//	@Description	数据格式约定：当前仅支持文本帧透传。服务端将 Agent 的原始文本数据包装为如下结构返回给前端（对应 domain.TaskStream）：
//	@Description	```json
//	@Description	{ "type": "string", "data": "string", "kind": "string", "timestamp": 0 }
//	@Description	```
//	@Description	独立于 stream 的长生命周期 WebSocket 连接，用于处理 call/call-response（文件浏览、diff 查看等同步请求）。
//	@Description	task 结束后连接不断开，仍可用于文件操作。
//	@Description	支持同一 taskID 多 tab 并发连接。
//	@Description
//	@Description	## 上行消息
//	@Description
//	@Description	### Type=call, Kind=repo_file_diff — 获取文件 diff
//	@Description	请求 Data:
//	@Description	```json
//	@Description	{"request_id":"string","path":"string","unified":true,"context_lines":3}
//	@Description	```
//	@Description	响应 Data:
//	@Description	```json
//	@Description	{"request_id":"string","path":"string","diff":"string","success":true,"error":"string?"}
//	@Description	```
//	@Description
//	@Description	### Type=call, Kind=repo_file_list — 列出目录文件
//	@Description	请求 Data:
//	@Description	```json
//	@Description	{"request_id":"string","path":"string","glob_pattern":"string?","include_hidden":false}
//	@Description	```
//	@Description	响应 Data:
//	@Description	```json
//	@Description	{"request_id":"string","path":"string","files":[{"name":"string","path":"string","entry_mode":0,"size":0,"modified_at":0}],"success":true,"error":"string?"}
//	@Description	```
//	@Description
//	@Description	### Type=call, Kind=repo_read_file — 读取文件内容
//	@Description	请求 Data:
//	@Description	```json
//	@Description	{"request_id":"string","path":"string","offset":0,"length":0}
//	@Description	```
//	@Description	响应 Data:
//	@Description	```json
//	@Description	{"request_id":"string","path":"string","content":"bytes","total_size":0,"offset":0,"length":0,"is_truncated":false,"success":true,"error":"string?"}
//	@Description	```
//	@Description
//	@Description	### Type=call, Kind=repo_file_changes — 查询变更文件列表
//	@Description	请求 Data:
//	@Description	```json
//	@Description	{"request_id":"string"}
//	@Description	```
//	@Description	响应 Data:
//	@Description	```json
//	@Description	{"request_id":"string","changes":[{"path":"string","status":"string","additions":0,"deletions":0,"old_path":"string?"}],"branch":"string?","commit_hash":"string?","success":true,"error":"string?"}
//	@Description	```
//	@Description
//	@Description	### Type=call, Kind=port_forward_list — 获取端口转发列表
//	@Description	请求 Data:
//	@Description	```json
//	@Description	{"request_id":"string"}
//	@Description	```
//	@Description	响应 Data:
//	@Description	```json
//	@Description	{"request_id":"string","ports":[{"port":0,"status":"string","process":"string","forward_id":"string?","access_url":"string?","label":"string?","error_message":"string?","whitelist_ips":["string"]}]}
//	@Description	```
//	@Description
//	@Description	### Type=call, Kind=restart — 重启任务
//	@Description	请求 Data:
//	@Description	```json
//	@Description	{"request_id":"string","load_session":true}
//	@Description	```
//	@Description	响应 Data:
//	@Description	```json
//	@Description	{"id":"uuid","request_id":"string?","success":true,"message":"string","session_id":"string"}
//	@Description	```
//	@Description
//	@Description	### Type=sync-my-ip — 同步 Web 客户端真实 IP
//	@Description	请求 Data:
//	@Description	```json
//	@Description	{"client_ip":"string"}
//	@Description	```
//	@Description
//	@Description	## 下行消息
//	@Description
//	@Description	- Type=call-response: 同步请求响应（Kind 与请求一致）。失败时 Data 为:
//	@Description	```json
//	@Description	{"request_id":"string","success":false,"error":"string"}
//	@Description	```
//	@Description	- Type=task-event: 任务事件（从 TaskLive 订阅转发）
//	@Description	- Type=ping: 心跳（无 Data）
//	@Tags			【用户】任务管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			id	query		string		true	"任务 ID"
//	@Success		200	{object}	web.Resp{}	"成功"
//	@Failure		500	{object}	web.Resp	"服务器内部错误"
//	@Router			/api/v1/users/tasks/control [get]
func (h *TaskHandler) Control(c *web.Context, req domain.TaskControlReq) error {
	user := middleware.GetUser(c)

	task, _, err := h.usecase.Info(c.Request().Context(), user, req.ID)
	if err != nil {
		return err
	}

	wsConn, err := ws.Accept(c.Response().Writer, c.Request())
	if err != nil {
		h.logger.ErrorContext(c.Request().Context(), "failed to upgrade control websocket", "error", err)
		return err
	}
	defer wsConn.Close()

	logger := h.logger.With("task_id", task.ID, "fn", "task.control")
	taskID := task.ID.String()
	if err := h.taskActivity.Refresh(c.Request().Context(), task.ID); err != nil {
		logger.WarnContext(c.Request().Context(), "failed to refresh task last active on control connect", "error", err)
	}

	// 连接建立：刷新空闲计时器
	if vm := task.VirtualMachine; vm != nil {
		if err := h.idleRefresher.Refresh(c.Request().Context(), vm.ID); err != nil {
			logger.WarnContext(c.Request().Context(), "failed to refresh idle timers on connect", "error", err)
		}

		// VM 处于休眠状态时自动恢复
		if vm.Status == taskflow.VirtualMachineStatusHibernated {
			go func() {
				if err := h.taskflow.VirtualMachiner().Resume(c.Request().Context(), &taskflow.ResumeVirtualMachineReq{
					HostID:        vm.Host.InternalID,
					UserID:        task.UserID.String(),
					ID:            vm.ID,
					EnvironmentID: vm.EnvironmentID,
				}); err != nil {
					logger.WarnContext(context.Background(), "failed to resume vm on control connect", "error", err)
				}
			}()
		}
	}

	h.controlConns.Add(taskID, wsConn)
	defer func() {
		h.controlConns.Remove(taskID, wsConn)
		// 最后一个连接断开：刷新计时器（开始空闲倒计时）
		if vm := task.VirtualMachine; vm != nil && !h.controlConns.Has(taskID) {
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			if err := h.idleRefresher.Refresh(ctx, vm.ID); err != nil {
				logger.WarnContext(ctx, "failed to refresh idle timers on disconnect", "error", err)
			}
		}
	}()

	g, ctx := errgroup.WithContext(c.Request().Context())

	g.Go(func() error {
		return h.controlPing(ctx, wsConn, taskID)
	})

	g.Go(func() error {
		return h.controlReadMessages(ctx, wsConn, logger, task)
	})

	g.Go(func() error {
		return h.controlSubscribeTaskEvents(ctx, wsConn, logger, taskID)
	})

	// 定期刷新空闲计时器，保持 VM 活跃
	if vm := task.VirtualMachine; vm != nil {
		g.Go(func() error {
			return h.controlKeepAlive(ctx, task.ID, vm.ID)
		})
	}

	if err := g.Wait(); err != nil {
		logger.DebugContext(c.Request().Context(), "control websocket closed", "reason", err)
	}
	return nil
}

// controlPing 定期发送心跳保活
func (h *TaskHandler) controlPing(ctx context.Context, wsConn *ws.WebsocketManager, taskID string) error {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if err := wsConn.WriteJSON(domain.TaskStream{
				Type: consts.TaskStreamTypePing,
			}); err != nil {
				return fmt.Errorf("control ping failed: %w", err)
			}
		}
	}
}

// controlKeepAlive 定期刷新空闲计时器，防止 VM 被误判空闲
func (h *TaskHandler) controlKeepAlive(ctx context.Context, taskID uuid.UUID, vmID string) error {
	if err := h.idleRefresher.Refresh(ctx, vmID); err != nil {
		h.logger.WarnContext(ctx, "keepalive refresh failed", "vmID", vmID, "error", err)
	}
	if err := h.taskActivity.Refresh(ctx, taskID); err != nil {
		h.logger.WarnContext(ctx, "task activity refresh failed", "taskID", taskID, "error", err)
	}

	idleTicker := time.NewTicker(1 * time.Minute)
	activityTicker := time.NewTicker(service.TaskActivityRefreshInterval)
	defer idleTicker.Stop()
	defer activityTicker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-idleTicker.C:
			if err := h.idleRefresher.Refresh(ctx, vmID); err != nil {
				h.logger.WarnContext(ctx, "keepalive refresh failed", "vmID", vmID, "error", err)
			}
		case <-activityTicker.C:
			if err := h.taskActivity.Refresh(ctx, taskID); err != nil {
				h.logger.WarnContext(ctx, "task activity refresh failed", "taskID", taskID, "error", err)
			}
		}
	}
}

// controlReadMessages 读取客户端消息并分发处理
func (h *TaskHandler) controlReadMessages(ctx context.Context, wsConn *ws.WebsocketManager, logger *slog.Logger, task *domain.Task) error {
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		d, err := wsConn.ReadMessage()
		if err != nil {
			return fmt.Errorf("control read failed: %w", err)
		}

		var m domain.TaskStream
		if err := json.Unmarshal(d, &m); err != nil {
			logger.WarnContext(ctx, "failed to unmarshal control message", "error", err, "data", string(d))
			continue
		}
		h.logger.With("task req", m, "task_id", task.ID).DebugContext(ctx, "recv task message")

		switch m.Type {
		case consts.TaskStreamTypeCall:
			h.handleControlCall(ctx, wsConn, logger, task, m)
		case consts.TaskStreamTypeSyncWebClientIP:
			h.handleSyncClientIP(ctx, wsConn, logger, m.Data)
		}
	}
}

// handleControlCall 处理 call 消息，调用 taskflow HTTP 接口并写回响应
func (h *TaskHandler) handleControlCall(ctx context.Context, wsConn *ws.WebsocketManager, logger *slog.Logger, task *domain.Task, m domain.TaskStream) {
	taskID := task.ID.String()

	var result any
	var err error
	var requestID string

	switch m.Kind {
	case "repo_file_diff":
		var req taskflow.RepoFileDiffReq
		if err := json.Unmarshal(m.Data, &req); err != nil {
			logger.WarnContext(ctx, "failed to unmarshal request", "error", err)
			return
		}
		req.TaskId = taskID
		requestID = req.RequestId
		result, err = h.taskflow.TaskManager().FileDiff(ctx, req)

	case "repo_file_list":
		var req taskflow.RepoListFilesReq
		if err := json.Unmarshal(m.Data, &req); err != nil {
			logger.WarnContext(ctx, "failed to unmarshal request", "error", err)
			return
		}
		req.TaskId = taskID
		requestID = req.RequestId
		result, err = h.taskflow.TaskManager().ListFiles(ctx, req)

	case "repo_read_file":
		var req taskflow.RepoReadFileReq
		if err := json.Unmarshal(m.Data, &req); err != nil {
			logger.WarnContext(ctx, "failed to unmarshal request", "error", err)
			return
		}
		req.TaskId = taskID
		requestID = req.RequestId
		result, err = h.taskflow.TaskManager().ReadFile(ctx, req)

	case "repo_file_changes":
		var req taskflow.RepoFileChangesReq
		if err := json.Unmarshal(m.Data, &req); err != nil {
			logger.WarnContext(ctx, "failed to unmarshal request", "error", err)
			return
		}
		req.TaskId = taskID
		requestID = req.RequestId
		result, err = h.taskflow.TaskManager().FileChanges(ctx, req)

	case "port_forward_list":
		var req taskflow.ListPortforwadReq
		if err := json.Unmarshal(m.Data, &req); err != nil {
			logger.WarnContext(ctx, "failed to unmarshal request", "error", err)
			return
		}
		req.ID = task.VirtualMachine.ID
		requestID = req.RequestId
		result, err = h.taskflow.PortForwarder().List(ctx, req)

	case "restart":
		var req taskflow.RestartTaskReq
		if err := json.Unmarshal(m.Data, &req); err != nil {
			logger.WarnContext(ctx, "failed to unmarshal restart task", "error", err)
			return
		}
		req.ID = task.ID
		requestID = req.RequestId
		result, err = h.taskflow.TaskManager().Restart(ctx, req)

	default:
		return
	}

	if err != nil {
		logger.WarnContext(ctx, "control call failed", "error", err, "kind", m.Kind)
		errData, _ := json.Marshal(map[string]any{
			"request_id": requestID,
			"success":    false,
			"error":      err.Error(),
		})
		wsConn.WriteJSON(domain.TaskStream{
			Type:      consts.TaskStreamTypeCallResponse,
			Data:      errData,
			Kind:      m.Kind,
			Timestamp: time.Now().UnixMilli(),
		})
		return
	}

	b, err := json.Marshal(result)
	if err != nil {
		logger.WarnContext(ctx, "failed to marshal control response", "error", err, "kind", m.Kind)
		return
	}

	if err := wsConn.WriteJSON(domain.TaskStream{
		Type:      consts.TaskStreamTypeCallResponse,
		Data:      b,
		Timestamp: time.Now().UnixMilli(),
		Kind:      m.Kind,
	}); err != nil {
		logger.WarnContext(ctx, "failed to write control response", "error", err, "kind", m.Kind)
	}
}

// controlSubscribeTaskEvents 订阅 TaskLive，转发 task-event 事件到 control 连接。
// TaskLive 断开后自动重连，直到 ctx 取消。
func (h *TaskHandler) controlSubscribeTaskEvents(ctx context.Context, wsConn *ws.WebsocketManager, logger *slog.Logger, taskID string) error {
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		err := h.taskflow.TaskLive(ctx, taskID, false, func(chunk *taskflow.TaskChunk) error {
			if chunk.Event != "task-event" {
				return nil
			}
			return wsConn.WriteJSON(domain.TaskStream{
				Type:      consts.TaskStreamTypeTaskEvent,
				Data:      chunk.Data,
				Kind:      chunk.Kind,
				Timestamp: chunk.Timestamp / 1e6,
			})
		})

		if ctx.Err() != nil {
			return ctx.Err()
		}

		logger.WarnContext(ctx, "control task-event subscription disconnected, reconnecting", "error", err)
		time.Sleep(2 * time.Second)
	}
}
