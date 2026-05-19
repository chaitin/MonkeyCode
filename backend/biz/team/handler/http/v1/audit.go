package v1

import (
	"log/slog"

	"github.com/GoYoko/web"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/middleware"
)

// AuditHandler 审计日志处理器
type AuditHandler struct {
	logger  *slog.Logger
	usecase domain.AuditUsecase
}

// NewAuditHandler 创建审计日志处理器
func NewAuditHandler(i *do.Injector) (*AuditHandler, error) {
	w := do.MustInvoke[*web.Web](i)
	logger := do.MustInvoke[*slog.Logger](i)
	usecase := do.MustInvoke[domain.AuditUsecase](i)
	auth := do.MustInvoke[*middleware.AuthMiddleware](i)
	targetActive := do.MustInvoke[*middleware.TargetActiveMiddleware](i)

	h := &AuditHandler{
		logger:  logger.With("component", "handler.audit"),
		usecase: usecase,
	}

	v1 := w.Group("/api/v1/teams/audits")
	v1.GET("", web.BindHandler(h.ListAudits), auth.TeamAuth(), targetActive.TargetActive())

	return h, nil
}

// ListAudits 查询审计日志列表
//
//	@Summary		查询审计日志
//	@Description	查询审计日志列表，支持条件过滤和分页
//	@Tags			【Team管理员】审计日志
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAITeamAuth
//	@Param			req	query		domain.ListAuditsRequest	false	"查询参数"
//	@Success		200	{object}	domain.ListAuditsResponse
//	@Failure		401	{object}	web.Resp	"未授权"
//	@Failure		500	{object}	web.Resp	"服务器内部错误"
//	@Router			/api/v1/teams/audits [get]
func (h *AuditHandler) ListAudits(c *web.Context, req domain.ListAuditsRequest) error {
	if req.Limit <= 0 {
		req.Limit = 10000
	}
	teamUser := middleware.GetTeamUser(c)
	resp, err := h.usecase.ListAudits(c.Request().Context(), teamUser, &req)
	if err != nil {
		h.logger.ErrorContext(c.Request().Context(), "failed to list audits", "error", err)
		return errcode.ErrInternalServer
	}
	return c.Success(resp)
}
