package domain

import (
	"context"
	"io"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
)

// ProjectUsecase 项目业务逻辑接口
type ProjectUsecase interface {
	Get(ctx context.Context, uid, id uuid.UUID) (*Project, error)
	List(ctx context.Context, uid uuid.UUID, cursor CursorReq) (*ListProjectResp, error)
	Create(ctx context.Context, uid uuid.UUID, req *CreateProjectReq) (*Project, error)
	Update(ctx context.Context, user *User, req *UpdateProjectReq) (*Project, error)
	Delete(ctx context.Context, uid, id uuid.UUID) error
	ListIssues(ctx context.Context, uid uuid.UUID, req *ListIssuesReq) (*ListIssuesResp, error)
	CreateIssue(ctx context.Context, uid uuid.UUID, req *CreateIssueReq) (*ProjectIssue, error)
	UpdateIssue(ctx context.Context, uid uuid.UUID, req *UpdateIssueReq) (*ProjectIssue, error)
	UpdateIssueDoc(ctx context.Context, req *UpdateIssueDocReq) (*ProjectIssue, error)
	ListCollaborators(ctx context.Context, uid uuid.UUID, req *ListCollaboratorsReq) (*ListCollaboratorsResp, error)
	ListIssueComments(ctx context.Context, uid uuid.UUID, req *ListIssueCommentsReq) (*ListIssueCommentsResp, error)
	CreateIssueComment(ctx context.Context, uid uuid.UUID, req *CreateIssueCommentReq) (*ProjectIssueComment, error)
	GetProjectIDByTask(ctx context.Context, taskID string) (*Project, error)
	GetIssueByTaskID(ctx context.Context, taskID string) (*ProjectIssue, error)
	GetProjectTree(ctx context.Context, uid uuid.UUID, req *GetProjectTreeReq) (ProjectTree, error)
	GetProjectBlob(ctx context.Context, uid uuid.UUID, req *GetProjectBlobReq) (*ProjectBlob, error)
	GetProjectLogs(ctx context.Context, uid uuid.UUID, req *GetProjectLogsReq) (*ProjectLogs, error)
	GetProjectArchive(ctx context.Context, uid uuid.UUID, req *GetProjectArchiveReq) (*GetProjectArchiveResp, error)
	GetRepoToken(ctx context.Context, userID, projectID, gitIdentityID uuid.UUID, platform consts.GitPlatform) (string, error)
}

// ProjectRepo 项目数据仓库接口
type ProjectRepo interface {
	Get(ctx context.Context, uid, id uuid.UUID) (*db.Project, error)
	GetByID(ctx context.Context, id uuid.UUID) (*db.Project, error)
	List(ctx context.Context, uid uuid.UUID, cursor CursorReq) ([]*db.Project, *db.Cursor, error)
	Create(ctx context.Context, uid uuid.UUID, req *CreateProjectReq) (*db.Project, error)
	Update(ctx context.Context, user *User, req *UpdateProjectReq) (*db.Project, error)
	Delete(ctx context.Context, uid, id uuid.UUID) error
	ListIssues(ctx context.Context, uid uuid.UUID, req *ListIssuesReq) ([]*db.ProjectIssue, *db.Cursor, error)
	CreateIssue(ctx context.Context, uid uuid.UUID, req *CreateIssueReq) (*db.ProjectIssue, error)
	UpdateIssue(ctx context.Context, uid uuid.UUID, req *UpdateIssueReq) (*db.ProjectIssue, error)
	UpdateIssueDoc(ctx context.Context, req *UpdateIssueDocReq) (*db.ProjectIssue, error)
	GetIssue(ctx context.Context, uid uuid.UUID, projectID, issueID uuid.UUID) (*db.ProjectIssue, error)
	UpdateIssueSummary(ctx context.Context, issueID uuid.UUID, summary string) error
	ListCollaborators(ctx context.Context, uid uuid.UUID, req *ListCollaboratorsReq) ([]*db.ProjectCollaborator, error)
	ListIssueComments(ctx context.Context, uid uuid.UUID, req *ListIssueCommentsReq) ([]*db.ProjectIssueComment, *db.Cursor, error)
	CreateIssueComment(ctx context.Context, uid uuid.UUID, req *CreateIssueCommentReq) (*db.ProjectIssueComment, error)
	HasReadWritePerm(ctx context.Context, uid uuid.UUID, projectID uuid.UUID) bool
	GetProjectIDByTask(ctx context.Context, taskID string) (*db.Project, error)
	GetIssueByTaskID(ctx context.Context, taskID string) (*db.ProjectIssue, error)
	GetUserProjectPerm(ctx context.Context, uid uuid.UUID, projectID uuid.UUID) (consts.ProjectCollaboratorRole, error)
}

