package domain

import (
	"context"
	"net/url"
	"strings"
	"time"

	"github.com/GoYoko/web"
	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

// TaskUsecase 任务业务逻辑接口
type TaskUsecase interface {
	GetPublic(ctx context.Context, user *User, id uuid.UUID) (*Task, error)
	Info(ctx context.Context, user *User, id uuid.UUID) (*Task, bool, error)
	List(ctx context.Context, user *User, req TaskListReq) (*ListTaskResp, error)
	Continue(ctx context.Context, user *User, id uuid.UUID, content string) error
	Create(ctx context.Context, user *User, req CreateTaskReq) (*ProjectTask, error)
	Stop(ctx context.Context, user *User, id uuid.UUID) error
	Cancel(ctx context.Context, user *User, id uuid.UUID) error
	AutoApprove(ctx context.Context, user *User, id uuid.UUID, approve bool) error
	GitTask(ctx context.Context, id uuid.UUID) (*GitTask, error)
	Delete(ctx context.Context, user *User, id uuid.UUID) error
}

// TaskRepo 任务数据访问接口
type TaskRepo interface {
	GetByID(ctx context.Context, id uuid.UUID) (*db.Task, error)
	Stat(ctx context.Context, id uuid.UUID) (*TaskStats, error)
	StatByIDs(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]*TaskStats, error)
	Info(ctx context.Context, user *User, id uuid.UUID, isPrivileged bool) (*db.Task, error)
	List(ctx context.Context, user *User, req TaskListReq) ([]*db.ProjectTask, *db.PageInfo, error)
	Create(ctx context.Context, user *User, req CreateTaskReq, token string, fn func(*db.ProjectTask, *db.Model, *db.Image) (*taskflow.VirtualMachine, error)) (*db.ProjectTask, error)
	Update(ctx context.Context, user *User, id uuid.UUID, fn func(up *db.TaskUpdateOne) error) error
	Stop(ctx context.Context, user *User, id uuid.UUID, fn func(*db.Task) error) error
	Delete(ctx context.Context, user *User, id uuid.UUID) error
}

// repoFullName 从 repo_url 中提取 full_name
func repoFullName(repoURL string) string {
	if repoURL == "" {
		return ""
	}
	u, err := url.Parse(repoURL)
	if err != nil {
		return ""
	}
	path := strings.TrimPrefix(u.Path, "/")
	path = strings.TrimSuffix(path, ".git")
	return path
}

// VMResource 虚拟机资源配置
type VMResource struct {
	Core   int    `json:"core" validate:"omitempty" default:"1"`
	Memory uint64 `json:"memory" validate:"omitempty" default:"1024"`
	Life   int64  `json:"life"`
}

// TaskExtraConfig 任务额外配置
type TaskExtraConfig struct {
	ProjectID uuid.UUID `json:"project_id" validate:"omitempty"`
	IssueID   uuid.UUID `json:"issue_id" validate:"omitempty"`
	SkillIDs  []string  `json:"skill_ids" validate:"omitempty"`
}

// CreateTaskReq 创建任务请求
type CreateTaskReq struct {
	Content       string             `json:"content" validate:"required"`
	HostID        string             `json:"host_id" validate:"required"`
	ImageID       uuid.UUID          `json:"image_id" validate:"required"`
	ModelID       string             `json:"model_id" validate:"required"`
	GitIdentityID uuid.UUID          `json:"git_identity_id" validate:"omitempty"`
	RepoReq       TaskRepoReq        `json:"repo" validate:"required"`
	CliName       consts.CliName     `json:"cli_name"`
	Resource      *VMResource        `json:"resource" validate:"required"`
	Extra         TaskExtraConfig    `json:"extra" validate:"omitempty"`
	SystemPrompt  string             `json:"system_prompt"`
	Type          consts.TaskType    `json:"task_type"`
	SubType       consts.TaskSubType `json:"sub_type"`
	Now           time.Time          `json:"-"`
	UsePublicHost bool               `json:"-"`
}

// Validate 验证请求参数
func (r *CreateTaskReq) Validate() error {
	if r.Resource == nil {
		r.Resource = &VMResource{
			Core:   1,
			Memory: 1 << 30,
			Life:   60 * 60,
		}
	}
	return nil
}

