package billing

import (
	"net/http"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

func (s *Service) RegisterAgent(r chi.Router) {
	r.Get("/billing/account", func(w http.ResponseWriter, r *http.Request) {
		u, _ := identity.UserFromContext(r.Context())
		a, err := s.Account(r.Context(), u.ID)
		if err != nil {
			resource.Fail(w, err)
			return
		}
		resource.JSON(w, 200, a)
	})
	r.Get("/billing/entries", s.agentEntries)
}

func (s *Service) agentEntries(w http.ResponseWriter, r *http.Request) {
	filter, err := filters(r)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	if filter.EntryType != "" && filter.EntryType != "charge" && filter.EntryType != "refund" {
		resource.Fail(w, resource.Invalid("消耗历史仅支持扣费和退款类型"))
		return
	}
	ctx := r.Context()
	user, _ := identity.UserFromContext(ctx)
	page, size := pageParams(r)
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		resource.Fail(w, err)
		return
	}
	defer rollback(ctx, tx, "list_user_entries", "")
	queries := sqlc.New(tx)
	total, err := queries.CountUserEntries(ctx, sqlc.CountUserEntriesParams{
		UserID:       user.ID,
		ContentQuery: filter.ContentQuery,
		Category:     filter.Category,
		Mode:         filter.Mode,
		EntryType:    filter.EntryType,
		FromTime:     filter.FromTime,
		UntilTime:    filter.UntilTime,
	})
	if err != nil {
		resource.Fail(w, err)
		return
	}
	items, err := resource.DecodeObjects(queries.ListUserEntries(ctx, sqlc.ListUserEntriesParams{
		UserID:       user.ID,
		ContentQuery: filter.ContentQuery,
		Category:     filter.Category,
		Mode:         filter.Mode,
		EntryType:    filter.EntryType,
		FromTime:     filter.FromTime,
		UntilTime:    filter.UntilTime,
		Limit:        int32(size),
		Offset:       int32((page - 1) * size),
	}))
	if err != nil {
		resource.Fail(w, err)
		return
	}
	resource.JSON(w, 200, map[string]any{"items": items, "total": total, "page": page, "page_size": size})
}
