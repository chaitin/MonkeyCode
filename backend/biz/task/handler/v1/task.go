package v1

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/GoYoko/web"
	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/biz/task/service"
	vmidle "github.com/chaitin/MonkeyCode/backend/biz/vmidle/usecase"
	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/middleware"
	"github.com/chaitin/MonkeyCode/backend/pkg/loki"
	"github.com/chaitin/MonkeyCode/backend/pkg/nls"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
	"github.com/chaitin/MonkeyCode/backend/pkg/ws"
)

var errRoundEnded = errors.New("round ended")

// TaskHandler 任务处理器
type TaskHandler struct {
	cfg           *config.Config
	usecase       domain.TaskUsecase
	userusecase   domain.UserUsecase
	pubhost       domain.PublicHostUsecase
	logger        *slog.Logger
	taskflow      taskflow.Clienter
	loki          *loki.Client
	nls           *nls.NLS
	taskConns     *ws.TaskConn
	controlConns  *ws.ControlConn
	taskSummary   *service.TaskSummaryService
	idleRefresher vmidle.VMIdleRefresher
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
	targetActive := do.MustInvoke[*middleware.TargetActiveMiddleware](i)
	tc := do.MustInvoke[*ws.TaskConn](i)
	cc := do.MustInvoke[*ws.ControlConn](i)
	ts := do.MustInvoke[*service.TaskSummaryService](i)
	ir := do.MustInvoke[vmidle.VMIdleRefresher](i)

	// Optional deps
	var pubhost domain.PublicHostUsecase
	if ph, err := do.Invoke[domain.PublicHostUsecase](i); err == nil {
		pubhost = ph
	}

	var nlsSvc *nls.NLS
	if n, err := do.Invoke[*nls.NLS](i); err == nil {
		nlsSvc = n
	}

	h := &TaskHandler{
		cfg:           cfg,
		usecase:       uc,
		userusecase:   uuc,
		pubhost:       pubhost,
		logger:        logger.With("handler", "task.handler"),
		taskflow:      tf,
		loki:          lok,
		nls:           nlsSvc,
		taskConns:     tc,
		controlConns:  cc,
		taskSummary:   ts,
		idleRefresher: ir,
	}

	// 注册路由
	v1 := w.Group("/api/v1/users/tasks")

	v1.GET("/public-stream", web.BindHandler(h.PublicStream), auth.Check())

	v1.Use(auth.Auth(), targetActive.TargetActive())

	// 任务管理接口
	v1.GET("", web.BindHandler(h.List, web.WithPage()))
	v1.GET("/:id", web.BindHandler(h.Info))
	v1.GET("/stream", web.BindHandler(h.Stream))
	v1.GET("/control", web.BindHandler(h.Control))
	v1.GET("/rounds", web.BindHandler(h.TaskRounds))
	v1.POST("", web.BindHandler(h.Create))
	v1.PUT("/stop", web.BindHandler(h.Stop))
	v1.DELETE("/:id", web.BindHandler(h.Delete))
	// 语音识别文字接口
	v1.POST("/speech-to-text", web.BaseHandler(h.SpeechToText))

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

	// token 由 usecase 根据 req.GitIdentityID 解析，此处传空
	task, err := h.usecase.Create(c.Request().Context(), user, req)
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

	return h.stream(c, user, task, false, "attach")
}