// ListTaskResp 任务列表响应
type ListTaskResp struct {
	Tasks    []*ProjectTask `json:"tasks"`
	PageInfo *db.PageInfo   `json:"page_info,omitempty"`
}

// TaskListReq 任务列表请求
type TaskListReq struct {
	ProjectID  uuid.UUID          `json:"project_id" query:"project_id" validate:"omitempty"`
	QuickStart bool               `json:"quick_start" query:"quick_start" validate:"omitempty"`
	Status     *consts.TaskStatus `json:"status" query:"status"`
	*web.Pagination
}

// ProjectTask 项目任务
type ProjectTask struct {
	ID           uuid.UUID        `json:"id" validate:"required"`
	Model        *Model           `json:"model,omitempty"`
	Image        *Image           `json:"image,omitempty"`
	Branch       string           `json:"branch,omitempty"`
	CliName      consts.CliName   `json:"cli_name,omitempty"`
	RepoURL      string           `json:"repo_url,omitempty"`
	FullName     string           `json:"full_name,omitempty"`
	RepoFilename string           `json:"repo_filename,omitempty"`
	Extra        *TaskExtraConfig `json:"extra,omitempty"`
	*Task
}

// From 从数据库模型转换
func (pt *ProjectTask) From(src *db.ProjectTask) *ProjectTask {
	if src == nil {
		return pt
	}

	if src.Edges.Task != nil {
		pt.ID = src.Edges.Task.ID
	}
	pt.Model = cvt.From(src.Edges.Model, &Model{})
	pt.Task = cvt.From(src.Edges.Task, &Task{})
	pt.CliName = src.CliName
	pt.RepoURL = src.RepoURL
	pt.FullName = repoFullName(src.RepoURL)
	pt.RepoFilename = src.RepoFilename
	pt.Branch = src.Branch
	if pt.Branch == "" {
		pt.Branch = "master"
	}
	if src.Edges.Image != nil {
		pt.Image = cvt.From(src.Edges.Image, &Image{})
	}
	if src.ProjectID != nil {
		pt.Extra = &TaskExtraConfig{
			ProjectID: *src.ProjectID,
			IssueID:   src.IssueID,
		}
	}
	return pt
}

// Task 任务
type Task struct {
	ID             uuid.UUID          `json:"id"`
	UserID         uuid.UUID          `json:"user_id"`
	Type           consts.TaskType    `json:"type"`
	SubType        consts.TaskSubType `json:"sub_type"`
	Content        string             `json:"content"`
	Summary        string             `json:"summary"`
	Status         consts.TaskStatus  `json:"status"`
	VirtualMachine *VirtualMachine    `json:"virtualmachine"`
	CreatedAt      int64              `json:"created_at"`
	CompletedAt    int64              `json:"completed_at"`
	Model          *Model             `json:"model,omitempty"`
	Image          *Image             `json:"image,omitempty"`
	Branch         string             `json:"branch,omitempty"`
	CliName        consts.CliName     `json:"cli_name,omitempty"`
	RepoURL        string             `json:"repo_url,omitempty"`
	FullName       string             `json:"full_name,omitempty"`
	RepoFilename   string             `json:"repo_filename,omitempty"`
	Extra          *TaskExtraConfig   `json:"extra,omitempty"`
	Stats          *TaskStats         `json:"stats,omitempty"`
}

// TaskStats 任务 token 用量统计
type TaskStats struct {
	InputTokens  int64 `json:"input_tokens"`
	OutputTokens int64 `json:"output_tokens"`
	TotalTokens  int64 `json:"total_tokens"`
	LLMRequests  int64 `json:"llm_requests"`
}

// From 从数据库模型转换
func (t *Task) From(src *db.Task) *Task {
	if src == nil {
		return t
	}

	t.ID = src.ID
	t.UserID = src.UserID
	t.Type = src.Kind
	t.SubType = src.SubType
	t.Content = src.Content
	t.Summary = src.Summary
	t.Status = src.Status
	t.CreatedAt = src.CreatedAt.Unix()
	t.CompletedAt = src.CompletedAt.Unix()
	if vms := src.Edges.Vms; len(vms) > 0 {
		t.VirtualMachine = cvt.From(vms[0], &VirtualMachine{})
	}
	if pts := src.Edges.ProjectTasks; len(pts) > 0 {
		pt := pts[0]
		t.Model = cvt.From(pt.Edges.Model, &Model{})
		t.Image = cvt.From(pt.Edges.Image, &Image{})
		t.Branch = pt.Branch
		t.RepoURL = pt.RepoURL
		t.CliName = pt.CliName
		t.RepoFilename = pt.RepoFilename
		if pt.ProjectID != nil {
			t.Extra = &TaskExtraConfig{
				ProjectID: *pt.ProjectID,
				IssueID:   pt.IssueID,
			}
		}
	}
	t.FullName = repoFullName(t.RepoURL)

	return t
}

