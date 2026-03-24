package v1

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/GoYoko/web"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/middleware"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
	"github.com/chaitin/MonkeyCode/backend/pkg/ws"
)

type HostHandler struct {
	usecase     domain.HostUsecase
	userusecase domain.UserUsecase
	pubhost     domain.PublicHostUsecase // 可选，由内部项目通过 WithPublicHost 注入
	logger      *slog.Logger
}

func NewHostHandler(i *do.Injector) (*HostHandler, error) {
	w := do.MustInvoke[*web.Web](i)
	auth := do.MustInvoke[*middleware.AuthMiddleware](i)

	h := &HostHandler{
		usecase:     do.MustInvoke[domain.HostUsecase](i),
		userusecase: do.MustInvoke[domain.UserUsecase](i),
		logger:      do.MustInvoke[*slog.Logger](i).With("module", "handler.host"),
	}

	// 可选注入 PublicHostUsecase
	if pubhost, err := do.Invoke[domain.PublicHostUsecase](i); err == nil {
		h.pubhost = pubhost
	}

	g := w.Group("/api/v1/users/hosts")

	g.GET("/install", web.BindHandler(h.Install))
	g.GET("/vms/terminals/join", web.BindHandler(h.JoinTerminal))

	g.Use(auth.Auth())
	g.GET("/install-command", web.BaseHandler(h.GetInstallCommand))
	g.DELETE("/:id", web.BindHandler(h.DeleteHost))
	g.PUT("/:id", web.BindHandler(h.UpdateHost))
	g.GET("", web.BaseHandler(h.HostList))
	g.POST("/vms", web.BindHandler(h.CreateVM))
	g.PUT("/vms", web.BindHandler(h.UpdateVM))
	g.DELETE("/:host_id/vms/:id", web.BindHandler(h.DeleteVM))
	g.GET("/vms/:id", web.BindHandler(h.VMInfo))
	g.GET("/vms/:id/terminals/connect", web.BindHandler(h.ConnectVMTerminal))
	g.GET("/vms/:id/terminals", web.BindHandler(h.TerminalList))
	g.POST("/vms/:id/terminals/share", web.BindHandler(h.ShareTerminal))
	g.DELETE("/vms/:id/terminals/:terminal_id", web.BindHandler(h.CloseTerminal))
	g.POST("/:host_id/vms/:id/ports", web.BindHandler(h.ApplyPort))
	g.DELETE("/:host_id/vms/:id/ports/:port", web.BindHandler(h.RecyclePort))
	return h, nil
}

// GetInstallCommand 获取绑定宿主机命令
//
//	@Summary		获取绑定宿主机命令
//	@Description	获取绑定宿主机命令
//	@Tags			【用户】主机管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Success		200	{object}	web.Resp{data=domain.InstallCommand}	"成功"
//	@Router			/api/v1/users/hosts/install-command [get]
func (h *HostHandler) GetInstallCommand(c *web.Context) error {
	user := middleware.GetUser(c)
	cmd, err := h.usecase.GetInstallCommand(c.Request().Context(), user)
	if err != nil {
		return err
	}
	return c.Success(domain.InstallCommand{
		Command: cmd,
	})
}

func (h *HostHandler) Install(c *web.Context, req domain.InstallReq) error {
	script, err := h.usecase.InstallScript(c.Request().Context(), &req)
	if err != nil {
		return err
	}

	c.Response().Header().Set("Content-Type", "application/octet-stream")
	c.Response().Header().Set("Attachment", "filename=install_script.sh")
	_, err = c.Response().Write([]byte(script))
	return err
}