// Stream 任务数据流 WebSocket
//
//	@Summary		任务数据流 WebSocket
//	@Description	功能定位：该接口通过 WebSocket 仅做 Agent ↔ 前端 的数据代理与转发，不进行任何包体解析或改写。所有数据以原始格式透传并存储。
//	@Description	数据格式约定：当前仅支持文本帧透传。服务端将 Agent 的原始文本数据包装为如下结构返回给前端（对应 domain.TaskStream）：
//	@Description	```json
//	@Description	{ "type": "string", "data": "string", "kind": "string", "timestamp": 0 }
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
//	@Description	- cursor: 历史游标，用于通过 /rounds 接口加载更早的论次
//	@Description
//	@Description	cursor 消息结构：
//	@Description	```json
//	@Description	{ "type": "cursor", "data": { "cursor": "<lastTaskStartedTS_ns>", "has_more": true }, "timestamp": 0 }
//	@Description	```
//	@Description	- cursor: 当前论次 task-started 的时间戳（Unix 纳秒），作为 GET /rounds 接口的 cursor 参数向前翻页
//	@Description	- has_more: 是否存在更早的论次。为 false 时表示当前论次即为第一论次，无需再翻页
//	@Tags			【用户】任务管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			id		query		string		true	"任务 ID"
//	@Param			mode	query		string		false	"模式：new(等待用户输入)|attach(仅拉取当前论次)，默认 new"
//	@Success		200		{object}	web.Resp{}	"成功"
//	@Failure		500		{object}	web.Resp	"服务器内部错误"
//	@Router			/api/v1/users/tasks/stream [get]
func (h *TaskHandler) Stream(c *web.Context, req domain.TaskStreamReq) error {
	user := middleware.GetUser(c)
	task, owner, err := h.usecase.Info(c.Request().Context(), user, req.ID)
	if err != nil {
		return err
	}

	if req.Mode == "" {
		req.Mode = "new"
	}
	return h.stream(c, user, task, owner, req.Mode)
}

func (h *TaskHandler) stream(c *web.Context, user *domain.User, task *domain.Task, writable bool, mode string) error {
	logger := h.logger.With("task_id", task.ID, "fn", "task.stream")

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

	if task.VirtualMachine == nil || task.VirtualMachine.Host == nil {
		logger.DebugContext(ctx, "no virtual machine or host for task")
		h.writeError(wsConn, fmt.Errorf("no virtual machine or host for task"))
		return nil
	}

	if mode != "new" {
		// 在 goroutine 中执行 attach 流程（replay 历史 + 消费实时流），
		// 避免阻塞 readClientMessages 处理客户端输入
		go func() {
			if err := h.attachStream(ctx, cancel, wsConn, logger, task); err != nil {
				h.writeError(wsConn, fmt.Errorf("failed to attach stream"))
			}
		}()
	}

	// attach 模式下实时流已在 attachStream 中订阅，无需再次订阅
	streamStarted := mode != "new"
	return h.readClientMessages(ctx, wsConn, logger, user, task, writable, cancel, streamStarted)
}

func (h *TaskHandler) attachStream(ctx context.Context, cancel context.CancelCauseFunc, wsConn *ws.WebsocketManager, logger *slog.Logger, task *domain.Task) error {
	taskID := task.ID.String()
	taskCreatedAt := time.Unix(task.CreatedAt, 0)

	// 先订阅实时流（触发 flush）
	streamCh := make(chan *taskflow.TaskChunk, 100)
	go func() {
		_ = h.taskflow.TaskLive(ctx, taskID, true, func(chunk *taskflow.TaskChunk) error {
			select {
			case streamCh <- chunk:
			case <-ctx.Done():
				return ctx.Err()
			}
			return nil
		})
		close(streamCh)
	}()
	attachNow := time.Now().UTC()

	roundStart, err := h.loki.FindLatestRoundStart(ctx, taskID, taskCreatedAt, attachNow)
	if err != nil {
		return fmt.Errorf("find latest round start: %w", err)
	}
	hasMore := roundStart.After(taskCreatedAt)
	h.writeCursor(wsConn, roundStart, hasMore)

	// 读最新论次的 loki 历史窗口
	ended, err := h.replayLatestRoundHistory(ctx, wsConn, logger, taskID, roundStart, attachNow)
	if err != nil {
		return err
	}
	if ended {
		cancel(fmt.Errorf("attach ended task"))
		return nil
	}

	// 消费实时流
	h.consumeLiveStream(ctx, cancel, wsConn, streamCh, attachNow.UnixNano())
	return nil
}

