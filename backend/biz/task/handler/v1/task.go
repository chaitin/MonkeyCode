package v1

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/GoYoko/web"
	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/biz/task/service"
	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/middleware"
	"github.com/chaitin/MonkeyCode/backend/pkg/acp"
	"github.com/chaitin/MonkeyCode/backend/pkg/loki"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
	"github.com/chaitin/MonkeyCode/backend/pkg/ws"
)

// TaskHandler 任务处理器
type TaskHandler struct {
	cfg         *config.Config
	usecase     domain.TaskUsecase
	userusecase domain.UserUsecase
	pubhost     domain.PublicHostUsecase
	logger      *slog.Logger
	taskflow    taskflow.Clienter
	loki        *loki.Client
	taskConns   *ws.TaskConn
	taskSummary *service.TaskSummaryService
}

// NewTaskHandler 创建任务处理器
func NewTaskHandler(i *do.Injector) (*TaskHandler, error) {
	w := do.MustInvoke[*web.Web](i)
	cfg := do.MustInvoke[*config.Config](i)
	uc := do.MustInvoke[domain.TaskUsecase](i)
	uuc := do.MustInvoke[domain.UserUsecase](i)
	logger := do.MustInvoke[*slog.Logger](i)
	tf := do.MustInvoke[taskflow.Clienter](i)
	lok := do.MustInvoke[*loki.Client](i)
	auth := do.MustInvoke[*middleware.AuthMiddleware](i)
	tc := do.MustInvoke[*ws.TaskConn](i)
	ts := do.MustInvoke[*service.TaskSummaryService](i)

	// Optional deps
	var pubhost domain.PublicHostUsecase
	if ph, err := do.Invoke[domain.PublicHostUsecase](i); err == nil {
		pubhost = ph
	}

	h := &TaskHandler{
		cfg:         cfg,
		usecase:     uc,
		userusecase: uuc,
		pubhost:     pubhost,
		logger:      logger.With("handler", "task.handler"),
		taskflow:    tf,
		loki:        lok,
		taskConns:   tc,
		taskSummary: ts,
	}

	// 注册路由
	v1 := w.Group("/api/v1/users/tasks")

	v1.GET("/public-stream", web.BindHandler(h.PublicStream), auth.Check())

	v1.Use(auth.Auth())

	// 任务管理接口
	v1.GET("", web.BindHandler(h.List, web.WithPage()))
	v1.GET("/:id", web.BindHandler(h.Info))
	v1.GET("/stream", web.BindHandler(h.Stream))
	v1.POST("", web.BindHandler(h.Create))
	v1.PUT("/stop", web.BindHandler(h.Stop))
	v1.DELETE("/:id", web.BindHandler(h.Delete))

	return h, nil
}

// Delete 删除任务
//
//	@Summary		删除任务
//	@Description	删除任务。任务处于运行中（pending/processing）或虚拟机仍在线时不允许删除。
//	@Tags			【用户】任务管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			id	path		string		true	"任务 ID"
//	@Success		200	{object}	web.Resp{}	"成功"
//	@Failure		500	{object}	web.Resp	"服务器内部错误"
//	@Router			/api/v1/users/tasks/{id} [delete]
func (h *TaskHandler) Delete(c *web.Context, req domain.IDReq[uuid.UUID]) error {
	user := middleware.GetUser(c)
	if err := h.usecase.Delete(c.Request().Context(), user, req.ID); err != nil {
		return err
	}
	return c.Success(nil)
}

// Stop 停止任务
//
//	@Summary		停止任务
//	@Description	停止任务
//	@Tags			【用户】任务管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			id	body		domain.IDReq[uuid.UUID]	true	"任务 id"
//	@Success		200	{object}	web.Resp{}				"成功回包"
//	@Router			/api/v1/users/tasks/stop [put]
func (h *TaskHandler) Stop(c *web.Context, req domain.IDReq[uuid.UUID]) error {
	user := middleware.GetUser(c)
	if err := h.usecase.Stop(c.Request().Context(), user, req.ID); err != nil {
		return err
	}
	return c.Success(nil)
}

