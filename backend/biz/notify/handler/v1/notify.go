package v1

import (
	"log/slog"

	"github.com/GoYoko/web"
	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/middleware"
)

// NotifyHandler 通知渠道管理 HTTP 处理器
type NotifyHandler struct {
	channelUsecase domain.NotifyChannelUsecase
	logger         *slog.Logger
}

// NewNotifyHandler 创建通知处理器并注册路由
func NewNotifyHandler(i *do.Injector) (*NotifyHandler, error) {
	w := do.MustInvoke[*web.Web](i)
	auth := do.MustInvoke[*middleware.AuthMiddleware](i)

	h := &NotifyHandler{
		channelUsecase: do.MustInvoke[domain.NotifyChannelUsecase](i),
		logger:         do.MustInvoke[*slog.Logger](i).With("module", "handler.notify"),
	}

	// 用户接口
	usr := w.Group("/api/v1/users/notify")
	usr.Use(auth.Auth())
	usr.POST("/channels", web.BindHandler(h.CreateUserChannel))
	usr.GET("/channels", web.BaseHandler(h.ListUserChannels))
	usr.PUT("/channels/:id", web.BindHandler(h.UpdateUserChannel))
	usr.DELETE("/channels/:id", web.BindHandler(h.DeleteUserChannel))
	usr.POST("/channels/:id/test", web.BindHandler(h.TestUserChannel))
	usr.GET("/event-types", web.BindHandler(h.ListEventTypes))

	// 团队接口
	team := w.Group("/api/v1/teams/notify")
	team.Use(auth.TeamAuth())
	team.POST("/channels", web.BindHandler(h.CreateTeamChannel))
	team.GET("/channels", web.BaseHandler(h.ListTeamChannels))
	team.PUT("/channels/:id", web.BindHandler(h.UpdateTeamChannel))
	team.DELETE("/channels/:id", web.BindHandler(h.DeleteTeamChannel))
	team.POST("/channels/:id/test", web.BindHandler(h.TestTeamChannel))
	team.GET("/event-types", web.BindHandler(h.ListEventTypes))

	return h, nil
}

// ---- 用户接口 ----

// CreateUserChannel 创建用户推送渠道
//
//	@Summary		创建用户推送渠道
//	@Description	创建用户推送渠道（钉钉/飞书/企业微信/Webhook），同时配置订阅的事件类型
//	@Tags			通知推送
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			param	body		domain.CreateNotifyChannelReq		true	"渠道参数"
//	@Success		200		{object}	web.Resp{data=domain.NotifyChannel}	"成功"
//	@Failure		401		{object}	web.Resp							"未授权"
//	@Failure		500		{object}	web.Resp							"服务器内部错误"
//	@Router			/api/v1/users/notify/channels [post]
func (h *NotifyHandler) CreateUserChannel(c *web.Context, req domain.CreateNotifyChannelReq) error {
	user := middleware.GetUser(c)
	ch, err := h.channelUsecase.Create(c.Request().Context(), user.ID, consts.NotifyOwnerUser, &req)
	if err != nil {
		return err
	}
	return c.Success(ch)
}

// ListUserChannels 列出用户推送渠道
//
//	@Summary		列出用户推送渠道
//	@Description	列出当前用户的所有推送渠道及其订阅配置
//	@Tags			通知推送
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Success		200	{object}	web.Resp{data=[]domain.NotifyChannel}	"成功"
//	@Failure		401	{object}	web.Resp								"未授权"
//	@Failure		500	{object}	web.Resp								"服务器内部错误"
//	@Router			/api/v1/users/notify/channels [get]
func (h *NotifyHandler) ListUserChannels(c *web.Context) error {
	user := middleware.GetUser(c)
	channels, err := h.channelUsecase.List(c.Request().Context(), user.ID, consts.NotifyOwnerUser)
	if err != nil {
		return err
	}
	return c.Success(channels)
}

type updateChannelReq struct {
	ID uuid.UUID `param:"id" validate:"required"`
	domain.UpdateNotifyChannelReq
}

