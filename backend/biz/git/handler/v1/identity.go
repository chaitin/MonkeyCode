package v1

import (
	"log/slog"
	"net/url"

	"github.com/GoYoko/web"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/middleware"
)

// GitIdentityHandler Git 身份认证处理器
type GitIdentityHandler struct {
	usecase domain.GitIdentityUsecase
	logger  *slog.Logger
}

// NewGitIdentityHandler 创建 Git 身份认证处理器
func NewGitIdentityHandler(i *do.Injector) (*GitIdentityHandler, error) {
	w := do.MustInvoke[*web.Web](i)
	auth := do.MustInvoke[*middleware.AuthMiddleware](i)
	targetActive := do.MustInvoke[*middleware.TargetActiveMiddleware](i)

	h := &GitIdentityHandler{
		usecase: do.MustInvoke[domain.GitIdentityUsecase](i),
		logger:  do.MustInvoke[*slog.Logger](i).With("module", "handler.git_identity"),
	}

	g := w.Group("/api/v1/users/git-identities")
	g.Use(auth.Auth(), targetActive.TargetActive())
	g.GET("", web.BindHandler(h.List))
	g.GET("/:id", web.BindHandler(h.Get))
	g.POST("", web.BindHandler(h.Add))
	g.PUT("/:id", web.BindHandler(h.Update))
	g.DELETE("/:id", web.BindHandler(h.Delete))
	g.GET("/:identity_id/:escaped_repo_full_name/branches", web.BindHandler(h.ListBranches))

	return h, nil
}

// List 获取当前用户的 Git 身份认证列表
//
//	@Summary		列表
//	@Description	获取当前用户的 Git 身份认证列表
//	@Tags			【用户】git 身份管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			flush	query		bool								false	"是否刷新缓存"
//	@Success		200		{object}	web.Resp{data=[]domain.GitIdentity}	"成功"
//	@Failure		500		{object}	web.Resp							"服务器内部错误"
//	@Router			/api/v1/users/git-identities [get]
func (h *GitIdentityHandler) List(c *web.Context, req domain.ListGitIdentityReq) error {
	user := middleware.GetUser(c)
	list, err := h.usecase.List(c.Request().Context(), user.ID, req.Flush)
	if err != nil {
		return errcode.ErrDatabaseQuery.Wrap(err)
	}
	return c.Success(list)
}

// Get 获取单个 Git 身份认证详情
//
//	@Summary		详情
//	@Description	获取单个 Git 身份认证详情
//	@Tags			【用户】git 身份管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			id		path		string								true	"Git 身份认证ID"
//	@Param			flush	query		bool								false	"是否刷新缓存"
//	@Success		200		{object}	web.Resp{data=domain.GitIdentity}	"成功"
//	@Failure		400		{object}	web.Resp							"请求参数错误"
//	@Failure		404		{object}	web.Resp							"资源不存在"
//	@Failure		500		{object}	web.Resp							"服务器内部错误"
//	@Router			/api/v1/users/git-identities/{id} [get]
func (h *GitIdentityHandler) Get(c *web.Context, req domain.GetGitIdentityReq) error {
	user := middleware.GetUser(c)
	identity, err := h.usecase.Get(c.Request().Context(), user.ID, req.ID, req.Flush)
	if err != nil {
		return err
	}
	return c.Success(identity)
}

// Add 添加 Git 身份认证
//
//	@Summary		添加
//	@Description	添加 Git 身份认证
//	@Tags			【用户】git 身份管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			req	body		domain.AddGitIdentityReq			true	"添加 Git 身份认证请求"
//	@Success		200	{object}	web.Resp{data=domain.GitIdentity}	"成功"
//	@Failure		400	{object}	web.Resp							"请求参数错误"
//	@Failure		500	{object}	web.Resp							"服务器内部错误"
//	@Router			/api/v1/users/git-identities [post]
func (h *GitIdentityHandler) Add(c *web.Context, req domain.AddGitIdentityReq) error {
	user := middleware.GetUser(c)
	identity, err := h.usecase.Add(c.Request().Context(), user.ID, &req)
	if err != nil {
		return errcode.ErrDatabaseQuery.Wrap(err)
	}
	return c.Success(identity)
}

// Update 更新 Git 身份认证
//
//	@Summary		更新
//	@Description	更新 Git 身份认证
//	@Tags			【用户】git 身份管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			id	path		string						true	"Git 身份认证ID"
//	@Param			req	body		domain.UpdateGitIdentityReq	true	"更新 Git 身份认证请求"
//	@Success		200	{object}	web.Resp{}					"成功"
//	@Failure		400	{object}	web.Resp					"请求参数错误"
//	@Failure		404	{object}	web.Resp					"资源不存在"
//	@Failure		500	{object}	web.Resp					"服务器内部错误"
//	@Router			/api/v1/users/git-identities/{id} [put]
func (h *GitIdentityHandler) Update(c *web.Context, req domain.UpdateGitIdentityReq) error {
	user := middleware.GetUser(c)
	if err := h.usecase.Update(c.Request().Context(), user.ID, &req); err != nil {
		return errcode.ErrDatabaseQuery.Wrap(err)
	}
	return c.Success(nil)
}

// Delete 删除 Git 身份认证
//
//	@Summary		删除
//	@Description	删除 Git 身份认证
//	@Tags			【用户】git 身份管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			id	path		string		true	"Git 身份认证ID"
//	@Success		200	{object}	web.Resp{}	"成功"
//	@Failure		400	{object}	web.Resp	"请求参数错误"
//	@Failure		404	{object}	web.Resp	"资源不存在"
//	@Failure		409	{object}	web.Resp	"该 Git 身份已被项目使用，无法删除"
//	@Failure		500	{object}	web.Resp	"服务器内部错误"
//	@Router			/api/v1/users/git-identities/{id} [delete]
func (h *GitIdentityHandler) Delete(c *web.Context, req domain.DeleteGitIdentityReq) error {
	user := middleware.GetUser(c)
	if err := h.usecase.Delete(c.Request().Context(), user.ID, req.ID); err != nil {
		return err
	}
	return c.Success(nil)
}

// ListBranches 获取仓库分支列表
//
//	@Summary		获取仓库分支列表
//	@Description	根据 Git 身份获取指定仓库的分支列表
//	@Tags			【用户】git 身份管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			identity_id				path		string							true	"Git 身份认证ID"
//	@Param			escaped_repo_full_name	path		string							true	"URL 编码的仓库全名 (owner%2Frepo)"
//	@Param			page					query		int								false	"页码（默认1）"
//	@Param			per_page				query		int								false	"每页数量（默认50，最大100）"
//	@Success		200						{object}	web.Resp{data=[]domain.Branch}	"成功"
//	@Failure		400						{object}	web.Resp						"请求参数错误"
//	@Failure		404						{object}	web.Resp						"资源不存在"
//	@Failure		500						{object}	web.Resp						"服务器内部错误"
//	@Router			/api/v1/users/git-identities/{identity_id}/{escaped_repo_full_name}/branches [get]
func (h *GitIdentityHandler) ListBranches(c *web.Context, req domain.ListBranchesReq) error {
	user := middleware.GetUser(c)

	repoFullName, err := url.PathUnescape(req.EscapedRepoFullName)
	if err != nil {
		return errcode.ErrInvalidParameter.Wrap(err)
	}

	branches, err := h.usecase.ListBranches(c.Request().Context(), user.ID, req.IdentityID, repoFullName, req.Page, req.PerPage)
	if err != nil {
		return err
	}
	return c.Success(branches)
}