// TaskSession tasker 状态机的 payload
type TaskSession struct {
	Task     *taskflow.CreateTaskReq `json:"task"`
	User     *User                   `json:"user"`
	Platform consts.GitPlatform      `json:"platform"`
	ShowUrl  string                  `json:"show_url"`
}

// TaskStream 任务 WebSocket 流消息
type TaskStream struct {
	Type      consts.TaskStreamType `json:"type"`
	Data      []byte                `json:"data"`
	Kind      string                `json:"kind"`
	Timestamp int64                 `json:"timestamp"`
}

// TaskStreamReq 任务数据流请求
type TaskStreamReq struct {
	ID   uuid.UUID `json:"id" query:"id" validate:"required"`
	Mode string    `json:"mode" query:"mode"` // new|attach，默认 new
}

// TaskControlReq 控制 WebSocket 请求
type TaskControlReq struct {
	ID uuid.UUID `json:"id" query:"id" validate:"required"` // 任务 id
}

// TaskRoundsReq 查询任务历史论次请求（向前翻页）
type TaskRoundsReq struct {
	ID     uuid.UUID `json:"id" query:"id" validate:"required"` // 任务 ID
	Cursor string    `json:"cursor" query:"cursor"`             // 游标（时间戳 Unix ns，从此时间点往前查询）
	Limit  int       `json:"limit" query:"limit"`               // 返回的论次数（默认 2，上限 10）
}

// TaskRoundsResp 查询任务历史论次响应
type TaskRoundsResp struct {
	Chunks     []*TaskChunkEntry `json:"chunks"`
	NextCursor string            `json:"next_cursor,omitempty"` // 下一页游标（最早条目的时间戳 ns）
	HasMore    bool              `json:"has_more"`
}

// TaskChunkEntry 原始日志条目（不聚合）
type TaskChunkEntry struct {
	Data      []byte            `json:"data,omitempty"`
	Event     string            `json:"event"`
	Kind      string            `json:"kind"`
	Timestamp int64             `json:"timestamp"`
	Labels    map[string]string `json:"labels,omitempty"`
}

// GitTask git 任务（由内部项目通过 TaskHook 提供）
type GitTask struct {
	ID                   uuid.UUID          `json:"id"`
	TaskID               uuid.UUID          `json:"task_id"`
	SubjectURL           string             `json:"subject_url"`
	PromptID             string             `json:"prompt_id"`
	GithubInstallationID int64              `json:"github_installation_id"`
	Platform             consts.GitPlatform `json:"platform"`
	Repo                 *GitTaskRepo       `json:"repo,omitempty"`
}

// GitTaskRepo git 任务关联的仓库信息
type GitTaskRepo struct {
	URL      string             `json:"url"`
	Platform consts.GitPlatform `json:"platform"`
}

// SpeechRecognitionEvent 语音识别事件响应
type SpeechRecognitionEvent struct {
	Event string                `json:"event"` // 事件类型: recognition, end, error
	Data  SpeechRecognitionData `json:"data"`  // 事件数据
}

// SpeechRecognitionData 语音识别事件数据
type SpeechRecognitionData struct {
	Type      string `json:"type" example:"result"`                       // 数据类型: result, end, error
	Text      string `json:"text,omitempty" example:"你好"`                 // 识别文本 (仅result类型)
	IsFinal   bool   `json:"is_final,omitempty" example:"false"`          // 是否为最终结果 (仅result类型)
	UserID    string `json:"user_id,omitempty" example:"uuid"`            // 用户ID (仅result类型)
	Timestamp int64  `json:"timestamp,omitempty" example:"1640995200000"` // 时间戳 (仅result类型)
	Error     string `json:"error,omitempty" example:"识别失败"`              // 错误信息 (仅error类型)
}
