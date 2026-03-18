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
func (h *ProjectHandler) Get(c *web.Context, req domain.IDReq[uuid.UUID]) error {
	user := middleware.GetUser(c)
	resp, err := h.usecase.Get(c.Request().Context(), user.ID, req.ID)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// Create 创建项目
func (h *ProjectHandler) Create(c *web.Context, req domain.CreateProjectReq) error {
	user := middleware.GetUser(c)
	resp, err := h.usecase.Create(c.Request().Context(), user.ID, &req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// Update 更新项目
func (h *ProjectHandler) Update(c *web.Context, req domain.UpdateProjectReq) error {
	user := middleware.GetUser(c)
	resp, err := h.usecase.Update(c.Request().Context(), user, &req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// Delete 删除项目
func (h *ProjectHandler) Delete(c *web.Context, req domain.IDReq[uuid.UUID]) error {
	user := middleware.GetUser(c)
	if err := h.usecase.Delete(c.Request().Context(), user.ID, req.ID); err != nil {
		return err
	}
	return c.Success(nil)
}

// ListIssues 问题列表
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
func (h *ProjectHandler) CreateIssue(c *web.Context, req domain.CreateIssueReq) error {
	user := middleware.GetUser(c)
	resp, err := h.usecase.CreateIssue(c.Request().Context(), user.ID, &req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// UpdateIssue 更新问题
func (h *ProjectHandler) UpdateIssue(c *web.Context, req domain.UpdateIssueReq) error {
	user := middleware.GetUser(c)
	resp, err := h.usecase.UpdateIssue(c.Request().Context(), user.ID, &req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// ListIssueComments 问题评论列表
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
func (h *ProjectHandler) CreateIssueComment(c *web.Context, req domain.CreateIssueCommentReq) error {
	user := middleware.GetUser(c)
	resp, err := h.usecase.CreateIssueComment(c.Request().Context(), user.ID, &req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// ListCollaborators 协作者列表
func (h *ProjectHandler) ListCollaborators(c *web.Context, req domain.ListCollaboratorsReq) error {
	user := middleware.GetUser(c)
	resp, err := h.usecase.ListCollaborators(c.Request().Context(), user.ID, &req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// GetProjectTree 获取项目文件树
func (h *ProjectHandler) GetProjectTree(c *web.Context, req domain.GetProjectTreeReq) error {
	user := middleware.GetUser(c)
	resp, err := h.usecase.GetProjectTree(c.Request().Context(), user.ID, &req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// GetProjectBlob 获取项目文件内容
func (h *ProjectHandler) GetProjectBlob(c *web.Context, req domain.GetProjectBlobReq) error {
	user := middleware.GetUser(c)
	resp, err := h.usecase.GetProjectBlob(c.Request().Context(), user.ID, &req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// GetProjectLogs 获取项目提交日志
func (h *ProjectHandler) GetProjectLogs(c *web.Context, req domain.GetProjectLogsReq) error {
	user := middleware.GetUser(c)
	resp, err := h.usecase.GetProjectLogs(c.Request().Context(), user.ID, &req)
	if err != nil {
		return err
	}
	return c.Success(resp)
}

// GetProjectArchive 获取项目仓库压缩包
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
