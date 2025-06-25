package repo

import (
	"context"
	"time"

	"entgo.io/ent/dialect/sql"
	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/record"
	"github.com/chaitin/MonkeyCode/backend/db/user"
	"github.com/chaitin/MonkeyCode/backend/domain"
)

type DashboardRepo struct {
	db *db.Client
}

func NewDashboardRepo(db *db.Client) domain.DashboardRepo {
	return &DashboardRepo{db: db}
}

// CategoryStat implements domain.DashboardRepo.
func (d *DashboardRepo) CategoryStat(ctx context.Context) (*domain.CategoryStat, error) {
	var cs []domain.CategoryPoint
	if err := d.db.Record.Query().
		Where(record.CreatedAtGTE(time.Now().AddDate(0, 0, -90))).
		Where(record.WorkModeNEQ("")).
		Modify(func(s *sql.Selector) {
			s.Select(
				sql.As("work_mode", "category"),
				sql.As("COUNT(*)", "value"),
			).GroupBy(record.FieldWorkMode).
				OrderBy(sql.Desc("value"))
		}).
		Scan(ctx, &cs); err != nil {
		return nil, err
	}
	var ps []domain.CategoryPoint
	if err := d.db.Record.Query().
		Where(record.CreatedAtGTE(time.Now().AddDate(0, 0, -90))).
		Where(record.ProgramLanguageNotNil()).
		Modify(func(s *sql.Selector) {
			s.Select(
				sql.As("program_language", "category"),
				sql.As("COUNT(*)", "value"),
			).GroupBy(record.FieldProgramLanguage).
				OrderBy(sql.Desc("value"))
		}).
		Scan(ctx, &ps); err != nil {
		return nil, err
	}

	return &domain.CategoryStat{
		WorkMode:        cs,
		ProgramLanguage: ps,
	}, nil
}

// Statistics implements domain.DashboardRepo.
func (d *DashboardRepo) Statistics(ctx context.Context) (*domain.Statistics, error) {
	totalUsers, err := d.db.User.Query().Count(ctx)
	if err != nil {
		return nil, err
	}
	disabledUsers, err := d.db.User.Query().Where(user.Status(consts.UserStatusInactive)).Count(ctx)
	if err != nil {
		return nil, err
	}
	return &domain.Statistics{
		TotalUsers:    int64(totalUsers),
		DisabledUsers: int64(disabledUsers),
	}, nil
}

type DateValue struct {
	Date          time.Time `json:"date"`
	UserCount     int64     `json:"user_count"`
	LlmCount      int64     `json:"llm_count"`
	CodeCount     int64     `json:"code_count"`
	AcceptedCount int64     `json:"accepted_count"`
	CodeLines     int64     `json:"code_lines"`
	Count         int64     `json:"count"`
}

// TimeStat implements domain.DashboardRepo.
func (d *DashboardRepo) TimeStat(ctx context.Context) (*domain.TimeStat, error) {
	ds := make([]DateValue, 0)
	if err := d.db.Record.Query().
		Where(record.CreatedAtGTE(time.Now().AddDate(0, 0, -90))).
		Modify(func(s *sql.Selector) {
			s.Select(
				sql.As("date_trunc('day', created_at)", "date"),
				sql.As("COUNT(DISTINCT user_id)", "user_count"),
				sql.As("COUNT(*) FILTER (WHERE model_type = 'llm')", "llm_count"),
				sql.As("COUNT(*) FILTER (WHERE model_type = 'coder')", "code_count"),
				sql.As("COUNT(*) FILTER (WHERE is_accept = true AND model_type = 'coder')", "accepted_count"),
				sql.As(sql.Sum(record.FieldCodeLines), "code_lines"),
			).GroupBy("date").
				OrderBy(sql.Asc("date"))
		}).
		Scan(ctx, &ds); err != nil {
		return nil, err
	}

	dsOneHour := make([]DateValue, 0)
	if err := d.db.Record.Query().
		Where(record.CreatedAtGTE(time.Now().Add(-time.Hour))).
		Modify(func(s *sql.Selector) {
			s.Select(
				sql.As("date_trunc('minute', created_at)", "date"),
				sql.As(sql.Count("*"), "count"),
			).GroupBy("date").
				OrderBy(sql.Asc("date"))
		}).
		Scan(ctx, &dsOneHour); err != nil {
		return nil, err
	}

	ts := &domain.TimeStat{
		ActiveUsers:    []domain.TimePoint[int64]{},
		RealTimeTokens: []domain.TimePoint[int64]{},
		Chats:          []domain.TimePoint[int64]{},
		Completions:    []domain.TimePoint[int64]{},
		LinesOfCode:    []domain.TimePoint[int64]{},
		AcceptedPer:    []domain.TimePoint[float64]{},
	}

	for _, v := range dsOneHour {
		ts.RealTimeTokens = append(ts.RealTimeTokens, domain.TimePoint[int64]{
			Timestamp: v.Date.Unix(),
			Value:     v.Count,
		})
	}

	for _, v := range ds {
		ts.TotalUsers += v.UserCount
		ts.TotalChats += v.LlmCount
		ts.TotalCompletions += v.CodeCount
		ts.TotalLinesOfCode += v.CodeLines
		ts.ActiveUsers = append(ts.ActiveUsers, domain.TimePoint[int64]{
			Timestamp: v.Date.Unix(),
			Value:     v.UserCount,
		})
		ts.Chats = append(ts.Chats, domain.TimePoint[int64]{
			Timestamp: v.Date.Unix(),
			Value:     v.LlmCount,
		})
		ts.Completions = append(ts.Completions, domain.TimePoint[int64]{
			Timestamp: v.Date.Unix(),
			Value:     v.CodeCount,
		})
		ts.LinesOfCode = append(ts.LinesOfCode, domain.TimePoint[int64]{
			Timestamp: v.Date.Unix(),
			Value:     v.CodeLines,
		})
		if v.CodeCount > 0 {
			ts.AcceptedPer = append(ts.AcceptedPer, domain.TimePoint[float64]{
				Timestamp: v.Date.Unix(),
				Value:     float64(v.AcceptedCount) / float64(v.CodeCount) * 100,
			})
		}
	}

	return ts, nil
}

