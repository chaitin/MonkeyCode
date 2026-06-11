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
	Continue(ctx context.Context, user *User, id uuid.UUID, req ContinueTaskReq) error
	Create(ctx context.Context, user *User, req CreateTaskReq) (*ProjectTask, error)
	Stop(ctx context.Context, user *User, id uuid.UUID) error
	Cancel(ctx context.Context, user *User, id uuid.UUID) error
	AutoApprove(ctx context.Context, user *User, id uuid.UUID, approve bool) error
	SwitchModel(ctx context.Context, user *User, taskID uuid.UUID, req SwitchTaskModelReq) (*SwitchTaskModelResp, error)
	GitTask(ctx context.Context, id uuid.UUID) (*GitTask, error)
	Delete(ctx context.Context, user *User, id uuid.UUID) error
	Update(ctx context.Context, user *User, req UpdateTaskReq) error
	IncrUserInputCount(ctx context.Context, userID, taskID uuid.UUID) error
}

// TaskRepo 任务数据访问接口
type TaskRepo interface {
	GetByID(ctx context.Context, id uuid.UUID) (*db.Task, error)
	GetLogStore(ctx context.Context, id uuid.UUID) (consts.LogStore, error)
	Stat(ctx context.Context, id uuid.UUID) (*TaskStats, error)
	StatByIDs(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]*TaskStats, error)
	Info(ctx context.Context, user *User, id uuid.UUID, isPrivileged bool) (*db.Task, error)
	List(ctx context.Context, user *User, req TaskListReq) ([]*db.ProjectTask, *db.PageInfo, error)
	Create(ctx context.Context, user *User, req CreateTaskReq, token string, fn func(*db.ProjectTask, *db.Model, *db.Image) (*taskflow.VirtualMachine, error)) (*db.ProjectTask, error)
	Update(ctx context.Context, user *User, id uuid.UUID, fn func(up *db.TaskUpdateOne) error) error
	RefreshLastActiveAt(ctx context.Context, id uuid.UUID, at time.Time, minInterval time.Duration) error
	Stop(ctx context.Context, user *User, id uuid.UUID, fn func(*db.Task) error) error
	Delete(ctx context.Context, user *User, id uuid.UUID) error
	UpdateProjectTaskModel(ctx context.Context, taskID, modelID uuid.UUID) error
	CreateModelSwitch(ctx context.Context, item *TaskModelSwitch) error
	FinishModelSwitch(ctx context.Context, id uuid.UUID, success bool, message, sessionID string) error
	CompleteModelSwitch(ctx context.Context, id, taskID, modelID uuid.UUID, success bool, message, sessionID string) error
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
	Attachments   []TaskAttachment   `json:"attachments" validate:"omitempty"` // 附件列表，最多 10 个；URL 必须匹配后端配置的附件白名单前缀
	Now           time.Time          `json:"-"`
	UsePublicHost bool               `json:"-"`
}

type ContinueTaskReq struct {
	Content     []byte           `json:"content"`
	Attachments []TaskAttachment `json:"attachments"`
}