func buildTaskStreamsFromHistoryEntries(entries []loki.LogEntry, logger *slog.Logger) ([]domain.TaskStream, bool) {
	streams := make([]domain.TaskStream, 0, len(entries))
	ended := false

	for _, l := range entries {
		if l.Line == "" {
			continue
		}
		var chunk taskflow.TaskChunk
		if err := json.Unmarshal([]byte(l.Line), &chunk); err != nil {
			logger.Error("failed to unmarshal log entry", "line", l.Line, "error", err)
			continue
		}
		streams = append(streams, domain.TaskStream{
			Type:      consts.TaskStreamType(chunk.Event),
			Data:      chunk.Data,
			Kind:      chunk.Kind,
			Timestamp: l.Timestamp.UnixMilli(),
		})
		if chunk.Event == "task-ended" {
			ended = true
		}
	}

	return streams, ended
}

func (h *TaskHandler) replayLatestRoundHistory(ctx context.Context, wsConn *ws.WebsocketManager, logger *slog.Logger, taskID string, start, end time.Time) (bool, error) {
	entries, err := h.loki.QueryWindowByTaskID(ctx, taskID, start, end)
	if err != nil {
		return false, fmt.Errorf("query latest round history: %w", err)
	}

	streams, ended := buildTaskStreamsFromHistoryEntries(entries, logger)
	for _, stream := range streams {
		if err := wsConn.WriteJSON(stream); err != nil {
			return false, err
		}
		if stream.Type == consts.TaskStreamType("task-ended") {
			return true, nil
		}
	}

	return ended, nil
}

func (h *TaskHandler) consumeLiveStream(ctx context.Context, cancel context.CancelCauseFunc, wsConn *ws.WebsocketManager, streamCh <-chan *taskflow.TaskChunk, historyEndNS int64) {
	for {
		select {
		case <-ctx.Done():
			return
		case chunk, ok := <-streamCh:
			if !ok {
				return
			}
			if historyEndNS > 0 && chunk.Timestamp <= historyEndNS {
				continue
			}
			if err := wsConn.WriteJSON(domain.TaskStream{
				Type:      consts.TaskStreamType(chunk.Event),
				Data:      chunk.Data,
				Kind:      chunk.Kind,
				Timestamp: chunk.Timestamp / 1e6,
			}); err != nil {
				return
			}
			if chunk.Event == "task-ended" {
				cancel(errRoundEnded)
				return
			}
		}
	}
}

func (h *TaskHandler) subscribeRealtimeStream(ctx context.Context, cancel context.CancelCauseFunc, wsConn *ws.WebsocketManager, logger *slog.Logger, taskID string) {
	err := h.taskflow.TaskLive(ctx, taskID, false, func(chunk *taskflow.TaskChunk) error {
		if err := wsConn.WriteJSON(domain.TaskStream{
			Type:      consts.TaskStreamType(chunk.Event),
			Data:      chunk.Data,
			Kind:      chunk.Kind,
			Timestamp: chunk.Timestamp / 1e6,
		}); err != nil {
			return fmt.Errorf("failed to write to websocket: %w", err)
		}

		if chunk.Event == "task-ended" {
			cancel(errRoundEnded)
			return errRoundEnded
		}
		return nil
	})

	if err != nil && !errors.Is(err, errRoundEnded) {
		logger.ErrorContext(ctx, "realtime stream failed", "error", err)
		h.writeError(wsConn, fmt.Errorf("failed to subscribe realtime stream: %w", err))
		cancel(fmt.Errorf("failed to subscribe realtime stream: %w", err))
	}
}

func (h *TaskHandler) readClientMessages(ctx context.Context, wsConn *ws.WebsocketManager, logger *slog.Logger, user *domain.User, task *domain.Task, writable bool, cancel context.CancelCauseFunc, streamStarted bool) error {
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

		// new 模式：收到第一条 user-input 后启动实时流订阅
		if !streamStarted && m.Type == consts.TaskStreamTypeUserInput {
			streamStarted = true
			go h.subscribeRealtimeStream(ctx, cancel, wsConn, logger, task.ID.String())

			if err := wsConn.WriteJSON(domain.TaskStream{
				Type:      consts.TaskStreamTypeUserInput,
				Data:      m.Data,
				Kind:      m.Kind,
				Timestamp: time.Now().UnixMilli(),
			}); err != nil {
				h.writeError(wsConn, fmt.Errorf("failed to write json to frontend"))
				return err
			}
		}

		h.handleClientMessage(ctx, logger, user, task, m)
	}
}

