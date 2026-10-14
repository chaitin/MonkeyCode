package stats

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	pool            *pgxpool.Pool
	now             func() time.Time
	auditAuthorizer func(*http.Request) bool
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool, now: time.Now}
}

// SetSessionReportingAuditAuthorizer 为清除审计权限预留接入边界。
// TODO(app): 接入清除审计角色后注入权限判断；未注入时拒绝读取墓碑详情。
// 清除操作人和审计 ID 须待清除方持久化审计元数据后才能加入墓碑摘要。
func (s *Service) SetSessionReportingAuditAuthorizer(authorizer func(*http.Request) bool) {
	s.auditAuthorizer = authorizer
}

func (s *Service) canReadPurged(r *http.Request) bool {
	return s.auditAuthorizer != nil && s.auditAuthorizer(r)
}

type window struct {
	from, until time.Time
}

func period(r *http.Request, now time.Time) (window, error) {
	ranges := map[string]time.Duration{
		"5m": 5 * time.Minute, "15m": 15 * time.Minute, "30m": 30 * time.Minute,
		"60m": time.Hour, "1h": time.Hour, "4h": 4 * time.Hour,
		"1d": 24 * time.Hour, "7d": 7 * 24 * time.Hour,
	}
	value := r.URL.Query().Get("range")
	if value == "" {
		value = "1d"
	}
	duration, ok := ranges[value]
	if !ok {
		return window{}, resource.Invalid("统计周期无效")
	}
	return window{from: now.Add(-duration), until: now}, nil
}

func (s *Service) RegisterAdmin(r chi.Router) {
	r.Get("/statistics/realtime", s.read(realtime))
	r.Get("/statistics/users", s.usersOverview)
	r.Get("/statistics/tasks/overview", s.tasksOverview)
	r.Get("/statistics/models/overview", s.modelsOverview)
	r.Get("/statistics/history", s.history)
	r.Get("/statistics/conversations", s.conversations)
	r.Get("/statistics/session-reporting/sessions/{id}", s.reportingDetail)
	r.Get("/statistics/session-reporting/resources", s.reportingResources)
	r.Get("/statistics/session-reporting/clients", s.reportingClients)
	r.Get("/statistics/session-reporting/clients/overview", s.reportingClientsOverview)
}

func rollbackStats(ctx context.Context, tx pgx.Tx, operation string) {
	if err := tx.Rollback(context.WithoutCancel(ctx)); err != nil && !errors.Is(err, pgx.ErrTxClosed) {
		slog.ErrorContext(ctx, "回滚统计查询事务失败", "operation", operation, "error", err)
	}
}

func (s *Service) read(query func(context.Context, pgx.Tx, window) (resource.Object, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		period, err := period(r, s.now().UTC())
		if err != nil {
			resource.Fail(w, err)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		defer cancel()
		tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
		if err != nil {
			resource.Fail(w, err)
			return
		}
		defer func() { rollbackStats(ctx, tx, "read") }()
		out, err := query(ctx, tx, period)
		if err != nil {
			resource.Fail(w, err)
			return
		}
		out["from"], out["until"] = period.from, period.until
		w.Header().Set("Cache-Control", "private, no-store")
		resource.JSON(w, http.StatusOK, out)
	}
}