type UserCodeRank struct {
	UserID    uuid.UUID `json:"user_id"`
	CodeLines int64     `json:"code_lines"`
}

// UserCodeRank implements domain.DashboardRepo.
func (d *DashboardRepo) UserCodeRank(ctx context.Context) ([]*domain.UserCodeRank, error) {
	var rs []UserCodeRank
	if err := d.db.Record.Query().
		Where(record.CreatedAtGTE(time.Now().AddDate(0, 0, -90))).
		Modify(func(s *sql.Selector) {
			s.Select(
				sql.As("user_id", "user_id"),
				sql.As(sql.Sum(record.FieldCodeLines), "code_lines"),
			).GroupBy(record.FieldUserID).
				OrderBy(sql.Desc("code_lines"))
		}).
		Scan(ctx, &rs); err != nil {
		return nil, err
	}

	ids := cvt.Iter(rs, func(_ int, v UserCodeRank) uuid.UUID {
		return v.UserID
	})
	users, err := d.db.User.Query().
		Where(user.IDIn(ids...)).
		All(ctx)
	if err != nil {
		return nil, err
	}
	m := cvt.IterToMap(users, func(_ int, v *db.User) (uuid.UUID, *db.User) {
		return v.ID, v
	})
	return cvt.Iter(rs, func(_ int, v UserCodeRank) *domain.UserCodeRank {
		return &domain.UserCodeRank{
			Username: m[v.UserID].Username,
			Lines:    v.CodeLines,
		}
	}), nil
}

// UserEvents implements domain.DashboardRepo.
func (d *DashboardRepo) UserEvents(ctx context.Context, userID string) ([]*domain.UserEvent, error) {
	id, err := uuid.Parse(userID)
	if err != nil {
		return nil, err
	}
	rs, err := d.db.Record.Query().
		WithUser().
		Where(record.CreatedAtGTE(time.Now().AddDate(0, 0, -90))).
		Where(record.HasUserWith(user.ID(id))).
		Order(record.ByCreatedAt(sql.OrderDesc())).
		Limit(100).
		All(ctx)
	if err != nil {
		return nil, err
	}

	return cvt.Iter(rs, func(_ int, v *db.Record) *domain.UserEvent {
		return &domain.UserEvent{
			Name:      v.Edges.User.Username,
			CreatedAt: v.CreatedAt.Unix(),
		}
	}), nil
}

