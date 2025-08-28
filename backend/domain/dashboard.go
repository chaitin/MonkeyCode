package domain

import (
	"context"
	"time"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
)

type DashboardUsecase interface {
	Statistics(ctx context.Context) (*Statistics, error)
	CategoryStat(ctx context.Context, req StatisticsFilter) (*CategoryStat, error)
	TimeStat(ctx context.Context, req StatisticsFilter) (*TimeStat, error)
	UserCodeRank(ctx context.Context, req StatisticsFilter) ([]*UserCodeRank, error)
	UserStat(ctx context.Context, req StatisticsFilter) (*UserStat, error)
	UserEvents(ctx context.Context, req StatisticsFilter) ([]*UserEvent, error)
	UserHeatmap(ctx context.Context, userID string) (*UserHeatmapResp, error)
}

type DashboardRepo interface {
	Statistics(ctx context.Context) (*Statistics, error)
	CategoryStat(ctx context.Context, req StatisticsFilter) (*CategoryStat, error)
	TimeStat(ctx context.Context, req StatisticsFilter) (*TimeStat, error)
	UserCodeRank(ctx context.Context, req StatisticsFilter) ([]*UserCodeRank, error)
	UserStat(ctx context.Context, req StatisticsFilter) (*UserStat, error)
	UserEvents(ctx context.Context, req StatisticsFilter) ([]*UserEvent, error)
	UserHeatmap(ctx context.Context, userID string) ([]*UserHeatmap, error)
}

type Statistics struct {
	TotalUsers    int64 `json:"total_users"`    // 总用户数
	DisabledUsers int64 `json:"disabled_users"` // 禁用用户数
}

type StatisticsFilter struct {
	Precision string `json:"precision" query:"precision"`       // 精度: "hour", "day"
	Duration  int    `json:"duration" query:"duration"`         // 持续时间 (小时或天数)`
	StartAt   int64  `json:"start_at" query:"start_at"`         // 开始时间, 时间范围优先级高于精度选择
	EndAt     int64  `json:"end_at" query:"end_at"`             // 结束时间, 时间范围优先级高于精度选择
	UserID    string `json:"user_id,omitempty" query:"user_id"` // 用户ID，可选参数
}

func (s StatisticsFilter) MustPrecision() string {
	if s.Precision == "" {
		return "day"
	}
	return s.Precision
}

func (s StatisticsFilter) StartTime() time.Time {
	if s.StartAt > 0 {
		return time.Unix(s.StartAt, 0)
	}
	return time.Now().Add(-24 * time.Hour)
}

func (s StatisticsFilter) EndTime() time.Time {
	if s.EndAt > 0 {
		return time.Unix(s.EndAt, 0)
	}
	return time.Now()
}

type UserHeatmapResp struct {
	MaxCount int64          `json:"max_count"`
	Points   []*UserHeatmap `json:"points"`
}

type UserHeatmap struct {
	Date  int64 `json:"date"`
	Count int64 `json:"count"`
}

type UserCodeRank struct {
	Username string `json:"username"` // 用户名
	Lines    int64  `json:"lines"`    // 代码行数
	User     *User  `json:"user"`     // 用户信息
}

func (u *UserCodeRank) From(d *db.Task) *UserCodeRank {
	if d == nil {
		return u
	}
	u.Username = d.Edges.User.Username
	u.Lines = d.CodeLines
	u.User = cvt.From(d.Edges.User, &User{})
	return u
}

type UserStat struct {
	TotalChats       int64                `json:"total_chats"`         // 总对话任务数
	TotalCompletions int64                `json:"total_completions"`   // 总补全任务数
	TotalLinesOfCode int64                `json:"total_lines_of_code"` // 总代码行数
	TotalAcceptedPer float64              `json:"total_accepted_per"`  // 总接受率
	Chats            []TimePoint[int64]   `json:"chats"`               // 对话任务数统计
	Completions      []TimePoint[int64]   `json:"code_completions"`    // 补全任务数统计
	LinesOfCode      []TimePoint[int64]   `json:"lines_of_code"`       // 代码行数统计
	AcceptedPer      []TimePoint[float64] `json:"accepted_per"`        // 接受率统计
	WorkMode         []CategoryPoint      `json:"work_mode"`           // 工作模式占比
	ProgramLanguage  []CategoryPoint      `json:"program_language"`    // 编程语言占比
}

type UserEvent struct {
	Name      string `json:"name"`       // 事件名称
	CreatedAt int64  `json:"created_at"` // 事件时间
}

type TimePoint[V any] struct {
	Timestamp int64 `json:"timestamp"` // 时间戳
	Value     V     `json:"value"`     // 值
}

type CategoryPoint struct {
	Category string `json:"category"` // 分类
	Value    int64  `json:"value"`    // 值
}

type CategoryStat struct {
	WorkMode        []CategoryPoint `json:"work_mode"`        // 工作模式占比
	ProgramLanguage []CategoryPoint `json:"program_language"` // 编程语言占比
}

type TimeStat struct {
	TotalUsers       int64                `json:"total_users"`         // 近90天活跃用户数
	TotalChats       int64                `json:"total_chats"`         // 近90天对话任务数
	TotalCompletions int64                `json:"total_completions"`   // 近90天补全任务数
	TotalLinesOfCode int64                `json:"total_lines_of_code"` // 近90天代码行数
	TotalAcceptedPer float64              `json:"total_accepted_per"`  // 近90天平均接受率
	ActiveUsers      []TimePoint[int64]   `json:"active_users"`        // 活跃用户数统计
	RealTimeTokens   []TimePoint[int64]   `json:"real_time_tokens"`    // 实时token数统计
	Chats            []TimePoint[int64]   `json:"chats"`               // 对话任务数统计
	Completions      []TimePoint[int64]   `json:"code_completions"`    // 补全任务数统计
	LinesOfCode      []TimePoint[int64]   `json:"lines_of_code"`       // 代码行数统计
	AcceptedPer      []TimePoint[float64] `json:"accepted_per"`        // 接受率统计
}