func (h *TaskHandler) handleClientMessage(ctx context.Context, logger *slog.Logger, user *domain.User, task *domain.Task, m domain.TaskStream) {
	switch m.Type {
	case consts.TaskStreamTypeUserInput:
		if err := h.usecase.Continue(ctx, user, task.ID, string(m.Data)); err != nil {
			logger.With("error", err).WarnContext(ctx, "failed to push task content")
		}
		if err := h.usecase.IncrUserInputCount(ctx, user.ID, task.ID); err != nil {
			logger.With("error", err).WarnContext(ctx, "failed to incr user input count")
		}
		if err := h.usecase.TouchProjectUpdatedAt(ctx, task); err != nil {
			logger.With("error", err).WarnContext(ctx, "failed to touch project updated_at")
		}
		h.enqueueSummary(ctx, logger, task.ID.String(), task.CreatedAt)

	case consts.TaskStreamTypeUserStop:
		if err := h.usecase.Stop(ctx, user, task.ID); err != nil {
			logger.With("error", err).WarnContext(ctx, "failed to stop task")
		}

	case consts.TaskStreamTypeUserCancel:
		if err := h.usecase.Cancel(ctx, user, task.ID); err != nil {
			logger.With("error", err).WarnContext(ctx, "failed to cancel task")
		}

	case consts.TaskStreamTypeAutoApprove:
		if err := h.usecase.AutoApprove(ctx, user, task.ID, true); err != nil {
			logger.With("error", err).WarnContext(ctx, "failed to auto approve task")
		}

	case consts.TaskStreamTypeDisableAutoApprove:
		if err := h.usecase.AutoApprove(ctx, user, task.ID, false); err != nil {
			logger.With("error", err).WarnContext(ctx, "failed to disable auto approve task")
		}

	case consts.TaskStreamTypeReplyQuestion:
		h.handleReplyQuestion(ctx, logger, task, m.Data)
		if err := h.usecase.TouchProjectUpdatedAt(ctx, task); err != nil {
			logger.With("error", err).WarnContext(ctx, "failed to touch project updated_at")
		}
	}
}

func (h *TaskHandler) enqueueSummary(ctx context.Context, logger *slog.Logger, taskID string, createdAt int64) {
	if err := h.taskSummary.EnqueueSummary(ctx, taskID, time.Unix(createdAt, 0)); err != nil {
		logger.With("error", err).WarnContext(ctx, "failed to enqueue task summary")
	}
}

func (h *TaskHandler) handleReplyQuestion(ctx context.Context, logger *slog.Logger, task *domain.Task, data json.RawMessage) {
	var req taskflow.AskUserQuestionResponse
	if err := json.Unmarshal(data, &req); err != nil {
		logger.With("error", err).WarnContext(ctx, "failed to unmarshal ask user question")
		return
	}
	req.TaskId = task.ID.String()
	if err := h.taskflow.TaskManager().AskUserQuestion(ctx, req); err != nil {
		logger.With("error", err).WarnContext(ctx, "failed to send ask user question")
	}
	h.enqueueSummary(ctx, logger, task.ID.String(), task.CreatedAt)
}

func (h *TaskHandler) handleSyncClientIP(ctx context.Context, wsConn *ws.WebsocketManager, logger *slog.Logger, data json.RawMessage) {
	var req taskflow.ApplyWebClientIPReq
	if err := json.Unmarshal(data, &req); err != nil {
		logger.With("error", err).WarnContext(ctx, "failed to unmarshal apply web client ip")
		return
	}
	if req.ClientIP != "" {
		wsConn.SetRealIP(req.ClientIP)
		logger.With("client_ip", req.ClientIP).DebugContext(ctx, "updated websocket client ip")
	}
}

func (h *TaskHandler) writeError(wsConn *ws.WebsocketManager, err error) {
	errMsg, _ := json.Marshal(err.Error())
	wsConn.WriteJSON(domain.TaskStream{
		Type: consts.TaskStreamTypeError,
		Data: errMsg,
	})
}

