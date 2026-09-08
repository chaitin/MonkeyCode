package stats

import (
	"context"
	"net/http"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	pool *pgxpool.Pool
	now  func() time.Time
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool, now: time.Now}
}

type window struct {
	from, until time.Time
	step        time.Duration
	model       string
}

func period(r *http.Request, now time.Time, realtime bool) (window, error) {
	ranges := map[string]time.Duration{"24h": 24 * time.Hour, "7d": 7 * 24 * time.Hour, "30d": 30 * 24 * time.Hour, "90d": 90 * 24 * time.Hour}
	value := r.URL.Query().Get("range")
	if realtime {
		ranges = map[string]time.Duration{"5m": 5 * time.Minute, "15m": 15 * time.Minute, "30m": 30 * time.Minute, "60m": time.Hour}
		if value == "" {
			value = "15m"
		}
	} else if value == "" {
		value = "30d"
	}
	duration, ok := ranges[value]
	if !ok {
		return window{}, resource.Invalid("统计周期无效")
	}
	w := window{from: now.Add(-duration), until: now, step: 24 * time.Hour, model: r.URL.Query().Get("model_id")}
	if duration <= 24*time.Hour {
		w.step = time.Hour
	}
	if w.model != "" {
		var id pgtype.UUID
		if err := id.Scan(w.model); err != nil || !id.Valid {
			return window{}, resource.Invalid("模型 ID 无效")
		}
	}
	return w, nil
}

func (s *Service) RegisterAdmin(r chi.Router) {
	r.Get("/statistics/realtime", s.read(true, realtime))
	r.Get("/statistics/models", s.read(false, models))
	r.Get("/statistics/tasks", s.read(false, tasks))
	r.Get("/statistics/history", s.history)
}

func (s *Service) read(live bool, query func(context.Context, pgx.Tx, window) (resource.Object, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		period, err := period(r, s.now().UTC(), live)
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
		defer tx.Rollback(context.WithoutCancel(ctx))
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
