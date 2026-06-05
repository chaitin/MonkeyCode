package v1

import (
	"context"

	"github.com/GoYoko/web"
	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/middleware"
)

type TeamPolicyHandler struct {
	usecase domain.TeamPolicyUsecase
	repo    domain.TeamPolicyRepo
}

func NewTeamPolicyHandler(i *do.Injector) (*TeamPolicyHandler, error) {
	w := do.MustInvoke[*web.Web](i)
	auth := do.MustInvoke[*middleware.AuthMiddleware](i)
	audit := do.MustInvoke[*middleware.AuditMiddleware](i)

	h := &TeamPolicyHandler{
		usecase: do.MustInvoke[domain.TeamPolicyUsecase](i),
		repo:    do.MustInvoke[domain.TeamPolicyRepo](i),
	}

	adminAuth := middleware.TeamAdminAuth(func(ctx context.Context, teamID, userID uuid.UUID) bool {
		member, err := h.repo.GetMember(ctx, teamID, userID)
		if err != nil {
			return false
		}
		return member.Role == consts.TeamMemberRoleAdmin
	})

	g := w.Group("/api/v1/teams/task-vm-idle-policy")
	g.GET("", web.BaseHandler(h.Get), auth.TeamAuth())
	g.PUT("", web.BindHandler(h.Update), auth.TeamAuth(), adminAuth, audit.Audit("update_team_task_vm_idle_policy"))

	return h, nil
}

// Get 获取任务开发环境空闲策略
//
//	@Summary		获取任务开发环境空闲策略
//	@Description	获取当前团队任务创建开发环境的空闲休眠和回收策略
//	@Tags			【Team 管理员】开发环境管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAITeamAuth
//	@Success		200	{object}	web.Resp{data=domain.TeamTaskVMIdlePolicy}	"成功"
//	@Router			/api/v1/teams/task-vm-idle-policy [get]
func (h *TeamPolicyHandler) Get(c *web.Context) error {
	teamUser := middleware.GetTeamUser(c)
	resp, err := h.usecase.GetTaskVMIdlePolicy(c.Request().Context(), teamUser)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// Update 更新任务开发环境空闲策略
//
//	@Summary		更新任务开发环境空闲策略
//	@Description	更新当前团队任务创建开发环境的空闲休眠和回收策略
//	@Tags			【Team 管理员】开发环境管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAITeamAuth
//	@Param			req	body		domain.UpdateTeamTaskVMIdlePolicyReq		true	"请求参数"
//	@Success		200	{object}	web.Resp{data=domain.TeamTaskVMIdlePolicy}	"成功"
//	@Router			/api/v1/teams/task-vm-idle-policy [put]
func (h *TeamPolicyHandler) Update(c *web.Context, req domain.UpdateTeamTaskVMIdlePolicyReq) error {
	teamUser := middleware.GetTeamUser(c)
	resp, err := h.usecase.UpdateTaskVMIdlePolicy(c.Request().Context(), teamUser, &req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}