// writeCursor 向 WebSocket 发送 cursor 消息，通知前端可以通过 /rounds 接口加载更早的历史
func (h *TaskHandler) writeCursor(wsConn *ws.WebsocketManager, indexTime time.Time, hasMore bool) {
	if indexTime.IsZero() {
		return
	}

	cursor := strconv.FormatInt(indexTime.UnixNano()-1, 10)
	data, _ := json.Marshal(map[string]any{
		"cursor":   cursor,
		"has_more": hasMore,
	})
	wsConn.WriteJSON(domain.TaskStream{
		Type:      consts.TaskStreamTypeCursor,
		Data:      data,
		Timestamp: time.Now().UnixMilli(),
	})
}

// TaskRounds 查询任务历史论次（原始 TaskChunk，向前翻页）
//
//	@Summary		查询任务历史论次
//	@Description	根据 cursor 向前翻页查询任务的历史论次。limit 为论次数（非条目数），
//	@Description	limit=2 表示返回 2 论的完整消息。返回的 chunks 按时间倒序排列（最新在前）。
//	@Tags			【用户】任务管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			id		query		string									true	"任务 ID"
//	@Param			cursor	query		string									false	"游标（时间戳 Unix ns）"
//	@Param			limit	query		int										false	"论次数（默认 2，上限 10）"
//	@Success		200		{object}	web.Resp{data=domain.TaskRoundsResp}	"成功"
//	@Failure		500		{object}	web.Resp								"服务器内部错误"
//	@Router			/api/v1/users/tasks/rounds [get]
func (h *TaskHandler) TaskRounds(c *web.Context, req domain.TaskRoundsReq) error {
	ctx := c.Request().Context()
	user := middleware.GetUser(c)

	// 验证任务属于当前用户
	task, _, err := h.usecase.Info(ctx, user, req.ID)
	if err != nil {
		return err
	}

	// 确定查询时间范围：从 cursor 往前查
	end := time.Now()
	if req.Cursor != "" {
		ns, err := strconv.ParseInt(req.Cursor, 10, 64)
		if err != nil {
			return errcode.ErrBadRequest.Wrap(fmt.Errorf("invalid cursor: %w", err))
		}
		end = time.Unix(0, ns)
	}
	start := time.Unix(task.CreatedAt, 0)

	result, err := h.loki.QueryRounds(ctx, task.ID.String(), start, end, req.Limit)
	if err != nil {
		h.logger.With("error", err, "task_id", task.ID).ErrorContext(ctx, "failed to query rounds")
		return errcode.ErrInternalServer.Wrap(fmt.Errorf("failed to query rounds: %w", err))
	}

	chunks := make([]*domain.TaskChunkEntry, 0, len(result.Chunks)+1)
	for _, c := range result.Chunks {
		chunks = append(chunks, &domain.TaskChunkEntry{
			Data:      c.Data,
			Event:     c.Event,
			Kind:      c.Kind,
			Timestamp: c.Timestamp,
			Labels:    c.Labels,
		})
	}

	// 兼容逻辑：当拉到最老的数据且第一条不是 user-input 时，从 db content 补充
	if !result.HasMore && len(chunks) > 0 && chunks[0].Event != "user-input" {
		contentData, _ := json.Marshal(task.Content)
		chunks = append([]*domain.TaskChunkEntry{{
			Data:      contentData,
			Event:     "user-input",
			Kind:      "",
			Timestamp: start.UnixNano(),
			Labels:    nil,
		}}, chunks...)
	}

	resp := domain.TaskRoundsResp{
		Chunks:  chunks,
		HasMore: result.HasMore,
	}
	if result.HasMore && result.NextTS > 0 {
		resp.NextCursor = strconv.FormatInt(result.NextTS, 10)
	}

	return c.Success(resp)
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

// SpeechToText 语音转文字
//
//	@Summary		语音转文字
//	@Description	上传音频数据进行语音识别，返回Server-Sent Events流式文字结果。响应格式为SSE，每个事件包含event和data字段。
//	@Tags			【用户】任务管理
//	@Accept			application/octet-stream
//	@Produce		text/event-stream
//	@Security		MonkeyCodeAIAuth
//	@Success		200	{object}	domain.SpeechRecognitionEvent	"Server-Sent Events流，包含recognition(识别结果)、end(结束)和error(错误)事件"
//	@Failure		400	{object}	web.Resp						"参数错误"
//	@Failure		500	{object}	web.Resp						"服务器内部错误"
//	@Router			/api/v1/users/tasks/speech-to-text [post]
func (h *TaskHandler) SpeechToText(c *web.Context) error {
	user := middleware.GetUser(c)

	if h.nls == nil {
		h.logger.ErrorContext(c.Request().Context(), "speech recognition service not initialized")
		return errcode.ErrInternalServer
	}

	audioData, err := io.ReadAll(c.Request().Body)
	if err != nil {
		h.logger.ErrorContext(c.Request().Context(), "failed to read audio data", "error", err)
		return errcode.ErrInternalServer
	}
	if len(audioData) == 0 {
		h.logger.ErrorContext(c.Request().Context(), "no audio data provided")
		return errcode.ErrInvalidParameter
	}

	c.Response().Header().Set("Content-Type", "text/event-stream")
	c.Response().Header().Set("Cache-Control", "no-cache")
	c.Response().Header().Set("Connection", "keep-alive")
	c.Response().Header().Set("Access-Control-Allow-Origin", "*")

	flusher, ok := c.Response().Writer.(http.Flusher)
	if !ok {
		h.logger.ErrorContext(c.Request().Context(), "streaming not supported")
		http.Error(c.Response().Writer, "Streaming not supported", http.StatusInternalServerError)
		return errcode.ErrInternalServer
	}

	resultCh, errorCh := h.nls.SpeechRecognition(c.Request().Context(), user.ID, audioData)

	timeout := time.After(2 * time.Minute)
	for {
		select {
		case result, ok := <-resultCh:
			if !ok {
				endEvent := domain.SpeechRecognitionEvent{
					Event: "end",
					Data:  domain.SpeechRecognitionData{Type: "end"},
				}
				h.sendSSEEvent(c, flusher, endEvent)
				return nil
			}
			recognitionEvent := domain.SpeechRecognitionEvent{
				Event: "recognition",
				Data: domain.SpeechRecognitionData{
					Type:      "result",
					Text:      result.Text,
					IsFinal:   result.IsFinal,
					UserID:    result.UserID,
					Timestamp: result.Timestamp,
				},
			}
			h.sendSSEEvent(c, flusher, recognitionEvent)

		case err := <-errorCh:
			if err != nil {
				h.logger.ErrorContext(c.Request().Context(), "speech recognition error", "error", err)
				errorEvent := domain.SpeechRecognitionEvent{
					Event: "error",
					Data: domain.SpeechRecognitionData{
						Type:  "error",
						Error: err.Error(),
					},
				}
				h.sendSSEEvent(c, flusher, errorEvent)
				return nil
			}
			return nil

		case <-timeout:
			h.logger.WarnContext(c.Request().Context(), "speech recognition timeout")
			timeoutEvent := domain.SpeechRecognitionEvent{
				Event: "error",
				Data: domain.SpeechRecognitionData{
					Type:  "error",
					Error: "speech recognition timeout",
				},
			}
			h.sendSSEEvent(c, flusher, timeoutEvent)
			return nil

		case <-c.Request().Context().Done():
			h.logger.InfoContext(c.Request().Context(), "client disconnected from speech recognition")
			return nil
		}
	}
}

func (h *TaskHandler) sendSSEEvent(c *web.Context, flusher http.Flusher, event domain.SpeechRecognitionEvent) {
	eventData := domain.SpeechRecognitionData{
		Type: event.Data.Type,
	}

	switch event.Data.Type {
	case "result":
		eventData.Text = event.Data.Text
		eventData.IsFinal = event.Data.IsFinal
		eventData.UserID = event.Data.UserID
		eventData.Timestamp = event.Data.Timestamp
	case "error":
		eventData.Error = event.Data.Error
	case "end":
	}

	jsonData, err := json.Marshal(eventData)
	if err != nil {
		h.logger.ErrorContext(c.Request().Context(), "failed to marshal SSE event data", "error", err, "event", event.Event)
		return
	}

	fmt.Fprintf(c.Response().Writer, "event: %s\ndata: %s\n\n", event.Event, jsonData)
	flusher.Flush()
}