// List 任务列表
//
//	@Summary		任务列表
//	@Description	获取属于该用户的所有任务，仅支持普通分页
//	@Tags			【用户】任务管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			req	query		domain.TaskListReq					true	"分页参数（page/size）"
//	@Success		200	{object}	web.Resp{data=domain.ListTaskResp}	"成功"
//	@Failure		500	{object}	web.Resp							"服务器内部错误"
//	@Router			/api/v1/users/tasks [get]
func (h *TaskHandler) List(c *web.Context, req domain.TaskListReq) error {
	req.Pagination = c.Page()
	if req.Pagination == nil {
		req.Pagination = &web.Pagination{Page: 1, Size: 20}
	}
	if req.Page <= 0 {
		req.Page = 1
	}
	if req.Size <= 0 {
		req.Size = 20
	}
	user := middleware.GetUser(c)
	resp, err := h.usecase.List(c.Request().Context(), user, req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// Info 任务详情
//
//	@Summary		任务详情
//	@Description	任务详情
//	@Tags			【用户】任务管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			id	path		string						true	"任务 ID"
//	@Success		200	{object}	web.Resp{data=domain.Task}	"成功"
//	@Failure		500	{object}	web.Resp					"服务器内部错误"
//	@Router			/api/v1/users/tasks/{id} [get]
func (h *TaskHandler) Info(c *web.Context, req domain.IDReq[uuid.UUID]) error {
	user := middleware.GetUser(c)
	t, _, err := h.usecase.Info(c.Request().Context(), user, req.ID)
	if err != nil {
		return err
	}
	return c.Success(t)
}

// Create 创建任务
//
//	@Summary		创建任务
//	@Description	创建任务
//	@Tags			【用户】任务管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			param	body		domain.CreateTaskReq				true	"请求参数"
//	@Success		200		{object}	web.Resp{data=domain.ProjectTask}	"成功"
//	@Failure		500		{object}	web.Resp							"服务器内部错误"
//	@Router			/api/v1/users/tasks [post]
func (h *TaskHandler) Create(c *web.Context, req domain.CreateTaskReq) error {
	user := middleware.GetUser(c)

	// 校验 skill_ids
	for _, skillID := range req.Extra.SkillIDs {
		if err := validateSkillID(skillID); err != nil {
			return errcode.ErrBadRequest.Wrap(err)
		}
	}

	// 公共主机处理
	if req.HostID == consts.PUBLIC_HOST_ID {
		if req.Resource.Life > 3*60*60 {
			return errcode.ErrPublicHostBeyondLimit
		}
		if h.pubhost == nil {
			return errcode.ErrBadRequest.Wrap(fmt.Errorf("public host not available"))
		}
		host, err := h.pubhost.PickHost(c.Request().Context())
		if err != nil {
			return err
		}
		req.HostID = host.ID
		req.UsePublicHost = true
		h.logger.With("host", host).DebugContext(c.Request().Context(), "pick public host")
	}

	if err := req.Validate(); err != nil {
		return errcode.ErrBadRequest.Wrap(err)
	}

	// 注意：系统提示词和 git token 由 usecase 通过 TaskHook 处理
	task, err := h.usecase.Create(c.Request().Context(), user, req, "")
	if err != nil {
		return err
	}

	// 异步入队摘要生成
	go func() {
		if err := h.taskSummary.EnqueueSummary(context.Background(), task.ID.String(), time.Unix(task.CreatedAt, 0)); err != nil {
			h.logger.Error("failed to enqueue task summary", "task_id", task.ID, "error", err)
		}
	}()

	return c.Success(task)
}

// PublicStream 公开的任务数据流 WebSocket
//
//	@Summary		公开的任务数据流 WebSocket
//	@Description	数据格式约定参考任务数据流 WebSocket 接口
//	@Tags			【用户】任务管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			id	query		string		true	"任务 ID"
//	@Success		200	{object}	web.Resp{}	"成功"
//	@Failure		500	{object}	web.Resp	"服务器内部错误"
//	@Router			/api/v1/users/tasks/public-stream [get]
func (h *TaskHandler) PublicStream(c *web.Context, req domain.IDReq[uuid.UUID]) error {
	user := middleware.GetUser(c)
	task, err := h.usecase.GetPublic(c.Request().Context(), user, req.ID)
	if err != nil {
		h.logger.With("req", req).ErrorContext(c.Request().Context(), "failed to get public task")
		return err
	}

	return h.stream(c, user, task, false)
}

// Stream 任务数据流 WebSocket
//
//	@Summary		任务数据流 WebSocket
//	@Description	功能定位：该接口通过 WebSocket 仅做 Agent ↔ 前端 的数据代理与转发，不进行任何包体解析或改写。所有数据以原始格式透传并存储。
//	@Description	数据格式约定：当前仅支持文本帧透传。服务端将 Agent 的原始文本数据包装为如下结构返回给前端（对应 domain.TaskStream）：
//	@Description	```json
//	@Description	{ "type": "string", "data": "string", "timestamp": 0 }
//	@Description	```
//	@Description	type 字段说明：
//	@Description	- task-started: 本轮任务启动
//	@Description	- task-ended: 本轮任务结束
//	@Description	- task-error: 本轮任务发生错误
//	@Description	- task-running: 任务正在运行
//	@Description	- task-event: 任务临时事件, 不持久化
//	@Description	- file-change: 文件变动事件
//	@Description	- permission-resp: 用户的权限响应
//	@Description	- auto-approve: 开启自动批准
//	@Description	- disable-auto-approve: 关闭自动批准
//	@Description	- user-input: 用户输入
//	@Description	- user-cancel: 取消当前操作，不会终止任务
//	@Description	- reply-question: 回复 AI 的提问
//	@Description	- call: 同步请求 (repo_file_diff, repo_file_list, repo_read_file, repo_file_changes, restart)
//	@Description	- call-response: 同步请求响应
//	@Tags			【用户】任务管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			id	query		string		true	"任务 ID"
//	@Success		200	{object}	web.Resp{}	"成功"
//	@Failure		500	{object}	web.Resp	"服务器内部错误"
//	@Router			/api/v1/users/tasks/stream [get]
func (h *TaskHandler) Stream(c *web.Context, req domain.IDReq[uuid.UUID]) error {
	user := middleware.GetUser(c)
	task, owner, err := h.usecase.Info(c.Request().Context(), user, req.ID)
	if err != nil {
		return err
	}

	return h.stream(c, user, task, owner)
}

func (h *TaskHandler) stream(c *web.Context, user *domain.User, task *domain.Task, writable bool) error {
	logger := h.logger.With("task_id", task.ID, "fn", "task.stream")

	// 使用 coder/websocket Accept 升级连接
	wsConn, err := ws.Accept(c.Response().Writer, c.Request())
	if err != nil {
		h.logger.ErrorContext(c.Request().Context(), "failed to upgrade to websocket", "error", err)
		return err
	}
	defer wsConn.Close()

	ctx, cancel := context.WithCancelCause(c.Request().Context())
	defer cancel(fmt.Errorf("stream close"))

	go h.ping(ctx, cancel, wsConn, task.ID.String())

	h.taskConns.Add(task.ID.String(), wsConn)
	defer h.taskConns.Remove(task.ID.String())

	// 发送初始用户输入消息
	if err := wsConn.WriteJSON(domain.TaskStream{
		Type:      consts.TaskStreamTypeUserInput,
		Data:      []byte(task.Content),
		Timestamp: task.CreatedAt * 1000,
	}); err != nil {
		return err
	}

	if task.VirtualMachine == nil || task.VirtualMachine.Host == nil {
		logger.DebugContext(ctx, "no virtual machine or host for task", "task_id", task.ID)
		h.writeError(wsConn, fmt.Errorf("no virtual machine or host for task"))
		return nil
	}

	if err := h.taskflow.VirtualMachiner().Resume(c.Request().Context(), &taskflow.ResumeVirtualMachineReq{
		HostID:        task.VirtualMachine.Host.InternalID,
		UserID:        task.UserID.String(),
		ID:            task.VirtualMachine.ID,
		EnvironmentID: task.VirtualMachine.EnvironmentID,
	}); err != nil {
		logger.With("error", err).WarnContext(c.Request().Context(), "failed to resume virtual")
	}

	// 对于离线的机器，只拉取历史数据
	if task.VirtualMachine.Status == taskflow.VirtualMachineStatusOffline {
		aggregator := acp.NewChunkAggregator(func(stream domain.TaskStream) error {
			return wsConn.WriteJSON(stream)
		})
		err := h.loki.History(ctx, task.ID.String(), time.Unix(task.CreatedAt, 0), func(le []loki.LogEntry) {
			chunks := make([]taskflow.TaskChunk, 0, len(le))
			for _, l := range le {
				if l.Line == "" {
					continue
				}
				var chunk taskflow.TaskChunk
				if err := json.Unmarshal([]byte(l.Line), &chunk); err != nil {
					logger.ErrorContext(ctx, "failed to unmarshal log entry", "line", l.Line, "error", err)
					continue
				}
				chunk.Timestamp = l.Timestamp.UnixMilli()
				chunks = append(chunks, chunk)
			}

			if err := aggregator.Process(chunks); err != nil {
				logger.ErrorContext(ctx, "failed to process batch", "error", err)
			}
		})
		if err != nil {
			logger.ErrorContext(ctx, "failed to get history logs", "error", err)
			h.writeError(wsConn, fmt.Errorf("failed to get history logs %w", err))
		}

		select {
		case <-time.After(30 * time.Second):
			return nil
		case <-ctx.Done():
			return nil
		}
	}

	// 对于在线的机器，启动 Tail 追踪
	go func() {
		aggregator := acp.NewChunkAggregator(func(stream domain.TaskStream) error {
			return wsConn.WriteJSON(stream)
		})

		logLimit := h.cfg.Task.LogLimit
		if logLimit <= 0 {
			logLimit = 200
		}

		err := h.loki.Tail(ctx, task.ID.String(), time.Unix(task.CreatedAt, 0).Add(-1*time.Minute), logLimit, func(le []loki.LogEntry) error {
			chunks := make([]taskflow.TaskChunk, 0, len(le))
			for _, l := range le {
				if l.Line == "" {
					continue
				}
				var chunk taskflow.TaskChunk
				if err := json.Unmarshal([]byte(l.Line), &chunk); err != nil {
					logger.ErrorContext(ctx, "failed to unmarshal log entry", "line", l.Line, "error", err)
					continue
				}
				chunk.Timestamp = l.Timestamp.UnixMilli()
				chunks = append(chunks, chunk)
			}

			if err := aggregator.Process(chunks); err != nil {
				logger.ErrorContext(ctx, "failed to process batch", "error", err)
			}
			return nil
		})

		if err != nil {
			logger.ErrorContext(ctx, "tailer failed", "error", err)
			h.writeError(wsConn, fmt.Errorf("failed to tail logs %w", err))
			cancel(fmt.Errorf("failed to tail logs %w", err))
			return
		}
	}()

	// 读取客户端消息循环
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
		logger.With("data", string(d)).DebugContext(ctx, "recv message")

		if !writable {
			continue
		}

		var m domain.TaskStream
		if err := json.Unmarshal(d, &m); err != nil {
			logger.With("error", err, "data", string(d)).WarnContext(ctx, "failed to unmarshal message")
			continue
		}

		switch m.Type {
		case consts.TaskStreamTypeUserInput:
			if err := h.usecase.Continue(ctx, user, task.ID, string(m.Data)); err != nil {
				logger.With("error", err, "data", string(d)).WarnContext(ctx, "failed to push task content")
			}
			if err := h.taskSummary.EnqueueSummary(ctx, task.ID.String(), time.Unix(task.CreatedAt, 0)); err != nil {
				logger.With("error", err).WarnContext(ctx, "failed to enqueue task summary")
			}

		case consts.TaskStreamTypeUserStop:
			if err := h.usecase.Stop(ctx, user, task.ID); err != nil {
				logger.With("error", err, "data", string(d)).WarnContext(ctx, "failed to stop task")
			}

		case consts.TaskStreamTypeUserCancel:
			if err := h.usecase.Cancel(ctx, user, task.ID); err != nil {
				logger.With("error", err, "data", string(d)).WarnContext(ctx, "failed to cancel task")
			}

		case consts.TaskStreamTypeAutoApprove:
			if err := h.usecase.AutoApprove(ctx, user, task.ID, true); err != nil {
				logger.With("error", err, "data", string(d)).WarnContext(ctx, "failed to auto approve task")
			}

		case consts.TaskStreamTypeDisableAutoApprove:
			if err := h.usecase.AutoApprove(ctx, user, task.ID, false); err != nil {
				logger.With("error", err, "data", string(d)).WarnContext(ctx, "failed to disable auto approve task")
			}

		case consts.TaskStreamTypeReplyQuestion:
			var req taskflow.AskUserQuestionResponse
			if err := json.Unmarshal(m.Data, &req); err != nil {
				logger.With("error", err, "data", string(d)).WarnContext(ctx, "failed to unmarshal ask user question")
				continue
			}
			req.TaskId = task.ID.String()
			if err := h.taskflow.TaskManager().AskUserQuestion(ctx, req); err != nil {
				logger.With("error", err, "data", string(d)).WarnContext(ctx, "failed to send ask user question")
			}
			if err := h.taskSummary.EnqueueSummary(ctx, task.ID.String(), time.Unix(task.CreatedAt, 0)); err != nil {
				logger.With("error", err).WarnContext(ctx, "failed to enqueue task summary")
			}

		case consts.TaskStreamTypeSyncWebClientIP:
			var req taskflow.ApplyWebClientIPReq
			if err := json.Unmarshal(m.Data, &req); err != nil {
				logger.With("error", err, "data", string(d)).WarnContext(ctx, "failed to unmarshal apply web client ip")
				continue
			}
			if req.ClientIP != "" {
				wsConn.SetRealIP(req.ClientIP)
				logger.With("client_ip", req.ClientIP).DebugContext(ctx, "updated websocket client ip")
			}

		case consts.TaskStreamTypeCall:
			switch m.Kind {
			case "repo_file_diff":
				var req taskflow.RepoFileDiffReq
				if err := json.Unmarshal(m.Data, &req); err != nil {
					logger.With("error", err, "data", string(d)).WarnContext(ctx, "failed to unmarshal repo file diff")
					continue
				}
				req.TaskId = task.ID.String()
				diff, err := h.taskflow.TaskManager().FileDiff(ctx, req)
				if err != nil {
					logger.With("error", err, "data", string(d)).WarnContext(ctx, "failed to get repo file diff")
					continue
				}
				b, err := json.Marshal(diff)
				if err != nil {
					logger.With("error", err).WarnContext(ctx, "failed to marshal repo file diff")
					continue
				}
				if err := wsConn.WriteJSON(domain.TaskStream{
					Type:      consts.TaskStreamTypeCallResponse,
					Data:      b,
					Timestamp: time.Now().UnixMilli(),
					Kind:      m.Kind,
				}); err != nil {
					logger.With("error", err).WarnContext(ctx, "failed to write repo file diff to websocket")
				}

			case "repo_file_list":
				var req taskflow.RepoListFilesReq
				if err := json.Unmarshal(m.Data, &req); err != nil {
					logger.With("error", err, "data", string(d)).WarnContext(ctx, "failed to unmarshal repo list file")
					continue
				}
				req.TaskId = task.ID.String()
				res, err := h.taskflow.TaskManager().ListFiles(ctx, req)
				if err != nil {
					logger.With("error", err, "data", string(d)).WarnContext(ctx, "failed to get repo list file")
					continue
				}
				b, err := json.Marshal(res)
				if err != nil {
					logger.With("error", err).WarnContext(ctx, "failed to marshal repo list file")
					continue
				}
				if err := wsConn.WriteJSON(domain.TaskStream{
					Type:      consts.TaskStreamTypeCallResponse,
					Data:      b,
					Timestamp: time.Now().UnixMilli(),
					Kind:      m.Kind,
				}); err != nil {
					logger.With("error", err).WarnContext(ctx, "failed to write repo list file to websocket")
				}

			case "repo_read_file":
				var req taskflow.RepoReadFileReq
				if err := json.Unmarshal(m.Data, &req); err != nil {
					logger.With("error", err, "data", string(d)).WarnContext(ctx, "failed to unmarshal repo read file")
					continue
				}
				req.TaskId = task.ID.String()
				res, err := h.taskflow.TaskManager().ReadFile(ctx, req)
				if err != nil {
					logger.With("error", err, "data", string(d)).WarnContext(ctx, "failed to get repo read file")
					continue
				}
				b, err := json.Marshal(res)
				if err != nil {
					logger.With("error", err).WarnContext(ctx, "failed to marshal repo read file")
					continue
				}
				if err := wsConn.WriteJSON(domain.TaskStream{
					Type:      consts.TaskStreamTypeCallResponse,
					Data:      b,
					Timestamp: time.Now().UnixMilli(),
					Kind:      m.Kind,
				}); err != nil {
					logger.With("error", err).WarnContext(ctx, "failed to write repo read file to websocket")
				}

			case "repo_file_changes":
				var req taskflow.RepoFileChangesReq
				if err := json.Unmarshal(m.Data, &req); err != nil {
					logger.With("error", err, "data", string(d)).WarnContext(ctx, "failed to unmarshal repo file changes")
					continue
				}
				req.TaskId = task.ID.String()
				res, err := h.taskflow.TaskManager().FileChanges(ctx, req)
				if err != nil {
					logger.With("error", err, "data", string(d)).WarnContext(ctx, "failed to get repo file changes")
					continue
				}
				b, err := json.Marshal(res)
				if err != nil {
					logger.With("error", err).WarnContext(ctx, "failed to marshal repo file changes")
					continue
				}
				if err := wsConn.WriteJSON(domain.TaskStream{
					Type:      consts.TaskStreamTypeCallResponse,
					Data:      b,
					Timestamp: time.Now().UnixMilli(),
					Kind:      m.Kind,
				}); err != nil {
					logger.With("error", err).WarnContext(ctx, "failed to write repo file changes to websocket")
				}

			case "restart":
				var req taskflow.RestartTaskReq
				if err := json.Unmarshal(m.Data, &req); err != nil {
					logger.With("error", err, "data", string(d)).WarnContext(ctx, "failed to unmarshal restart task")
					continue
				}
				req.ID = task.ID
				if err := h.taskflow.TaskManager().Restart(ctx, req); err != nil {
					logger.With("error", err, "data", string(d)).WarnContext(ctx, "failed to restart task")
					continue
				}
			}
		}
	}
}

func (h *TaskHandler) writeError(wsConn *ws.WebsocketManager, err error) {
	wsConn.WriteJSON(domain.TaskStream{
		Type: consts.TaskStreamTypeError,
		Data: fmt.Appendf(nil, "%s", err),
	})
}

func (h *TaskHandler) ping(
	ctx context.Context,
	cancel context.CancelCauseFunc,
	wsConn *ws.WebsocketManager,
	taskID string,
) {
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
				h.logger.With("error", err, "task_id", taskID).Warn("failed to ping ws task stream")
				cancel(fmt.Errorf("ping failed: %w", err))
				return
			}
		}
	}
}

// validateSkillID 验证 skillID 是否安全，防止路径遍历攻击
func validateSkillID(skillID string) error {
	if skillID == "" {
		return fmt.Errorf("skill id cannot be empty")
	}
	cleanID := filepath.Clean(skillID)
	if strings.Contains(cleanID, "..") || strings.HasPrefix(cleanID, "/") {
		return fmt.Errorf("invalid skill id")
	}
	skilldir := filepath.Join(consts.SkillBaseDir, cleanID)
	if !strings.HasPrefix(skilldir, consts.SkillBaseDir+string(os.PathSeparator)) {
		return fmt.Errorf("skill path escape")
	}
	return nil
}
