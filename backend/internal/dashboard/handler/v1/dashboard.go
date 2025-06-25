package v1

import (
	"github.com/GoYoko/web"

	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/internal/middleware"
)

type DashboardHandler struct {
	usecase domain.DashboardUsecase
}

func NewDashboardHandler(
	w *web.Web,
	usecase domain.DashboardUsecase,
	auth *middleware.AuthMiddleware,
) *DashboardHandler {
	h := &DashboardHandler{usecase: usecase}

	g := w.Group("/api/v1/dashboard")
	g.Use(auth.Auth())
	g.GET("/statistics", web.BaseHandler(h.Statistics))
	g.GET("/category-stat", web.BaseHandler(h.CategoryStat))
	g.GET("/time-stat", web.BaseHandler(h.TimeStat))
	g.GET("/user-stat", web.BaseHandler(h.UserStat))
	g.GET("/user-events", web.BaseHandler(h.UserEvents))
	g.GET("/user-code-rank", web.BaseHandler(h.UserCodeRank))
	g.GET("/user-heatmap", web.BaseHandler(h.UserHeatmap))

	return h
}

// Statistics 获取统计信息
//
//	@Tags			Dashboard
//	@Summary		获取统计信息
//	@Description	获取统计信息
//	@ID				statistics-dashboard
//	@Accept			json
//	@Produce		json
//	@Success		200	{object}	web.Resp{data=domain.Statistics}
//	@Router			/api/v1/dashboard/statistics [get]
func (h *DashboardHandler) Statistics(c *web.Context) error {
	statistics, err := h.usecase.Statistics(c.Request().Context())
	if err != nil {
		return err
	}
	return c.Success(statistics)
}

// CategoryStat 获取分类统计信息
//
//	@Tags			Dashboard
//	@Summary		获取分类统计信息
//	@Description	获取分类统计信息
//	@ID				category-stat-dashboard
//	@Accept			json
//	@Produce		json
//	@Success		200	{object}	web.Resp{data=domain.CategoryStat}
//	@Router			/api/v1/dashboard/category-stat [get]
func (h *DashboardHandler) CategoryStat(c *web.Context) error {
	categoryStat, err := h.usecase.CategoryStat(c.Request().Context())
	if err != nil {
		return err
	}
	return c.Success(categoryStat)
}

// TimeStat 获取时间统计信息
//
//	@Tags			Dashboard
//	@Summary		获取时间统计信息
//	@Description	获取时间统计信息
//	@ID				time-stat-dashboard
//	@Accept			json
//	@Produce		json
//	@Success		200	{object}	web.Resp{data=domain.TimeStat}
//	@Router			/api/v1/dashboard/time-stat [get]
func (h *DashboardHandler) TimeStat(c *web.Context) error {
	timeStat, err := h.usecase.TimeStat(c.Request().Context())
	if err != nil {
		return err
	}
	return c.Success(timeStat)
}

// UserStat 获取用户统计信息
//
//	@Tags			Dashboard
//	@Summary		获取用户统计信息
//	@Description	获取用户统计信息
//	@ID				user-stat-dashboard
//	@Accept			json
//	@Produce		json
//	@Param			user_id	query		string	false	"用户ID"
//	@Success		200		{object}	web.Resp{data=domain.UserStat}
//	@Router			/api/v1/dashboard/user-stat [get]
func (h *DashboardHandler) UserStat(c *web.Context) error {
	userStat, err := h.usecase.UserStat(c.Request().Context(), c.QueryParam("user_id"))
	if err != nil {
		return err
	}
	return c.Success(userStat)
}

// UserEvents 获取用户事件
//
//	@Tags			Dashboard
//	@Summary		获取用户事件
//	@Description	获取用户事件
//	@ID				user-events-dashboard
//	@Accept			json
//	@Produce		json
//	@Param			user_id	query		string	true	"用户ID"
//	@Success		200		{object}	web.Resp{data=[]domain.UserEvent}
//	@Router			/api/v1/dashboard/user-events [get]
func (h *DashboardHandler) UserEvents(c *web.Context) error {
	userEvents, err := h.usecase.UserEvents(c.Request().Context(), c.QueryParam("user_id"))
	if err != nil {
		return err
	}
	return c.Success(userEvents)
}

// UserCodeRank 用户贡献榜
//
//	@Tags			Dashboard
//	@Summary		用户贡献榜
//	@Description	用户贡献榜
//	@ID				user-code-rank-dashboard
//	@Accept			json
//	@Produce		json
//	@Success		200	{object}	web.Resp{data=[]domain.UserCodeRank}
//	@Router			/api/v1/dashboard/user-code-rank [get]
func (h *DashboardHandler) UserCodeRank(c *web.Context) error {
	userCodeRank, err := h.usecase.UserCodeRank(c.Request().Context())
	if err != nil {
		return err
	}
	return c.Success(userCodeRank)
}

// UserHeatmap 用户热力图
//
//	@Tags			Dashboard
//	@Summary		用户热力图
//	@Description	用户热力图
//	@ID				user-heatmap-dashboard
//	@Accept			json
//	@Produce		json
//	@Param			user_id	query		string	true	"用户ID"
//	@Success		200		{object}	web.Resp{data=domain.UserHeatmapResp}
//	@Router			/api/v1/dashboard/user-heatmap [get]
func (h *DashboardHandler) UserHeatmap(c *web.Context) error {
	userHeatmap, err := h.usecase.UserHeatmap(c.Request().Context(), c.QueryParam("user_id"))
	if err != nil {
		return err
	}
	return c.Success(userHeatmap)
}