// ListProjectResp 项目列表响应
type ListProjectResp struct {
	Projects []*Project `json:"projects"`
	Page     *db.Cursor `json:"page"`
}

// ListIssuesResp 问题列表响应
type ListIssuesResp struct {
	Issues []*ProjectIssue `json:"issues"`
	Page   *db.Cursor      `json:"page"`
}

// ListCollaboratorsResp 协作者列表响应
type ListCollaboratorsResp struct {
	Collaborators []*Collaborator `json:"collaborators"`
}

// ListIssueCommentsResp 问题评论列表响应
type ListIssueCommentsResp struct {
	Comments []*ProjectIssueComment `json:"comments"`
	Page     *db.Cursor             `json:"page"`
}

// ProjectIssueComment 问题评论
type ProjectIssueComment struct {
	ID        uuid.UUID              `json:"id"`
	Comment   string                 `json:"comment"`
	Parent    *ProjectIssueComment   `json:"parent"`
	Replies   []*ProjectIssueComment `json:"replies"`
	Creator   *User                  `json:"creator"`
	CreatedAt int64                  `json:"created_at"`
}

func (p *ProjectIssueComment) From(src *db.ProjectIssueComment) *ProjectIssueComment {
	if src == nil {
		return p
	}
	p.ID = src.ID
	p.Comment = src.Comment
	if src.Edges.User != nil {
		p.Creator = cvt.From(src.Edges.User, &User{})
	}
	if src.Edges.Parent != nil {
		p.Parent = cvt.From(src.Edges.Parent, &ProjectIssueComment{})
	}
	p.Replies = cvt.Iter(src.Edges.Replies, func(_ int, r *db.ProjectIssueComment) *ProjectIssueComment {
		return cvt.From(r, &ProjectIssueComment{})
	})
	p.CreatedAt = src.CreatedAt.Unix()
	return p
}

// ProjectIssue 项目问题
type ProjectIssue struct {
	ID                  uuid.UUID                   `json:"id"`
	Title               string                      `json:"title"`
	RequirementDocument string                      `json:"requirement_document"`
	DesignDocument      string                      `json:"design_document"`
	Summary             string                      `json:"summary"`
	Status              consts.ProjectIssueStatus   `json:"status"`
	Priority            consts.ProjectIssuePriority `json:"priority"`
	CreatedAt           int64                       `json:"created_at"`
	User                *User                       `json:"user"`
	Assignee            *User                       `json:"assignee"`
}

func (p *ProjectIssue) From(src *db.ProjectIssue) *ProjectIssue {
	if src == nil {
		return p
	}
	p.ID = src.ID
	p.Title = src.Title
	p.RequirementDocument = src.RequirementDocument
	p.DesignDocument = src.DesignDocument
	p.Summary = src.Summary
	p.Status = src.Status
	p.Priority = src.Priority
	p.CreatedAt = src.CreatedAt.Unix()
	if src.Edges.User != nil {
		p.User = cvt.From(src.Edges.User, &User{})
	}
	if src.Edges.Assignee != nil {
		p.Assignee = cvt.From(src.Edges.Assignee, &User{})
	}
	return p
}

