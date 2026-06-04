package domain

import (
	"context"
	"time"

	"github.com/google/uuid"
)

type TeamDashboardUsecase interface {
	Overview(ctx context.Context, teamUser *TeamUser, req TeamDashboardReq) (*TeamDashboardResp, error)
}

type TeamDashboardRepo interface {
	Overview(ctx context.Context, teamID uuid.UUID, req TeamDashboardQuery) (*TeamDashboardResp, error)
}

type TeamDashboardReq struct {
	Range string `query:"range" json:"range" validate:"omitempty"`
}

type TeamDashboardQuery struct {
	Start time.Time
	End   time.Time
}

type TeamDashboardResp struct {
	Range    string                `json:"range"`
	StartAt  int64                 `json:"start_at"`
	EndAt    int64                 `json:"end_at"`
	Metrics  TeamDashboardMetrics  `json:"metrics"`
	Trends   TeamDashboardTrends   `json:"trends"`
	Insights TeamDashboardInsights `json:"insights"`
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