// UserStat implements domain.DashboardRepo.
func (d *DashboardRepo) UserStat(ctx context.Context, userID string) (*domain.UserStat, error) {
	id, err := uuid.Parse(userID)
	if err != nil {
		return nil, err
	}
	var ds []DateValue
	if err := d.db.Record.Query().
		Where(record.HasUserWith(user.ID(id))).
		Where(record.CreatedAtGTE(time.Now().AddDate(0, 0, -90))).
		Modify(func(s *sql.Selector) {
			s.Select(
				sql.As("date_trunc('day', created_at)", "date"),
				sql.As("COUNT(DISTINCT user_id)", "user_count"),
				sql.As("COUNT(*) FILTER (WHERE model_type = 'llm')", "llm_count"),
				sql.As("COUNT(*) FILTER (WHERE model_type = 'coder')", "code_count"),
				sql.As("COUNT(*) FILTER (WHERE is_accept = true AND model_type = 'coder')", "accepted_count"),
				sql.As(sql.Sum(record.FieldCodeLines), "code_lines"),
			).GroupBy("date").
				OrderBy(sql.Asc("date"))
		}).
		Scan(ctx, &ds); err != nil {
		return nil, err
	}

	var cs []domain.CategoryPoint
	if err := d.db.Record.Query().
		Where(record.CreatedAtGTE(time.Now().AddDate(0, 0, -90))).
		Where(record.HasUserWith(user.ID(id))).
		Where(record.WorkModeNotNil()).
		Modify(func(s *sql.Selector) {
			s.Select(
				sql.As("work_mode", "category"),
				sql.As("COUNT(*)", "value"),
			).GroupBy(record.FieldWorkMode).
				OrderBy(sql.Desc("value"))
		}).
		Scan(ctx, &cs); err != nil {
		return nil, err
	}
	var ps []domain.CategoryPoint
	if err := d.db.Record.Query().
		Where(record.CreatedAtGTE(time.Now().AddDate(0, 0, -90))).
		Where(record.HasUserWith(user.ID(id))).
		Where(record.ProgramLanguageNotNil()).
		Modify(func(s *sql.Selector) {
			s.Select(
				sql.As("program_language", "category"),
				sql.As("COUNT(*)", "value"),
			).GroupBy(record.FieldProgramLanguage).
				OrderBy(sql.Desc("value"))
		}).
		Scan(ctx, &ps); err != nil {
		return nil, err
	}

	us := &domain.UserStat{
		WorkMode:        cs,
		ProgramLanguage: ps,
		Chats:           []domain.TimePoint[int64]{},
		Completions:     []domain.TimePoint[int64]{},
		LinesOfCode:     []domain.TimePoint[int64]{},
		AcceptedPer:     []domain.TimePoint[float64]{},
	}
	acceptedCount := int64(0)
	codeCount := int64(0)
	for _, v := range ds {
		us.TotalChats += v.LlmCount
		us.TotalCompletions += v.CodeCount
		us.TotalLinesOfCode += v.CodeLines
		acceptedCount += v.AcceptedCount
		codeCount += v.CodeCount
		us.Chats = append(us.Chats, domain.TimePoint[int64]{
			Timestamp: v.Date.Unix(),
			Value:     v.LlmCount,
		})
		us.Completions = append(us.Completions, domain.TimePoint[int64]{
			Timestamp: v.Date.Unix(),
			Value:     v.CodeCount,
		})
		us.LinesOfCode = append(us.LinesOfCode, domain.TimePoint[int64]{
			Timestamp: v.Date.Unix(),
			Value:     v.CodeLines,
		})
		if v.CodeCount > 0 {
			us.AcceptedPer = append(us.AcceptedPer, domain.TimePoint[float64]{
				Timestamp: v.Date.Unix(),
				Value:     float64(v.AcceptedCount) / float64(v.CodeCount) * 100,
			})
		}
	}
	if codeCount > 0 {
		us.TotalAcceptedPer = float64(acceptedCount) / float64(codeCount) * 100
	}
	return us, nil
}

func (d *DashboardRepo) UserHeatmap(ctx context.Context, userID string) ([]*domain.UserHeatmap, error) {
	id, err := uuid.Parse(userID)
	if err != nil {
		return nil, err
	}

	var rs []DateValue
	if err := d.db.Record.Query().
		Where(record.HasUserWith(user.ID(id))).
		Where(record.CreatedAtGTE(time.Now().AddDate(-1, 0, 0))).
		Modify(func(s *sql.Selector) {
			s.Select(
				sql.As("date_trunc('day', created_at)", "date"),
				sql.As("COUNT(*)", "count"),
			).GroupBy("date").
				OrderBy(sql.Asc("date"))
		}).
		Scan(ctx, &rs); err != nil {
		return nil, err
	}

	return cvt.Iter(rs, func(_ int, v DateValue) *domain.UserHeatmap {
		return &domain.UserHeatmap{
			Date:  v.Date.Unix(),
			Count: v.Count,
		}
	}), nil
}