// Collaborator 协作者
type Collaborator struct {
	User
	Permission consts.ProjectCollaboratorRole `json:"permission"`
}

func (c *Collaborator) From(src *db.ProjectCollaborator) *Collaborator {
	if src == nil {
		return c
	}
	c.Permission = src.Role
	if src.Edges.User != nil {
		user := cvt.From(src.Edges.User, &User{})
		if user != nil {
			c.User = *user
		}
	}
	return c
}

// Project 项目
type Project struct {
	ID            uuid.UUID          `json:"id"`
	Name          string             `json:"name"`
	RepoURL       string             `json:"repo_url"`
	FullName      string             `json:"full_name"`
	Description   string             `json:"description"`
	Platform      consts.GitPlatform `json:"platform"`
	CreatedAt     int64              `json:"created_at"`
	UpdatedAt     int64              `json:"updated_at"`
	User          *User              `json:"user"`
	Issues        []*ProjectIssue    `json:"issues"`
	Collaborators []*Collaborator    `json:"collaborators"`
	ImageID       uuid.UUID          `json:"image_id"`
	GitIdentityID uuid.UUID          `json:"git_identity_id"`
	EnvVariables  map[string]any     `json:"env_variables"`
	Tasks         []*ProjectTask     `json:"tasks"`
}

func (p *Project) From(src *db.Project) *Project {
	if src == nil {
		return p
	}
	p.ID = src.ID
	p.Name = src.Name
	p.RepoURL = src.RepoURL
	p.FullName = repoFullName(src.RepoURL)
	p.Description = src.Description
	p.Platform = src.Platform
	p.CreatedAt = src.CreatedAt.Unix()
	p.UpdatedAt = src.UpdatedAt.Unix()
	p.GitIdentityID = src.GitIdentityID
	p.ImageID = src.ImageID
	p.EnvVariables = src.EnvVariables
	p.User = cvt.From(src.Edges.User, &User{})
	p.Issues = cvt.Iter(src.Edges.Issues, func(_ int, i *db.ProjectIssue) *ProjectIssue {
		return cvt.From(i, &ProjectIssue{})
	})
	p.Collaborators = cvt.Iter(src.Edges.Collaborators, func(_ int, c *db.ProjectCollaborator) *Collaborator {
		return cvt.From(c, &Collaborator{})
	})
	p.Tasks = cvt.Iter(src.Edges.ProjectTasks, func(_ int, pt *db.ProjectTask) *ProjectTask {
		return cvt.From(pt, &ProjectTask{})
	})
	return p
}

// GetProjectTreeReq 获取项目文件树请求
type GetProjectTreeReq struct {
	ID        uuid.UUID `param:"id" validate:"required" json:"-" swaggerignore:"true"`
	Recursive bool      `query:"recursive" validate:"omitempty"`
	Ref       string    `query:"ref" validate:"omitempty"`
	Path      string    `query:"path" validate:"omitempty"`
}

// GetProjectBlobReq 获取项目文件内容请求
type GetProjectBlobReq struct {
	ID   uuid.UUID `param:"id" validate:"required" json:"-" swaggerignore:"true"`
	Path string    `query:"path" validate:"required"`
	Ref  string    `query:"ref" validate:"omitempty"`
}

// GetProjectLogsReq 获取项目提交历史请求
type GetProjectLogsReq struct {
	ID     uuid.UUID `param:"id" validate:"required" json:"-" swaggerignore:"true"`
	Ref    string    `query:"ref" validate:"omitempty"`
	Path   string    `query:"path" validate:"omitempty"`
	Limit  int       `query:"limit" validate:"omitempty"`
	Offset int       `query:"offset" validate:"omitempty"`
}

// GetProjectArchiveReq 获取项目压缩包请求
type GetProjectArchiveReq struct {
	ID  uuid.UUID `param:"id" validate:"required" json:"-" swaggerignore:"true"`
	Ref string    `query:"ref" validate:"omitempty"`
}