// HostList 获取主机列表
//
//	@Summary		获取主机列表
//	@Description	获取主机列表
//	@Tags			【用户】主机管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Success		200	{object}	web.Resp{data=domain.HostListResp}	"成功"
//	@Failure		401	{object}	web.Resp							"未授权"
//	@Failure		500	{object}	web.Resp							"服务器错误"
//	@Router			/api/v1/users/hosts [get]
func (h *HostHandler) HostList(c *web.Context) error {
	user := middleware.GetUser(c)
	resp, err := h.usecase.List(c.Request().Context(), user.ID)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// VMInfo 获取虚拟机详情
//
//	@Summary		获取虚拟机详情
//	@Description	获取虚拟机详情
//	@Tags			【用户】主机管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			id	path		string									true	"虚拟机ID"
//	@Success		200	{object}	web.Resp{data=domain.VirtualMachine}	"成功"
//	@Failure		401	{object}	web.Resp								"未授权"
//	@Failure		500	{object}	web.Resp								"服务器错误"
//	@Router			/api/v1/users/hosts/vms/{id} [get]
func (h *HostHandler) VMInfo(c *web.Context, req domain.IDReq[string]) error {
	user := middleware.GetUser(c)
	host, err := h.usecase.VMInfo(c.Request().Context(), user.ID, req.ID)
	if err != nil {
		return err
	}
	return c.Success(host)
}

// TerminalList 获取虚拟机终端session列表
//
//	@Summary		获取虚拟机终端session列表
//	@Description	获取虚拟机终端session列表
//	@Tags			【用户】终端连接管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			id	path		string								true	"虚拟机ID"
//	@Success		200	{object}	web.Resp{data=[]domain.Terminal}	"成功"
//	@Failure		401	{object}	web.Resp							"未授权"
//	@Failure		500	{object}	web.Resp							"服务器错误"
//	@Router			/api/v1/users/hosts/vms/{id}/terminals [get]
func (h *HostHandler) TerminalList(c *web.Context, req domain.IDReq[string]) error {
	user := middleware.GetUser(c)
	return h.usecase.WithVMPermission(c.Request().Context(), user.ID, req.ID, func(v *domain.VirtualMachine) error {
		ts, err := h.usecase.TerminalList(c.Request().Context(), req.ID)
		if err != nil {
			return err
		}
		return c.Success(ts)
	})
}

// CloseTerminal 关闭虚拟机终端session
//
//	@Summary		关闭虚拟机终端session
//	@Description	关闭虚拟机终端session
//	@Tags			【用户】终端连接管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			id			path		string								true	"虚拟机ID"
//	@Param			terminal_id	path		string								true	"终端 id"
//	@Success		200			{object}	web.Resp{data=[]domain.Terminal}	"成功"
//	@Failure		401			{object}	web.Resp							"未授权"
//	@Failure		500			{object}	web.Resp							"服务器错误"
//	@Router			/api/v1/users/hosts/vms/{id}/terminals/{terminal_id} [delete]
func (h *HostHandler) CloseTerminal(c *web.Context, req domain.CloseTerminalReq) error {
	user := middleware.GetUser(c)
	return h.usecase.WithVMPermission(c.Request().Context(), user.ID, req.ID, func(v *domain.VirtualMachine) error {
		if err := h.usecase.CloseTerminal(c.Request().Context(), req.ID, req.TerminalID); err != nil {
			return err
		}
		return c.Success(nil)
	})
}

// JoinTerminal 通过 WebSocket 加入终端
//
//	@Summary		通过 WebSocket 加入终端
//	@Description	通过 WebSocket 加入终端
//	@Tags			【用户】终端连接管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			request	query		domain.JoinTerminalReq					true	"参数"
//	@Success		200		{object}	web.Resp{data=domain.ShareTerminalResp}	"成功"
//	@Failure		400		{object}	web.Resp								"请求参数错误"
//	@Failure		401		{object}	web.Resp								"未授权"
//	@Router			/api/v1/users/hosts/vms/terminals/join [get]
func (h *HostHandler) JoinTerminal(c *web.Context, req domain.JoinTerminalReq) error {
	col := cvt.ZeroWithDefault(req.Col, 80)
	row := cvt.ZeroWithDefault(req.Row, 24)

	wsConn, err := ws.Accept(c.Response(), c.Request())
	if err != nil {
		h.logger.ErrorContext(c.Request().Context(), "failed to upgrade to websocket", "error", err)
		return err
	}
	defer wsConn.Close()

	h.logger.InfoContext(c.Request().Context(), "websocket connection established", "col", col, "row", row)

	shell, shared, err := h.usecase.JoinTerminal(c.Request().Context(), &req)
	if err != nil {
		h.logger.With("req", req).ErrorContext(c.Request().Context(), "failed to connect to vm terminal 验证密码失败", "error", err)
		wsConn.WriteJSON(domain.VMTerminalMessage{
			Type: domain.VMTerminalMessageTypeError,
			Data: "验证密码失败",
		})
		return err
	}
	defer shell.Stop()

	ctx, cancel := context.WithCancel(c.Request().Context())
	defer cancel()
	go h.terminalPing(ctx, cancel, wsConn, req.TerminalID)

	go func() {
		defer cancel()
		for {
			select {
			case <-ctx.Done():
				return
			default:
				message, err := wsConn.ReadMessage()
				if err != nil {
					h.logger.ErrorContext(ctx, "websocket read error", "error", err)
					return
				}
				var msg domain.VMTerminalMessage
				if err := json.Unmarshal(message, &msg); err != nil {
					h.logger.ErrorContext(ctx, "failed to unmarshal control message", "error", err)
					continue
				}

				switch msg.Type {
				case domain.VMTerminalMessageTypeData:
					b, err := base64.StdEncoding.DecodeString(msg.Data)
					if err != nil {
						h.logger.ErrorContext(ctx, "failed to decode base64 data", "error", err)
						continue
					}
					shell.Write(taskflow.TerminalData{
						Data: b,
					})

				case domain.VMTerminalMessageTypeResize:
					var resizeData domain.VMTerminalResizeData
					if err := json.Unmarshal([]byte(msg.Data), &resizeData); err != nil {
						h.logger.ErrorContext(ctx, "failed to unmarshal resize data", "error", err)
						continue
					}
					shell.Write(taskflow.TerminalData{
						Resize: &taskflow.TerminalSize{
							Col: uint32(resizeData.Col),
							Row: uint32(resizeData.Row),
						},
					})

				default:
					h.logger.WarnContext(ctx, "unknown control action", "action", msg.Type)
				}
			}
		}
	}()

	if err := shell.BlockRead(func(td taskflow.TerminalData) {
		if td.Connected {
			success := &domain.VMTerminalSuccess{
				Username:  shared.User.Name,
				Email:     shared.User.Email,
				AvatarURL: shared.User.AvatarURL,
			}
			b, err := json.Marshal(success)
			if err != nil {
				h.logger.ErrorContext(ctx, "failed to marshal success message", "error", err)
				b = fmt.Appendf(nil, `{"username": "%s"}`, shared.User.Name)
			}

			wsConn.WriteJSON(domain.VMTerminalMessage{
				Type: domain.VMTerminalMessageTypeConnected,
				Data: string(b),
			})
		}

		if len(td.Data) > 0 {
			data := base64.StdEncoding.EncodeToString(td.Data)
			msg := &domain.VMTerminalMessage{
				Type: domain.VMTerminalMessageTypeData,
				Data: data,
			}
			if err := wsConn.WriteJSON(msg); err != nil {
				h.logger.With("error", err).ErrorContext(ctx, "failed to write message to frontend")
			}
		}

		if td.Resize != nil {
			b, err := json.Marshal(td.Resize)
			if err != nil {
				h.logger.ErrorContext(ctx, "failed to marshal resize data", "error", err)
			} else {
				msg := &domain.VMTerminalMessage{
					Type: domain.VMTerminalMessageTypeResize,
					Data: string(b),
				}
				if err := wsConn.WriteJSON(msg); err != nil {
					h.logger.With("error", err).ErrorContext(ctx, "failed to write message to frontend")
				}
			}
		}

		if td.Error != nil {
			msg := &domain.VMTerminalMessage{
				Type: domain.VMTerminalMessageTypeError,
				Data: *td.Error,
			}
			if err := wsConn.WriteJSON(msg); err != nil {
				h.logger.With("error", err).ErrorContext(ctx, "failed to write message to frontend")
			}
			cancel()
		}
	}); err != nil {
		h.logger.ErrorContext(ctx, "failed to block read from vm terminal", "error", err)
		return err
	}

	return nil
}

// ConnectVMTerminal 通过 WebSocket 连接到虚拟机终端
//
//	@Summary		连接虚拟机终端
//	@Description	通过 WebSocket 连接到指定虚拟机的终端，支持双向通信
//	@Tags			【用户】终端连接管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			id			path		string		true	"虚拟机ID"
//	@Param			terminal_id	query		string		false	"终端ID"
//	@Param			col			query		int			false	"终端列数"	default(80)
//	@Param			row			query		int			false	"终端行数"	default(24)
//	@Success		101			{string}	string		"WebSocket 连接成功"
//	@Failure		400			{object}	web.Resp	"请求参数错误"
//	@Failure		401			{object}	web.Resp	"未授权"
//	@Failure		500			{object}	web.Resp	"服务器错误"
//	@Router			/api/v1/users/hosts/vms/{id}/terminals/connect [get]
func (h *HostHandler) ConnectVMTerminal(c *web.Context, req domain.TerminalReq) error {
	user := middleware.GetUser(c)
	logger := h.logger.With("fn", "ConnectVMTerminal", "user", user, "req", req)
	logger.InfoContext(c.Request().Context(), "connect vm terminal")

	if req.ID == "" {
		return errcode.ErrVMIDRequired
	}

	ctx, cancel := context.WithCancel(c.Request().Context())
	defer cancel()

	if err := h.usecase.WithVMPermission(ctx, user.ID, req.ID, func(v *domain.VirtualMachine) error {
		return nil
	}); err != nil {
		logger.With("error", err).ErrorContext(ctx, "failed to check permission")
		return err
	}

	req.Col = cvt.ZeroWithDefault(req.Col, 80)
	req.Row = cvt.ZeroWithDefault(req.Row, 24)

	wsConn, err := ws.Accept(c.Response(), c.Request())
	if err != nil {
		logger.ErrorContext(ctx, "failed to upgrade to websocket", "error", err)
		return err
	}
	defer wsConn.Close()
	go h.terminalPing(ctx, cancel, wsConn, req.TerminalID)

	logger.InfoContext(ctx, "websocket connection established")

	shell, err := h.usecase.ConnectVMTerminal(ctx, user.ID, req)
	if err != nil {
		logger.ErrorContext(ctx, "failed to connect to vm terminal", "error", err, "vm_id", req.ID)
		wsConn.WriteJSON(domain.VMTerminalMessage{
			Type: domain.VMTerminalMessageTypeError,
			Data: err.Error(),
		})
		return err
	}
	defer shell.Stop()

	go func() {
		defer cancel()
		for {
			select {
			case <-ctx.Done():
				logger.With("error", ctx.Err()).ErrorContext(ctx, "context canceled", "vm_id", req.ID)
				return
			default:
				message, err := wsConn.ReadMessage()
				if err != nil {
					logger.ErrorContext(ctx, "websocket read error", "error", err, "vm_id", req.ID)
					return
				}
				var msg domain.VMTerminalMessage
				if err := json.Unmarshal(message, &msg); err != nil {
					logger.ErrorContext(ctx, "failed to unmarshal control message", "error", err, "vm_id", req.ID)
					continue
				}

				switch msg.Type {
				case domain.VMTerminalMessageTypeData:
					b, err := base64.StdEncoding.DecodeString(msg.Data)
					if err != nil {
						logger.ErrorContext(ctx, "failed to decode base64 data", "error", err, "vm_id", req.ID)
						continue
					}
					shell.Write(taskflow.TerminalData{
						Data: b,
					})

				case domain.VMTerminalMessageTypeResize:
					var resizeData domain.VMTerminalResizeData
					if err := json.Unmarshal([]byte(msg.Data), &resizeData); err != nil {
						logger.ErrorContext(ctx, "failed to unmarshal resize data", "error", err, "vm_id", req.ID)
						continue
					}
					logger.InfoContext(ctx, "terminal resize requested", "vm_id", req.ID, "col", resizeData.Col, "row", resizeData.Row)
					shell.Write(taskflow.TerminalData{
						Resize: &taskflow.TerminalSize{
							Col: uint32(resizeData.Col),
							Row: uint32(resizeData.Row),
						},
					})

				default:
					logger.WarnContext(ctx, "unknown control action", "action", msg.Type, "vm_id", req.ID)
				}
			}
		}
	}()

	if err := shell.BlockRead(func(td taskflow.TerminalData) {
		if td.Connected {
			success := &domain.VMTerminalSuccess{
				Username:  user.Name,
				Email:     user.Email,
				AvatarURL: user.AvatarURL,
			}
			b, err := json.Marshal(success)
			if err != nil {
				logger.ErrorContext(ctx, "failed to marshal success message", "error", err)
				b = fmt.Appendf(nil, `{"username": "%s"}`, user.Name)
			}
			wsConn.WriteJSON(domain.VMTerminalMessage{
				Type: domain.VMTerminalMessageTypeConnected,
				Data: string(b),
			})
		}

		if len(td.Data) > 0 {
			data := base64.StdEncoding.EncodeToString(td.Data)
			msg := &domain.VMTerminalMessage{
				Type: domain.VMTerminalMessageTypeData,
				Data: data,
			}
			if err := wsConn.WriteJSON(msg); err != nil {
				logger.With("error", err).ErrorContext(ctx, "failed to write message to frontend")
			}
		}

		if td.Resize != nil {
			b, err := json.Marshal(td.Resize)
			if err != nil {
				logger.ErrorContext(ctx, "failed to marshal resize data", "error", err)
			} else {
				msg := &domain.VMTerminalMessage{
					Type: domain.VMTerminalMessageTypeResize,
					Data: string(b),
				}
				if err := wsConn.WriteJSON(msg); err != nil {
					logger.With("error", err).ErrorContext(ctx, "failed to write message to frontend")
				}
			}
		}
		if td.Error != nil {
			msg := &domain.VMTerminalMessage{
				Type: domain.VMTerminalMessageTypeError,
				Data: *td.Error,
			}
			if err := wsConn.WriteJSON(msg); err != nil {
				logger.With("error", err).ErrorContext(ctx, "failed to write message to frontend")
			}

			cancel()
		}
	}); err != nil {
		logger.ErrorContext(ctx, "failed to block read from vm terminal", "error", err)
		return err
	}

	logger.InfoContext(ctx, "websocket connection closed")

	return nil
}

func (h *HostHandler) terminalPing(
	ctx context.Context,
	cancel context.CancelFunc,
	wsConn *ws.WebsocketManager,
	terminalID string,
) {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := wsConn.WriteJSON(domain.VMTerminalMessage{
				Type: domain.VMTerminalMessageTypePing,
			}); err != nil {
				h.logger.With("error", err, "terminal", terminalID).Warn("failed to ping ws terminal")
				cancel()
				return
			}
		}
	}
}

