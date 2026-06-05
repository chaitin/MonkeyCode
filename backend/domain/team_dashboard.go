package domain

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/db"
)

type TeamDashboardUsecase interface {
	Overview(ctx context.Context, teamUser *TeamUser, req TeamDashboardReq) (*TeamDashboardResp, error)
	ListProjects(ctx context.Context, teamUser *TeamUser, req TeamDashboardListReq) (*TeamProjectListResp, error)
	ListTasks(ctx context.Context, teamUser *TeamUser, req TeamDashboardListReq) (*TeamTaskListResp, error)
	ListConversations(ctx context.Context, teamUser *TeamUser, req TeamDashboardListReq) (*TeamConversationListResp, error)
}

type TeamDashboardRepo interface {
	Overview(ctx context.Context, teamID uuid.UUID, req TeamDashboardQuery) (*TeamDashboardResp, error)
	ListProjects(ctx context.Context, teamID uuid.UUID, req TeamDashboardListReq) (*TeamProjectListResp, error)
	ListTasks(ctx context.Context, teamID uuid.UUID, req TeamDashboardListReq) (*TeamTaskListResp, error)
	ListConversations(ctx context.Context, teamID uuid.UUID, req TeamDashboardListReq) (*TeamConversationListResp, error)
}

type TeamDashboardReq struct {
	Range string `query:"range" json:"range" validate:"omitempty"`
}

type TeamDashboardQuery struct {
	Start      time.Time
	End        time.Time
	TrendStart time.Time
}

type TeamDashboardResp struct {
	Range             string                `json:"range"`
	StartAt           int64                 `json:"start_at"`
	EndAt             int64                 `json:"end_at"`
	Metrics           TeamDashboardMetrics  `json:"metrics"`
	Trends            TeamDashboardTrends   `json:"trends"`
	Insights          TeamDashboardInsights `json:"insights"`
	ProjectStats      TeamProjectStats      `json:"project_stats"`
	TaskStats         TeamTaskStats         `json:"task_stats"`
	ConversationStats TeamConversationStats `json:"conversation_stats"`
}

type TeamProjectStats struct {
	Total        int                       `json:"total"`
	Active7d     int                       `json:"active_7d"`
	ActiveToday  int                       `json:"active_today"`
	DailyCreated []TeamDashboardTrendPoint `json:"daily_created"`
}

type TeamTaskStats struct {
	Total        int                       `json:"total"`
	Active7d     int                       `json:"active_7d"`
	ActiveToday  int                       `json:"active_today"`
	DailyCreated []TeamDashboardTrendPoint `json:"daily_created"`
}

type TeamConversationStats struct {
	Total        int64                     `json:"total"`
	Count7d      int64                     `json:"count_7d"`
	CountToday   int64                     `json:"count_today"`
	DailyCreated []TeamDashboardTrendPoint `json:"daily_created"`
}

type TeamDashboardMetrics struct {
	ActiveMembers     int     `json:"active_members"`
	TotalMembers      int     `json:"total_members"`
	ActiveRate        float64 `json:"active_rate"`
	TaskCount         int     `json:"task_count"`
	RunningTaskCount  int     `json:"running_task_count"`
	FinishedTaskCount int     `json:"finished_task_count"`
	AverageDuration   int64   `json:"average_duration"`
	InputTokens       int64   `json:"input_tokens"`
	OutputTokens      int64   `json:"output_tokens"`
	CachedTokens      int64   `json:"cached_tokens"`
	TotalTokens       int64   `json:"total_tokens"`
	LLMRequests       int64   `json:"llm_requests"`
	CacheHitRate      float64 `json:"cache_hit_rate"`
}

type TeamDashboardTrends struct {
	TaskCounts    []TeamDashboardTrendPoint `json:"task_counts"`
	ActiveMembers []TeamDashboardTrendPoint `json:"active_members"`
	TokenUsage    []TeamDashboardTrendPoint `json:"token_usage"`
}

type TeamDashboardTrendPoint struct {
	Date  string `json:"date"`
	Value int64  `json:"value"`
}

type TeamDashboardInsights struct {
	ActiveMembers    []TeamDashboardMemberInsight      `json:"active_members"`
	HighConsumption  []TeamDashboardConsumptionInsight `json:"high_consumption"`
	LongRunningTasks []TeamDashboardTaskInsight        `json:"long_running_tasks"`
}

type TeamDashboardMemberInsight struct {
	UserID       uuid.UUID `json:"user_id"`
	Name         string    `json:"name"`
	Email        string    `json:"email"`
	GroupName    string    `json:"group_name"`
	TaskCount    int       `json:"task_count"`
	LastActiveAt int64     `json:"last_active_at"`
}

type TeamDashboardConsumptionInsight struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Type        string  `json:"type"`
	TotalTokens int64   `json:"total_tokens"`
	LLMRequests int64   `json:"llm_requests"`
	Percent     float64 `json:"percent"`
}

type TeamDashboardTaskInsight struct {
	TaskID    uuid.UUID `json:"task_id"`
	Title     string    `json:"title"`
	Creator   string    `json:"creator"`
	Status    string    `json:"status"`
	Duration  int64     `json:"duration"`
	HostName  string    `json:"host_name"`
	CreatedAt int64     `json:"created_at"`
}

type TeamDashboardListReq struct {
	Cursor string `query:"cursor" json:"cursor" validate:"omitempty"`
	Limit  int    `query:"limit" json:"limit" validate:"omitempty,min=0,max=100"`
}

type TeamProjectListResp struct {
	Projects []*TeamProjectItem `json:"projects"`
	Page     *db.Cursor          `json:"page"`
}

type TeamProjectItem struct {
	ID        uuid.UUID `json:"id"`
	Name      string    `json:"name"`
	RepoURL   string    `json:"repo_url"`
	Branch    string    `json:"branch"`
	Creator   *User     `json:"creator"`
	TaskCount int       `json:"task_count"`
	IssueCount int      `json:"issue_count"`
	CreatedAt int64     `json:"created_at"`
	UpdatedAt int64     `json:"updated_at"`
}

type TeamTaskListResp struct {
	Tasks []*TeamTaskItem `json:"tasks"`
	Page  *db.Cursor      `json:"page"`
}

type TeamTaskItem struct {
	ID           uuid.UUID `json:"id"`
	Title        string    `json:"title"`
	Content      string    `json:"content"`
	Status       string    `json:"status"`
	Kind         string    `json:"kind"`
	Creator      *User     `json:"creator"`
	ProjectID    uuid.UUID `json:"project_id"`
	ProjectName  string    `json:"project_name"`
	CreatedAt    int64     `json:"created_at"`
	LastActiveAt int64     `json:"last_active_at"`
}

type TeamConversationListResp struct {
	Conversations []*TeamConversationItem `json:"conversations"`
	Page          *db.Cursor               `json:"page"`
}

type TeamConversationItem struct {
	ID              string    `json:"id"`
	TaskID          uuid.UUID `json:"task_id"`
	TaskTitle       string    `json:"task_title"`
	ProjectID       uuid.UUID `json:"project_id"`
	ProjectName     string    `json:"project_name"`
	Creator          *User     `json:"creator"`
	Content          string    `json:"content"`
	AttachmentCount int       `json:"attachment_count"`
	CreatedAt       int64     `json:"created_at"`
}