// GetProjectArchiveResp 获取项目压缩包响应
type GetProjectArchiveResp struct {
	ContentLength int64
	ContentType   string
	Reader        io.ReadCloser
}

// TreeEntryAdapter 文件树节点适配结构体
type TreeEntryAdapter struct {
	Mode           int
	Name           string
	Path           string
	Sha            string
	Size           int
	LastModifiedAt int64
}

// ProjectTreeEntry 项目文件树节点
type ProjectTreeEntry struct {
	Mode           int    `json:"mode"`
	Name           string `json:"name"`
	Path           string `json:"path"`
	Sha            string `json:"sha"`
	Size           int    `json:"size"`
	LastModifiedAt int64  `json:"last_modified_at"`
}

func (p *ProjectTreeEntry) From(src *TreeEntryAdapter) *ProjectTreeEntry {
	if src == nil {
		return p
	}
	p.Mode = src.Mode
	p.Name = src.Name
	p.Path = src.Path
	p.Sha = src.Sha
	p.Size = src.Size
	p.LastModifiedAt = src.LastModifiedAt
	return p
}

// ProjectTree 项目文件树
type ProjectTree []*ProjectTreeEntry

// ProjectBlob 项目文件内容
type ProjectBlob struct {
	Content  []byte `json:"content"`
	IsBinary bool   `json:"is_binary"`
	Sha      string `json:"sha"`
	Size     int    `json:"size"`
}

// CommitUserAdapter 提交用户适配结构体
type CommitUserAdapter struct {
	Email string
	Name  string
	When  int64
}

// ProjectCommitUser 提交用户信息
type ProjectCommitUser struct {
	Email string `json:"email"`
	Name  string `json:"name"`
	When  int64  `json:"when"`
}

func (p *ProjectCommitUser) From(src *CommitUserAdapter) *ProjectCommitUser {
	if src == nil {
		return p
	}
	p.Email = src.Email
	p.Name = src.Name
	p.When = src.When
	return p
}

// CommitAdapter 提交信息适配结构体
type CommitAdapter struct {
	Author     *CommitUserAdapter
	Committer  *CommitUserAdapter
	Message    string
	ParentShas []string
	Sha        string
	TreeSha    string
}

// ProjectCommit 提交信息
type ProjectCommit struct {
	Author     *ProjectCommitUser `json:"author"`
	Committer  *ProjectCommitUser `json:"committer"`
	Message    string             `json:"message"`
	ParentShas []string           `json:"parent_shas"`
	Sha        string             `json:"sha"`
	TreeSha    string             `json:"tree_sha"`
}

func (p *ProjectCommit) From(src *CommitAdapter) *ProjectCommit {
	if src == nil {
		return p
	}
	p.Message = src.Message
	p.ParentShas = src.ParentShas
	p.Sha = src.Sha
	p.TreeSha = src.TreeSha
	if src.Author != nil {
		p.Author = cvt.From(src.Author, &ProjectCommitUser{})
	}
	if src.Committer != nil {
		p.Committer = cvt.From(src.Committer, &ProjectCommitUser{})
	}
	return p
}

// CommitEntryAdapter 单条提交记录适配结构体
type CommitEntryAdapter struct {
	Commit *CommitAdapter
}

// ProjectCommitEntry 单条提交记录
type ProjectCommitEntry struct {
	Commit *ProjectCommit `json:"commit"`
}

func (p *ProjectCommitEntry) From(src *CommitEntryAdapter) *ProjectCommitEntry {
	if src == nil {
		return p
	}
	if src.Commit != nil {
		p.Commit = cvt.From(src.Commit, &ProjectCommit{})
	}
	return p
}

// ProjectLogs 项目提交日志
type ProjectLogs struct {
	Count   int                   `json:"count"`
	Entries []*ProjectCommitEntry `json:"entries"`
}