// ShareTerminal 分享终端
//
//	@Summary		分享终端
//	@Description	分享终端
//	@Tags			【用户】终端连接管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			request	body		domain.ShareTerminalReq					true	"分享终端请求"
//	@Success		200		{object}	web.Resp{data=domain.ShareTerminalResp}	"成功"
//	@Failure		400		{object}	web.Resp								"请求参数错误"
//	@Failure		401		{object}	web.Resp								"未授权"
//	@Router			/api/v1/users/hosts/vms/{id}/terminals/share [post]
func (h *HostHandler) ShareTerminal(c *web.Context, req domain.ShareTerminalReq) error {
	user := middleware.GetUser(c)
	return h.usecase.WithVMPermission(c.Request().Context(), user.ID, req.ID, func(v *domain.VirtualMachine) error {
		resp, err := h.usecase.ShareTerminal(c.Request().Context(), user, &req)
		if err != nil {
			return err
		}
		return c.Success(resp)
	})
}

// CreateVM 创建虚拟机
//
//	@Summary		创建虚拟机
//	@Description	创建虚拟机
//	@Tags			【用户】主机管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			request	body		domain.CreateVMReq						true	"创建虚拟机请求"
//	@Success		200		{object}	web.Resp{data=domain.VirtualMachine}	"成功"
//	@Failure		400		{object}	web.Resp								"请求参数错误"
//	@Failure		401		{object}	web.Resp								"未授权"
//	@Failure		500		{object}	web.Resp								"服务器错误"
//	@Router			/api/v1/users/hosts/vms [post]
func (h *HostHandler) CreateVM(c *web.Context, req domain.CreateVMReq) error {
	user := middleware.GetUser(c)

	// 公共主机逻辑（仅在内部项目注入 PublicHostUsecase 时生效）
	if req.HostID == consts.PUBLIC_HOST_ID && h.pubhost != nil {
		if req.Life > 3*60*60 || req.Life <= 0 {
			return errcode.ErrPublicHostBeyondLimit
		}

		host, err := h.pubhost.PickHost(c.Request().Context())
		if err != nil {
			return err
		}
		req.HostID = host.ID
		req.UsePublicHost = true
		h.logger.With("host", host).DebugContext(c.Request().Context(), "pick public host")
	}

	vm, err := h.usecase.CreateVM(c.Request().Context(), user, &req)
	if err != nil {
		h.logger.With("error", err).ErrorContext(c.Request().Context(), "failed to create vm")
		return err
	}

	return c.Success(vm)
}