type TaskAttachment struct {
	URL      string `json:"url"`
	Filename string `json:"filename"`
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

// UpdateTaskReq 更新任务请求
type UpdateTaskReq struct {
	ID    uuid.UUID `param:"id" validate:"required" json:"-" swaggerignore:"true"`
	Title *string   `json:"title"`
}

// SwitchTaskModelReq 切换任务运行模型请求
type SwitchTaskModelReq struct {
	RequestID   string    `json:"request_id"`
	ModelID     uuid.UUID `json:"model_id" validate:"required"`
	LoadSession bool      `json:"load_session"`
}

// SwitchTaskModelResp 切换任务运行模型响应
type SwitchTaskModelResp struct {
	ID        uuid.UUID   `json:"id"`
	RequestID string      `json:"request_id,omitempty"`
	Success   bool        `json:"success"`
	Message   string      `json:"message"`
	SessionID string      `json:"session_id"`
	Model     *ModelBrief `json:"model,omitempty"`
}

// TaskModelSwitch 任务模型切换记录
type TaskModelSwitch struct {
	ID          uuid.UUID
	TaskID      uuid.UUID
	UserID      uuid.UUID
	FromModelID *uuid.UUID
	ToModelID   uuid.UUID
	RequestID   string
	LoadSession bool
}

// ListTaskResp 任务列表响应
type ListTaskResp struct {
	Tasks    []*ProjectTask `json:"tasks"`
	PageInfo *db.PageInfo   `json:"page_info,omitempty"`
}

// TaskListReq 任务列表请求
type TaskListReq struct {
	ProjectID  uuid.UUID `json:"project_id" query:"project_id" validate:"omitempty"`
	QuickStart bool      `json:"quick_start" query:"quick_start" validate:"omitempty"`
	Status     *string   `json:"status" query:"status"` // 状态筛选，多值用逗号分开 pending,processing,error,finished
	*web.Pagination
}

// ProjectTask 项目任务
type ProjectTask struct {
	ID           uuid.UUID        `json:"id" validate:"required"`
	Model        *ModelBrief      `json:"model,omitempty"`
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
	pt.Model = cvt.From(src.Edges.Model, &ModelBrief{})
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
	Title          string             `json:"title"`
	Summary        string             `json:"summary"`
	Status         consts.TaskStatus  `json:"status"`
	LogStore       consts.LogStore    `json:"log_store"`
	VirtualMachine *VirtualMachine    `json:"virtualmachine"`
	CreatedAt      int64              `json:"created_at"`
	LastActiveAt   int64              `json:"last_active_at"`
	CompletedAt    int64              `json:"completed_at"`
	Model          *ModelBrief        `json:"model,omitempty"`
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
	t.Title = src.Title
	t.Summary = src.Summary
	t.Status = src.Status
	if src.LogStore != nil {
		t.LogStore = *src.LogStore
	}
	if t.LogStore == "" {
		t.LogStore = consts.LogStoreLoki
	}
	t.CreatedAt = src.CreatedAt.Unix()
	t.LastActiveAt = src.LastActiveAt.Unix()
	t.CompletedAt = src.CompletedAt.Unix()
	if vms := src.Edges.Vms; len(vms) > 0 {
		t.VirtualMachine = cvt.From(vms[0], &VirtualMachine{})
	}
	if pts := src.Edges.ProjectTasks; len(pts) > 0 {
		pt := pts[0]
		t.Model = cvt.From(pt.Edges.Model, &ModelBrief{})
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
	Data      []byte                `json:"data"` // user-input 事件使用 TaskUserInputPayload 的 JSON 字符串
	Kind      string                `json:"kind"`
	Timestamp int64                 `json:"timestamp"`
}

// TaskUserInputPayload user-input 事件 data 字段的 JSON 结构
type TaskUserInputPayload struct {
	Content     []byte           `json:"content"`     // 用户输入文本，JSON 中按 base64 字符串传输
	Attachments []TaskAttachment `json:"attachments"` // 附件列表，缺省或空数组表示无附件
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

// TaskRoundsReq 查询任务历史轮次请求（向前翻页）
type TaskRoundsReq struct {
	ID     uuid.UUID `json:"id" query:"id" validate:"required"` // 任务 ID
	Cursor string    `json:"cursor" query:"cursor"`             // 分页游标
	Limit  int       `json:"limit" query:"limit"`               // 返回的轮次数（默认 2，上限 10）
}

// TaskRoundsResp 查询任务历史轮次响应
type TaskRoundsResp struct {
	Chunks     []*TaskChunkEntry `json:"chunks"`
	NextCursor string            `json:"next_cursor,omitempty"` // 下一页游标
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

// TaskUserInputsReq 查询任务用户输入列表请求（正序，从最早翻到最新）
type TaskUserInputsReq struct {
	ID     uuid.UUID `json:"id" query:"id" validate:"required"` // 任务 ID
	Cursor string    `json:"cursor" query:"cursor"`             // 分页游标
	Limit  int       `json:"limit" query:"limit"`               // 返回条数（默认 20，上限 100）
}

// TaskUserInputItem 单条用户输入（侧边栏用）
type TaskUserInputItem struct {
	ID        string `json:"id"`        // 与前端 message.id 对齐：user-input-{timestamp}
	Content   string `json:"content"`   // 用户输入文本，超过 500 字符截断
	Truncated bool   `json:"truncated"` // 是否被截断
	Timestamp int64  `json:"timestamp"` // 纳秒，与 chunk.timestamp 对齐
}

// TaskUserInputsResp 查询任务用户输入列表响应
type TaskUserInputsResp struct {
	Items      []*TaskUserInputItem `json:"items"`
	NextCursor string               `json:"next_cursor,omitempty"`
	HasMore    bool                 `json:"has_more"`
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

// SpeechStreamStartReq 实时语音转写 WebSocket 的 start 控制消息(客户端首帧必须为本结构)
type SpeechStreamStartReq struct {
	// 消息类型,固定为 "start"
	Type string `json:"type" example:"start" binding:"required"`
	// 音频容器格式,单声道、16-bit、采样率固定 16000Hz。
	// pcm / wav 内部音频流必须是 pcm_s16le;ogg 必须为 opus 编码;mp3 由服务端解码。
	Format string `json:"format,omitempty" example:"pcm" enums:"pcm,wav,ogg,mp3"`
	// 是否启用语义顺滑(过滤"嗯/啊"等口头禅、语义重复词),默认 false
	Disfluency bool `json:"disfluency,omitempty" example:"false"`
}

// SpeechStreamControl 实时语音转写 WebSocket 的通用控制消息(用于 stop,或解析首帧 type)
type SpeechStreamControl struct {
	// 控制消息类型,目前支持 "stop"
	Type string `json:"type" example:"stop" enums:"stop"`
}

// SpeechStreamError 实时语音转写 error 事件中的错误详情。
// Code 为远端 ASR 服务返回的错误码;本服务前置校验错误 (远端连接前) 时 Code=0,
// 由 Message 描述原因。RequestID / Logid 用于排障时跟运维/厂商客服关联日志。
type SpeechStreamError struct {
	// 错误码;远端 ASR 错误码 (如豆包 45000001),本地校验错误为 0
	Code int `json:"code" example:"45000001"`
	// 错误描述,远端错误为远端 message,本地校验错误为可读原因
	Message string `json:"message" example:"请求参数无效"`
	// 后端发给远端 ASR 的 X-Api-Request-Id (UUID),便于跟单次请求关联日志
	RequestID string `json:"request_id,omitempty" example:"67ee89ba-7050-4c04-a3d7-ac61a63499b3"`
	// 远端 ASR 服务返回的 trace id (如豆包 X-Tt-Logid),报障必备
	Logid string `json:"logid,omitempty" example:"202407261553070FACFE6D19421815D605"`
}

// SpeechStreamEvent 实时语音转写 WebSocket 服务端→客户端事件(所有事件统一外层结构)
type SpeechStreamEvent struct {
	// 事件类型:ready / partial / final / done / error
	Type string `json:"type" example:"partial" enums:"ready,partial,final,done,error"`
	// 句子序号,从 1 开始;partial / final 携带,其余事件省略
	Index int `json:"index,omitempty" example:"1"`
	// 识别文本;partial(中间结果,会反复变化)/ final(本句定稿)携带
	Text string `json:"text,omitempty" example:"今天天气真不错。"`
	// 远端 ASR 服务的 trace id;ready / error 事件携带,便于全程关联日志
	Logid string `json:"logid,omitempty" example:"202407261553070FACFE6D19421815D605"`
	// 错误详情;仅 error 事件携带
	Error *SpeechStreamError `json:"error,omitempty"`
	// 服务端时间(毫秒),所有事件都有
	Timestamp int64 `json:"timestamp" example:"1733299200000"`
}
