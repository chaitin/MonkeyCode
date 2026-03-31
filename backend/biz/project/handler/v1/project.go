package v1

import (
	"fmt"
	"io"
	"log/slog"

	"github.com/GoYoko/web"
	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/middleware"
)

// ProjectHandler 项目管理处理器
type ProjectHandler struct {
	usecase domain.ProjectUsecase
	logger  *slog.Logger
}

// NewProjectHandler 创建项目管理处理器
func NewProjectHandler(i *do.Injector) (*ProjectHandler, error) {
	w := do.MustInvoke[*web.Web](i)
	auth := do.MustInvoke[*middleware.AuthMiddleware](i)

	h := &ProjectHandler{
		usecase: do.MustInvoke[domain.ProjectUsecase](i),
		logger:  do.MustInvoke[*slog.Logger](i).With("module", "handler.project"),
	}

	g := w.Group("/api/v1/users/projects")
	g.Use(auth.Auth())
	g.GET("", web.BindHandler(h.List))
	g.GET("/:id", web.BindHandler(h.Get))
	g.POST("", web.BindHandler(h.Create))
	g.PUT("/:id", web.BindHandler(h.Update))
	g.DELETE("/:id", web.BindHandler(h.Delete))

	gi := w.Group("/api/v1/users/projects/:id/issues")
	gi.Use(auth.Auth())
	gi.GET("", web.BindHandler(h.ListIssues))
	gi.POST("", web.BindHandler(h.CreateIssue))
	gi.PUT("/:issue_id", web.BindHandler(h.UpdateIssue))

	gic := w.Group("/api/v1/users/projects/:id/issues/:issue_id/comments")
	gic.Use(auth.Auth())
	gic.GET("", web.BindHandler(h.ListIssueComments))
	gic.POST("", web.BindHandler(h.CreateIssueComment))

	gc := w.Group("/api/v1/users/projects/:id/collaborators")
	gc.Use(auth.Auth())
	gc.GET("", web.BindHandler(h.ListCollaborators))

	gt := w.Group("/api/v1/users/projects/:id/tree")
	gt.Use(auth.Auth())
	gt.GET("", web.BindHandler(h.GetProjectTree))
	gt.GET("/blob", web.BindHandler(h.GetProjectBlob))
	gt.GET("/logs", web.BindHandler(h.GetProjectLogs))
	gt.GET("/archive", web.BindHandler(h.GetProjectArchive))

	return h, nil
}