// DeleteVM 删除虚拟机
//
//	@Summary		删除虚拟机
//	@Description	删除虚拟机
//	@Tags			【用户】主机管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			host_id	path		string		true	"宿主机ID"
//	@Param			id		path		string		true	"虚拟机ID"
//	@Success		200		{object}	web.Resp	"成功"
//	@Failure		400		{object}	web.Resp	"请求参数错误"
//	@Failure		401		{object}	web.Resp	"未授权"
//	@Failure		404		{object}	web.Resp	"虚拟机不存在"
//	@Failure		500		{object}	web.Resp	"服务器错误"
//	@Router			/api/v1/users/hosts/{host_id}/vms/{id} [delete]
func (h *HostHandler) DeleteVM(c *web.Context, req domain.DeleteVirtualMachineReq) error {
	user := middleware.GetUser(c)
	err := h.usecase.DeleteVM(c.Request().Context(), user.ID, req.HostID, req.ID)
	if err != nil {
		return err
	}
	return c.Success(nil)
}

// UpdateVM 修改虚拟机
//
//	@Summary		修改虚拟机
//	@Description	修改虚拟机
//	@Tags			【用户】主机管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			req	body		domain.UpdateVMReq						true	"修改虚拟机请求"
//	@Success		200	{object}	web.Resp{data=domain.VirtualMachine}	"成功"
//	@Failure		400	{object}	web.Resp								"请求参数错误"
//	@Failure		401	{object}	web.Resp								"未授权"
//	@Failure		404	{object}	web.Resp								"虚拟机不存在"
//	@Failure		500	{object}	web.Resp								"服务器错误"
//	@Router			/api/v1/users/hosts/vms [put]
func (h *HostHandler) UpdateVM(c *web.Context, req domain.UpdateVMReq) error {
	user := middleware.GetUser(c)
	req.UID = user.ID
	req.UserName = user.Name
	resp, err := h.usecase.UpdateVM(c.Request().Context(), req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// DeleteHost 删除宿主机
//
//	@Summary		删除宿主机
//	@Description	删除宿主机
//	@Tags			【用户】主机管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			id	path		string		true	"宿主机ID"
//	@Success		200	{object}	web.Resp	"成功"
//	@Failure		400	{object}	web.Resp	"请求参数错误"
//	@Failure		401	{object}	web.Resp	"未授权"
//	@Failure		500	{object}	web.Resp	"服务器错误"
//	@Router			/api/v1/users/hosts/{id} [delete]
func (h *HostHandler) DeleteHost(c *web.Context, req domain.IDReq[string]) error {
	user := middleware.GetUser(c)
	if err := h.usecase.DeleteHost(c.Request().Context(), user.ID, req.ID); err != nil {
		return err
	}
	return c.Success(nil)
}

// UpdateHost 更新宿主机
//
//	@Summary		更新宿主机
//	@Description	更新宿主机
//	@Tags			【用户】主机管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			id		path		string					true	"宿主机ID"
//	@Param			request	body		domain.UpdateHostReq	true	"更新宿主机请求"
//	@Success		200		{object}	web.Resp				"成功"
//	@Failure		400		{object}	web.Resp				"请求参数错误"
//	@Failure		401		{object}	web.Resp				"未授权"
//	@Failure		500		{object}	web.Resp				"服务器错误"
//	@Router			/api/v1/users/hosts/{id} [put]
func (h *HostHandler) UpdateHost(c *web.Context, req domain.UpdateHostReq) error {
	user := middleware.GetUser(c)
	if err := h.usecase.UpdateHost(c.Request().Context(), user.ID, &req); err != nil {
		return err
	}
	return c.Success(nil)
}

// ApplyPort 为开发环境申请一个端口
//
//	@Summary		申请端口
//	@Description	为开发环境申请一个端口
//	@Tags			【用户】主机管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			host_id	path		string							true	"宿主机ID"
//	@Param			id		path		string							true	"虚拟机ID"
//	@Param			request	body		domain.ApplyPortReq				true	"申请端口请求"
//	@Success		200		{object}	web.Resp{data=domain.VMPort}	"成功"
//	@Failure		400		{object}	web.Resp						"请求参数错误"
//	@Failure		401		{object}	web.Resp						"未授权"
//	@Failure		500		{object}	web.Resp						"服务器错误"
//	@Router			/api/v1/users/hosts/{host_id}/vms/{id}/ports [post]
func (h *HostHandler) ApplyPort(c *web.Context, req domain.ApplyPortReq) error {
	user := middleware.GetUser(c)
	port, err := h.usecase.ApplyPort(c.Request().Context(), user.ID, &req)
	if err != nil {
		h.logger.With("error", err).ErrorContext(c.Request().Context(), "failed to apply port")
		return errcode.ErrApplyPortFailed.Wrap(err)
	}
	return c.Success(port)
}

// RecyclePort 为开发环境回收一个端口
//
//	@Summary		回收端口
//	@Description	为开发环境回收一个端口
//	@Tags			【用户】主机管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			host_id	path		string					true	"宿主机ID"
//	@Param			id		path		string					true	"虚拟机ID"
//	@Param			request	body		domain.RecyclePortReq	true	"回收端口请求"
//	@Success		200		{object}	web.Resp				"成功"
//	@Failure		400		{object}	web.Resp				"请求参数错误"
//	@Failure		401		{object}	web.Resp				"未授权"
//	@Failure		500		{object}	web.Resp				"服务器错误"
//	@Router			/api/v1/users/hosts/{host_id}/vms/{id}/ports/{port} [delete]
func (h *HostHandler) RecyclePort(c *web.Context, req domain.RecyclePortReq) error {
	user := middleware.GetUser(c)
	if err := h.usecase.RecyclePort(c.Request().Context(), user.ID, &req); err != nil {
		h.logger.With("error", err).ErrorContext(c.Request().Context(), "failed to recycle port")
		return errcode.ErrRecyclePortFailed.Wrap(err)
	}
	return c.Success(nil)
}
