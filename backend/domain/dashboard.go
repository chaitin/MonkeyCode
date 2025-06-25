package domain

import (
	"context"

	"github.com/chaitin/MonkeyCode/backend/db"
)

type DashboardUsecase interface {
	Statistics(ctx context.Context) (*Statistics, error)
	CategoryStat(ctx context.Context) (*CategoryStat, error)
	TimeStat(ctx context.Context) (*TimeStat, error)
	UserCodeRank(ctx context.Context) ([]*UserCodeRank, error)
	UserStat(ctx context.Context, userID string) (*UserStat, error)
	UserEvents(ctx context.Context, userID string) ([]*UserEvent, error)
	UserHeatmap(ctx context.Context, userID string) (*UserHeatmapResp, error)
}

type DashboardRepo interface {
	Statistics(ctx context.Context) (*Statistics, error)
	CategoryStat(ctx context.Context) (*CategoryStat, error)
	TimeStat(ctx context.Context) (*TimeStat, error)
	UserCodeRank(ctx context.Context) ([]*UserCodeRank, error)
	UserStat(ctx context.Context, userID string) (*UserStat, error)
	UserEvents(ctx context.Context, userID string) ([]*UserEvent, error)
	UserHeatmap(ctx context.Context, userID string) ([]*UserHeatmap, error)
}

type Statistics struct {
	TotalUsers    int64 `json:"total_users"`    // 总用户数
	DisabledUsers int64 `json:"disabled_users"` // 禁用用户数
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
}

func (u *UserCodeRank) From(d *db.Record) *UserCodeRank {
	if d == nil {
		return u
	}
	u.Username = d.Edges.User.Username
	u.Lines = d.CodeLines
	return u
}

type UserStat struct {
	TotalChats       int64                `json:"total_chats"`         // 近90天总对话任务数
	TotalCompletions int64                `json:"total_completions"`   // 近90天总补全任务数
	TotalLinesOfCode int64                `json:"total_lines_of_code"` // 近90天总代码行数
	TotalAcceptedPer float64              `json:"total_accepted_per"`  // 近90天总接受率
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
