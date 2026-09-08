package audit

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/audit/sqlc"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	pool   *pgxpool.Pool
	logger *slog.Logger
}

func NewService(pool *pgxpool.Pool, logger *slog.Logger) *Service {
	return &Service{pool: pool, logger: logger}
}

type Actor struct{ ID, Name, Email string }

type Event struct {
	ActorID, Action, Category, TargetType, TargetID string
	Params                                          any
}

// Write 与业务使用同一事务；没有 HTTP 上下文时仍可记录独立业务事件。
func Write(ctx context.Context, db sqlc.DBTX, event Event) error {
	data, err := params(event.Params)
	if err != nil {
		return err
	}
	in := sqlc.CreateParams{
		ActorUserID: optional(event.ActorID), Action: event.Action, Category: event.Category,
		TargetType: optional(event.TargetType), TargetID: uuid(event.TargetID),
		RequestParams: data, Result: "success", OccurredAt: time.Now().UTC(),
	}
	state, _ := ctx.Value(requestKey{}).(*requestState)
	if state != nil && state.actor.ID == event.ActorID {
		in.ActorName, in.ActorEmail = state.actor.Name, optional(state.actor.Email)
		in.RequestID, in.SourceIp, in.UserAgent = new(state.id), state.ip, optional(state.agent)
		in.OccurredAt = state.at
	} else {
		actor, err := sqlc.New(db).Actor(ctx, event.ActorID)
		if err != nil {
			return err
		}
		in.ActorName, in.ActorEmail = actor.Name, optional(actor.Email)
	}
	return sqlc.New(db).Create(ctx, in)
}

func optional(value string) *string {
	if value == "" {
		return nil
	}
	return new(value)
}

func uuid(value string) *string {
	var id pgtype.UUID
	if err := id.Scan(value); err != nil || !id.Valid {
		return nil
	}
	return new(value)
}

func (s *Service) RegisterAdmin(router chi.Router) {
	router.Get("/audits", s.list)
}

func filters(r *http.Request) (sqlc.PageParams, int, error) {
	q := r.URL.Query()
	in := sqlc.PageParams{Category: q.Get("category"), Result: q.Get("result"), Actor: strings.TrimSpace(q.Get("actor")), Ip: strings.TrimSpace(q.Get("ip")), Params: strings.TrimSpace(q.Get("params"))}
	invalid := errors.New("审计筛选参数无效")
	if !slices.Contains([]string{"", "model", "identity", "security", "settings", "resource", "billing"}, in.Category) || !slices.Contains([]string{"", "success", "failed"}, in.Result) {
		return in, 0, invalid
	}
	for _, value := range []string{in.Actor, in.Ip, in.Params} {
		if len(value) > 512 || strings.ContainsRune(value, 0) {
			return in, 0, invalid
		}
	}
	page, size := 1, 20
	var err error
	if q.Has("page") {
		page, err = strconv.Atoi(q.Get("page"))
		if err != nil || page < 1 || page > 1000000 {
			return in, 0, invalid
		}
	}
	if q.Has("page_size") {
		size, err = strconv.Atoi(q.Get("page_size"))
		if err != nil || size < 1 || size > 500 {
			return in, 0, invalid
		}
	}
	in.PageSize, in.PageOffset = int32(size), int32((page-1)*size)
	for key, target := range map[string]**time.Time{"since": &in.Since, "until": &in.Until} {
		if q.Has(key) {
			at, err := time.Parse(time.RFC3339, q.Get(key))
			if err != nil {
				return in, 0, invalid
			}
			*target = &at
		}
	}
	if in.Since != nil && in.Until != nil && !in.Since.Before(*in.Until) {
		return in, 0, invalid
	}
	return in, page, nil
}

func (s *Service) list(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	in, page, err := filters(r)
	if err != nil {
		failure(w, 400, "invalid_request", err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	data, err := sqlc.New(s.pool).Page(ctx, in)
	if err != nil {
		failure(w, 500, "server_error", "读取操作审计失败")
		return
	}
	var out struct {
		Items    []map[string]any `json:"items"`
		Total    int64            `json:"total"`
		Page     int              `json:"page"`
		PageSize int32            `json:"page_size"`
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	if err = decoder.Decode(&out); err != nil {
		failure(w, 500, "server_error", "读取操作审计失败")
		return
	}
	for _, item := range out.Items {
		item["request_params"] = sanitize(item["request_params"], 0)
	}
	out.Page, out.PageSize = page, in.PageSize
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(out)
}

func failure(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": code, "message": message}})
}