// CreateProjectReq 创建项目请求
type CreateProjectReq struct {
	Name          string             `json:"name"`
	Description   string             `json:"description"`
	Platform      consts.GitPlatform `json:"platform"`
	RepoURL       string             `json:"repo_url"`
	GitIdentityID uuid.UUID          `json:"git_identity_id"`
	ImageID       uuid.UUID          `json:"image_id,omitempty"`
	EnvVariables  map[string]any     `json:"env_variables,omitempty"`
}

// CreateCollaboratorItem 创建协作者项
type CreateCollaboratorItem struct {
	UserID     uuid.UUID                      `json:"user_id"`
	Permission consts.ProjectCollaboratorRole `json:"permission"`
}

// UpdateProjectReq 更新项目请求
type UpdateProjectReq struct {
	ID           uuid.UUID                 `param:"id" validate:"required" json:"-" swaggerignore:"true"`
	Name         string                    `json:"name,omitempty"`
	Description  string                    `json:"description,omitempty"`
	Collaborator []*CreateCollaboratorItem `json:"collaborators,omitempty"`
	ImageID      uuid.UUID                 `json:"image_id,omitempty"`
	EnvVariables map[string]any            `json:"env_variables,omitempty"`
}

// ListIssuesReq 问题列表请求
type ListIssuesReq struct {
	ID uuid.UUID `param:"id" validate:"required" json:"-" swaggerignore:"true"`
	CursorReq
}

// CreateIssueReq 创建问题请求
type CreateIssueReq struct {
	ID                  uuid.UUID                   `param:"id" validate:"required" json:"-" swaggerignore:"true"`
	Title               string                      `json:"title"`
	RequirementDocument string                      `json:"requirement_document"`
	AssigneeID          *uuid.UUID                  `json:"assignee_id,omitempty"`
	Priority            consts.ProjectIssuePriority `json:"priority,omitempty"`
}

// UpdateIssueDocReq 更新问题文档请求
type UpdateIssueDocReq struct {
	IssueID             uuid.UUID `json:"issue_id" validate:"required"`
	RequirementDocument string    `json:"requirement_document,omitempty"`
	DesignDocument      string    `json:"design_document,omitempty"`
}

// UpdateIssueReq 更新问题请求
type UpdateIssueReq struct {
	ID                  uuid.UUID                   `param:"id" validate:"required" json:"-" swaggerignore:"true"`
	IssueID             uuid.UUID                   `param:"issue_id" validate:"required" json:"-" swaggerignore:"true"`
	Title               string                      `json:"title,omitempty"`
	RequirementDocument string                      `json:"requirement_document,omitempty"`
	DesignDocument      string                      `json:"design_document,omitempty"`
	Status              consts.ProjectIssueStatus   `json:"status,omitempty"`
	AssigneeID          *uuid.UUID                  `json:"assignee_id,omitempty"`
	Priority            consts.ProjectIssuePriority `json:"priority,omitempty"`
}

// ListCollaboratorsReq 协作者列表请求
type ListCollaboratorsReq struct {
	ID uuid.UUID `param:"id" validate:"required" json:"-" swaggerignore:"true"`
}

// ListIssueCommentsReq 问题评论列表请求
type ListIssueCommentsReq struct {
	ID      uuid.UUID `param:"id" validate:"required" json:"-" swaggerignore:"true"`
	IssueID uuid.UUID `param:"issue_id" validate:"required" json:"-" swaggerignore:"true"`
	CursorReq
}

// CreateIssueCommentReq 创建问题评论请求
type CreateIssueCommentReq struct {
	ID       uuid.UUID  `param:"id" validate:"required" json:"-" swaggerignore:"true"`
	IssueID  uuid.UUID  `param:"issue_id" validate:"required" json:"-" swaggerignore:"true"`
	Comment  string     `json:"comment" validate:"required"`
	ParentID *uuid.UUID `json:"parent_id,omitempty"`
}