// UpdateUserChannel 更新用户推送渠道
//
//	@Summary		更新用户推送渠道
//	@Description	更新用户推送渠道配置及订阅的事件类型
//	@Tags			通知推送
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			id		path		string								true	"渠道ID"
//	@Param			param	body		domain.UpdateNotifyChannelReq		true	"更新参数"
//	@Success		200		{object}	web.Resp{data=domain.NotifyChannel}	"成功"
//	@Failure		401		{object}	web.Resp							"未授权"
//	@Failure		500		{object}	web.Resp							"服务器内部错误"
//	@Router			/api/v1/users/notify/channels/{id} [put]
func (h *NotifyHandler) UpdateUserChannel(c *web.Context, req updateChannelReq) error {
	user := middleware.GetUser(c)
	ch, err := h.channelUsecase.Update(c.Request().Context(), user.ID, req.ID, &req.UpdateNotifyChannelReq)
	if err != nil {
		return err
	}
	return c.Success(ch)
}

// DeleteUserChannel 删除用户推送渠道
//
//	@Summary		删除用户推送渠道
//	@Description	删除用户推送渠道及其关联的订阅
//	@Tags			通知推送
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			id	path		string		true	"渠道ID"
//	@Success		200	{object}	web.Resp	"成功"
//	@Failure		401	{object}	web.Resp	"未授权"
//	@Failure		500	{object}	web.Resp	"服务器内部错误"
//	@Router			/api/v1/users/notify/channels/{id} [delete]
func (h *NotifyHandler) DeleteUserChannel(c *web.Context, req domain.IDReq[uuid.UUID]) error {
	user := middleware.GetUser(c)
	if err := h.channelUsecase.Delete(c.Request().Context(), user.ID, req.ID); err != nil {
		return err
	}
	return c.Success(nil)
}

// TestUserChannel 测试用户推送渠道
//
//	@Summary		测试用户推送渠道
//	@Description	发送测试消息验证渠道配置是否正确
//	@Tags			通知推送
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			id	path		string		true	"渠道ID"
//	@Success		200	{object}	web.Resp	"成功"
//	@Failure		401	{object}	web.Resp	"未授权"
//	@Failure		500	{object}	web.Resp	"服务器内部错误"
//	@Router			/api/v1/users/notify/channels/{id}/test [post]
func (h *NotifyHandler) TestUserChannel(c *web.Context, req domain.IDReq[uuid.UUID]) error {
	user := middleware.GetUser(c)
	if err := h.channelUsecase.Test(c.Request().Context(), user.ID, req.ID); err != nil {
		return err
	}
	return c.Success(nil)
}

// ---- 团队接口 ----

// CreateTeamChannel 创建团队推送渠道
//
//	@Summary		创建团队推送渠道
//	@Description	创建团队推送渠道（钉钉/飞书/企业微信/Webhook），同时配置订阅的事件类型
//	@Tags			【Team 管理员】通知推送
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAITeamAuth
//	@Param			param	body		domain.CreateNotifyChannelReq		true	"渠道参数"
//	@Success		200		{object}	web.Resp{data=domain.NotifyChannel}	"成功"
//	@Failure		401		{object}	web.Resp							"未授权"
//	@Failure		500		{object}	web.Resp							"服务器内部错误"
//	@Router			/api/v1/teams/notify/channels [post]
func (h *NotifyHandler) CreateTeamChannel(c *web.Context, req domain.CreateNotifyChannelReq) error {
	teamUser := middleware.GetTeamUser(c)
	ch, err := h.channelUsecase.Create(c.Request().Context(), teamUser.Team.ID, consts.NotifyOwnerTeam, &req)
	if err != nil {
		return err
	}
	return c.Success(ch)
}

// ListTeamChannels 列出团队推送渠道
//
//	@Summary		列出团队推送渠道
//	@Description	列出当前团队的所有推送渠道及其订阅配置
//	@Tags			【Team 管理员】通知推送
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAITeamAuth
//	@Success		200	{object}	web.Resp{data=[]domain.NotifyChannel}	"成功"
//	@Failure		401	{object}	web.Resp								"未授权"
//	@Failure		500	{object}	web.Resp								"服务器内部错误"
//	@Router			/api/v1/teams/notify/channels [get]
func (h *NotifyHandler) ListTeamChannels(c *web.Context) error {
	teamUser := middleware.GetTeamUser(c)
	channels, err := h.channelUsecase.List(c.Request().Context(), teamUser.Team.ID, consts.NotifyOwnerTeam)
	if err != nil {
		return err
	}
	return c.Success(channels)
}