// List 项目列表
//
//	@Summary		项目列表
//	@Description	项目列表
//	@Tags			【用户】项目管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			req	query		domain.CursorReq						true	"游标分页参数"
//	@Success		200	{object}	web.Resp{data=domain.ListProjectResp}	"成功"
//	@Failure		401	{object}	web.Resp								"未授权"
//	@Failure		500	{object}	web.Resp								"服务器内部错误"
//	@Router			/api/v1/users/projects [get]
func (h *ProjectHandler) List(c *web.Context, req domain.CursorReq) error {
	if req.Limit <= 0 {
		req.Limit = 100
	}
	user := middleware.GetUser(c)
	resp, err := h.usecase.List(c.Request().Context(), user.ID, req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// Get 项目详情
//
//	@Summary		项目详情
//	@Description	项目详情
//	@Tags			【用户】项目管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			id	path		string							true	"项目ID"
//	@Success		200	{object}	web.Resp{data=domain.Project}	"成功"
//	@Failure		401	{object}	web.Resp						"未授权"
//	@Failure		500	{object}	web.Resp						"服务器内部错误"
//	@Router			/api/v1/users/projects/{id} [get]
func (h *ProjectHandler) Get(c *web.Context, req domain.IDReq[uuid.UUID]) error {
	user := middleware.GetUser(c)
	resp, err := h.usecase.Get(c.Request().Context(), user.ID, req.ID)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// Create 创建项目
//
//	@Summary		创建项目
//	@Description	创建项目
//	@Tags			【用户】项目管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			req	body		domain.CreateProjectReq			true	"请求参数"
//	@Success		200	{object}	web.Resp{data=domain.Project}	"成功"
//	@Failure		401	{object}	web.Resp						"未授权"
//	@Failure		500	{object}	web.Resp						"服务器内部错误"
//	@Router			/api/v1/users/projects [post]
func (h *ProjectHandler) Create(c *web.Context, req domain.CreateProjectReq) error {
	user := middleware.GetUser(c)
	resp, err := h.usecase.Create(c.Request().Context(), user.ID, &req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// Update 更新项目
//
//	@Summary		更新项目
//	@Description	更新项目
//	@Tags			【用户】项目管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			id	path		string							true	"项目ID"
//	@Param			req	body		domain.UpdateProjectReq			true	"请求参数"
//	@Success		200	{object}	web.Resp{data=domain.Project}	"成功"
//	@Failure		401	{object}	web.Resp						"未授权"
//	@Failure		500	{object}	web.Resp						"服务器内部错误"
//	@Router			/api/v1/users/projects/{id} [put]
func (h *ProjectHandler) Update(c *web.Context, req domain.UpdateProjectReq) error {
	user := middleware.GetUser(c)
	resp, err := h.usecase.Update(c.Request().Context(), user, &req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// Delete 删除项目
//
//	@Summary		删除项目
//	@Description	删除项目
//	@Tags			【用户】项目管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			id	path		string		true	"项目ID"
//	@Success		200	{object}	web.Resp{}	"成功"
//	@Failure		401	{object}	web.Resp	"未授权"
//	@Failure		500	{object}	web.Resp	"服务器内部错误"
//	@Router			/api/v1/users/projects/{id} [delete]
func (h *ProjectHandler) Delete(c *web.Context, req domain.IDReq[uuid.UUID]) error {
	user := middleware.GetUser(c)
	if err := h.usecase.Delete(c.Request().Context(), user.ID, req.ID); err != nil {
		return err
	}
	return c.Success(nil)
}

// ListIssues 问题列表
//
//	@Summary		问题列表
//	@Description	问题列表
//	@Tags			【用户】项目管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			id	path		string									true	"项目ID"
//	@Param			req	query		domain.CursorReq						true	"游标分页参数"
//	@Success		200	{object}	web.Resp{data=domain.ListIssuesResp}	"成功"
//	@Failure		401	{object}	web.Resp								"未授权"
//	@Failure		500	{object}	web.Resp								"服务器内部错误"
//	@Router			/api/v1/users/projects/{id}/issues [get]
func (h *ProjectHandler) ListIssues(c *web.Context, req domain.ListIssuesReq) error {
	if req.Limit <= 0 {
		req.Limit = 100
	}
	user := middleware.GetUser(c)
	resp, err := h.usecase.ListIssues(c.Request().Context(), user.ID, &req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// CreateIssue 创建问题
//
//	@Summary		创建问题
//	@Description	创建问题
//	@Tags			【用户】项目管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			id	path		string								true	"项目ID"
//	@Param			req	body		domain.CreateIssueReq				true	"请求参数"
//	@Success		200	{object}	web.Resp{data=domain.ProjectIssue}	"成功"
//	@Failure		401	{object}	web.Resp							"未授权"
//	@Failure		500	{object}	web.Resp							"服务器内部错误"
//	@Router			/api/v1/users/projects/{id}/issues [post]
func (h *ProjectHandler) CreateIssue(c *web.Context, req domain.CreateIssueReq) error {
	user := middleware.GetUser(c)
	resp, err := h.usecase.CreateIssue(c.Request().Context(), user.ID, &req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// UpdateIssue 更新问题
//
//	@Summary		更新问题
//	@Description	更新问题
//	@Tags			【用户】项目管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			id			path		string								true	"项目ID"
//	@Param			issue_id	path		string								true	"问题ID"
//	@Param			req			body		domain.UpdateIssueReq				true	"请求参数"
//	@Success		200			{object}	web.Resp{data=domain.ProjectIssue}	"成功"
//	@Failure		401			{object}	web.Resp							"未授权"
//	@Failure		500			{object}	web.Resp							"服务器内部错误"
//	@Router			/api/v1/users/projects/{id}/issues/{issue_id} [put]
func (h *ProjectHandler) UpdateIssue(c *web.Context, req domain.UpdateIssueReq) error {
	user := middleware.GetUser(c)
	resp, err := h.usecase.UpdateIssue(c.Request().Context(), user.ID, &req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// ListIssueComments 问题评论列表
//
//	@Summary		问题评论列表
//	@Description	问题评论列表
//	@Tags			【用户】项目管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			id			path		string										true	"项目ID"
//	@Param			issue_id	path		string										true	"问题ID"
//	@Param			req			query		domain.CursorReq							true	"游标分页参数"
//	@Success		200			{object}	web.Resp{data=domain.ListIssueCommentsResp}	"成功"
//	@Failure		401			{object}	web.Resp									"未授权"
//	@Failure		500			{object}	web.Resp									"服务器内部错误"
//	@Router			/api/v1/users/projects/{id}/issues/{issue_id}/comments [get]
func (h *ProjectHandler) ListIssueComments(c *web.Context, req domain.ListIssueCommentsReq) error {
	if req.Limit <= 0 {
		req.Limit = 100
	}
	user := middleware.GetUser(c)
	resp, err := h.usecase.ListIssueComments(c.Request().Context(), user.ID, &req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// CreateIssueComment 创建问题评论
//
//	@Summary		创建问题评论
//	@Description	创建问题评论
//	@Tags			【用户】项目管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			id			path		string										true	"项目ID"
//	@Param			issue_id	path		string										true	"问题ID"
//	@Param			req			body		domain.CreateIssueCommentReq				true	"请求参数"
//	@Success		200			{object}	web.Resp{data=domain.ProjectIssueComment}	"成功"
//	@Failure		401			{object}	web.Resp									"未授权"
//	@Failure		500			{object}	web.Resp									"服务器内部错误"
//	@Router			/api/v1/users/projects/{id}/issues/{issue_id}/comments [post]
func (h *ProjectHandler) CreateIssueComment(c *web.Context, req domain.CreateIssueCommentReq) error {
	user := middleware.GetUser(c)
	resp, err := h.usecase.CreateIssueComment(c.Request().Context(), user.ID, &req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// ListCollaborators 协作者列表
//
//	@Summary		协作者列表
//	@Description	协作者列表
//	@Tags			【用户】项目管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			id	path		string										true	"项目ID"
//	@Success		200	{object}	web.Resp{data=domain.ListCollaboratorsResp}	"成功"
//	@Failure		401	{object}	web.Resp									"未授权"
//	@Failure		500	{object}	web.Resp									"服务器内部错误"
//	@Router			/api/v1/users/projects/{id}/collaborators [get]
func (h *ProjectHandler) ListCollaborators(c *web.Context, req domain.ListCollaboratorsReq) error {
	user := middleware.GetUser(c)
	resp, err := h.usecase.ListCollaborators(c.Request().Context(), user.ID, &req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// GetProjectTree 获取项目文件树
//
//	@Summary		获取项目仓库树
//	@Description	获取项目仓库树
//	@Tags			【用户】项目管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			id			path		string								true	"项目ID"
//	@Param			recursive	query		bool								false	"是否递归"
//	@Param			ref			query		string								false	"分支"
//	@Param			path		query		string								false	"路径"
//	@Success		200			{object}	web.Resp{data=domain.ProjectTree}	"成功"
//	@Failure		401			{object}	web.Resp							"未授权"
//	@Failure		500			{object}	web.Resp							"服务器内部错误"
//	@Router			/api/v1/users/projects/{id}/tree [get]
func (h *ProjectHandler) GetProjectTree(c *web.Context, req domain.GetProjectTreeReq) error {
	user := middleware.GetUser(c)
	resp, err := h.usecase.GetProjectTree(c.Request().Context(), user.ID, &req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// GetProjectBlob 获取项目文件内容
//
//	@Summary		获取项目文件内容
//	@Description	获取项目文件内容
//	@Tags			【用户】项目管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			id		path		string								true	"项目ID"
//	@Param			path	query		string								true	"文件路径"
//	@Param			ref		query		string								false	"分支"
//	@Success		200		{object}	web.Resp{data=domain.ProjectBlob}	"成功"
//	@Failure		401		{object}	web.Resp							"未授权"
//	@Failure		500		{object}	web.Resp							"服务器内部错误"
//	@Router			/api/v1/users/projects/{id}/tree/blob [get]
func (h *ProjectHandler) GetProjectBlob(c *web.Context, req domain.GetProjectBlobReq) error {
	user := middleware.GetUser(c)
	resp, err := h.usecase.GetProjectBlob(c.Request().Context(), user.ID, &req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// GetProjectLogs 获取项目提交日志
//
//	@Summary		获取项目仓库日志
//	@Description	获取项目仓库日志
//	@Tags			【用户】项目管理
//	@Accept			json
//	@Produce		json
//	@Security		MonkeyCodeAIAuth
//	@Param			id			path		string								true	"项目ID"
//	@Param			ref			query		string								false	"分支"
//	@Param			path		query		string								false	"路径"
//	@Param			limit		query		int									false	"限制数量"
//	@Param			offset		query		int									false	"偏移量"
//	@Param			since_sha	query		string								false	"起始 SHA"
//	@Param			until_sha	query		string								false	"结束 SHA"
//	@Success		200			{object}	web.Resp{data=domain.ProjectLogs}	"成功"
//	@Failure		401			{object}	web.Resp							"未授权"
//	@Failure		500			{object}	web.Resp							"服务器内部错误"
//	@Router			/api/v1/users/projects/{id}/tree/logs [get]
func (h *ProjectHandler) GetProjectLogs(c *web.Context, req domain.GetProjectLogsReq) error {
	user := middleware.GetUser(c)
	resp, err := h.usecase.GetProjectLogs(c.Request().Context(), user.ID, &req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// GetProjectArchive 获取项目仓库压缩包
//
//	@Summary		获取项目仓库压缩包
//	@Description	获取项目仓库压缩包
//	@Tags			【用户】项目管理
//	@Accept			json
//	@Produce		application/zip
//	@Security		MonkeyCodeAIAuth
//	@Param			id	path		string	true	"项目ID"
//	@Param			ref	query		string	false	"分支"
//	@Success		200	{file}		"成功"
//	@Failure		401	{object}	web.Resp	"未授权"
//	@Failure		500	{object}	web.Resp	"服务器内部错误"
//	@Router			/api/v1/users/projects/{id}/tree/archive [get]
func (h *ProjectHandler) GetProjectArchive(c *web.Context, req domain.GetProjectArchiveReq) error {
	user := middleware.GetUser(c)

	if req.Ref == "" {
		req.Ref = "master"
	}

	resp, err := h.usecase.GetProjectArchive(c.Request().Context(), user.ID, &req)
	if err != nil {
		return err
	}
	defer resp.Reader.Close()

	c.Response().Header().Set("Content-Disposition", "attachment")
	if resp.ContentType != "" {
		c.Response().Header().Set("Content-Type", resp.ContentType)
	} else {
		c.Response().Header().Set("Content-Type", "application/zip")
	}
	if resp.ContentLength > 0 {
		c.Response().Header().Set("Content-Length", fmt.Sprintf("%d", resp.ContentLength))
	}

	_, err = io.Copy(c.Response().Writer, resp.Reader)
	return err
}