// UpdateTeamChannel 更新团队推送渠道
//
//	@Summary		更新团队推送渠道
//	@Description	更新团队推送渠道配置及订阅的事件类型
//	@Tags			【Team 管理员】通知推送
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAITeamAuth
//	@Param			id		path		string								true	"渠道ID"
//	@Param			param	body		domain.UpdateNotifyChannelReq		true	"更新参数"
//	@Success		200		{object}	web.Resp{data=domain.NotifyChannel}	"成功"
//	@Failure		401		{object}	web.Resp							"未授权"
//	@Failure		500		{object}	web.Resp							"服务器内部错误"
//	@Router			/api/v1/teams/notify/channels/{id} [put]
func (h *NotifyHandler) UpdateTeamChannel(c *web.Context, req updateChannelReq) error {
	teamUser := middleware.GetTeamUser(c)
	ch, err := h.channelUsecase.Update(c.Request().Context(), teamUser.Team.ID, req.ID, &req.UpdateNotifyChannelReq)
	if err != nil {
		return err
	}
	return c.Success(ch)
}

// DeleteTeamChannel 删除团队推送渠道
//
//	@Summary		删除团队推送渠道
//	@Description	删除团队推送渠道及其关联的订阅
//	@Tags			【Team 管理员】通知推送
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAITeamAuth
//	@Param			id	path		string		true	"渠道ID"
//	@Success		200	{object}	web.Resp	"成功"
//	@Failure		401	{object}	web.Resp	"未授权"
//	@Failure		500	{object}	web.Resp	"服务器内部错误"
//	@Router			/api/v1/teams/notify/channels/{id} [delete]
func (h *NotifyHandler) DeleteTeamChannel(c *web.Context, req domain.IDReq[uuid.UUID]) error {
	teamUser := middleware.GetTeamUser(c)
	if err := h.channelUsecase.Delete(c.Request().Context(), teamUser.Team.ID, req.ID); err != nil {
		return err
	}
	return c.Success(nil)
}

// TestTeamChannel 测试团队推送渠道
//
//	@Summary		测试团队推送渠道
//	@Description	发送测试消息验证渠道配置是否正确
//	@Tags			【Team 管理员】通知推送
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAITeamAuth
//	@Param			id	path		string		true	"渠道ID"
//	@Success		200	{object}	web.Resp	"成功"
//	@Failure		401	{object}	web.Resp	"未授权"
//	@Failure		500	{object}	web.Resp	"服务器内部错误"
//	@Router			/api/v1/teams/notify/channels/{id}/test [post]
func (h *NotifyHandler) TestTeamChannel(c *web.Context, req domain.IDReq[uuid.UUID]) error {
	teamUser := middleware.GetTeamUser(c)
	if err := h.channelUsecase.Test(c.Request().Context(), teamUser.Team.ID, req.ID); err != nil {
		return err
	}
	return c.Success(nil)
}

// ---- 公共接口 ----

// ListEventTypes 列出所有支持的事件类型
//
//	@Summary		列出事件类型
//	@Description	列出所有支持订阅的事件类型
//	@Tags			通知推送
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Success		200	{object}	web.Resp{data=[]consts.NotifyEventTypeInfo}	"成功"
//	@Failure		401	{object}	web.Resp									"未授权"
//	@Failure		500	{object}	web.Resp									"服务器内部错误"
//	@Router			/api/v1/users/notify/event-types [get]
func (h *NotifyHandler) ListEventTypes(c *web.Context, _ struct{}) error {
	_placeholder()
	return c.Success(consts.AllNotifyEventTypes)
}

// ListEventTypes 列出所有支持的事件类型
//
//	@Summary		列出事件类型
//	@Description	列出所有支持订阅的事件类型
//	@Tags			通知推送
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Success		200	{object}	web.Resp{data=[]consts.NotifyEventTypeInfo}	"成功"
//	@Failure		401	{object}	web.Resp									"未授权"
//	@Failure		500	{object}	web.Resp									"服务器内部错误"
//	@Router			/api/v1/teams/notify/event-types [get]
func _placeholder() {}
