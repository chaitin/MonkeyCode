package group

import (
	"context"
	"net/http"
	"strconv"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/group/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/rootgroup"
	"github.com/go-chi/chi/v5"
)

type GroupSummary struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	ParentID *string `json:"parent_id"`
}

func (s *Service) RegisterAgent(router chi.Router) {
	router.Get("/groups", func(w http.ResponseWriter, r *http.Request) {
		query := strings.TrimSpace(r.URL.Query().Get("q"))
		limit := 20
		var err error
		if raw := r.URL.Query().Get("limit"); raw != "" {
			limit, err = strconv.Atoi(raw)
		}
		if err != nil || limit < 1 || limit > 100 {
			resource.Fail(r.Context(), w, resource.Invalid("limit 必须为 1—100"))
			return
		}
		var groups []GroupSummary
		if query == "" {
			groups, err = s.ListSummaries(r.Context())
		} else {
			groups, err = s.Search(r.Context(), query, limit)
		}
		if err != nil {
			resource.Fail(r.Context(), w, err)
			return
		}
		resource.JSON(r.Context(), w, http.StatusOK, map[string]any{"groups": groups})
	})
}

func (s *Service) ListSummaries(ctx context.Context) ([]GroupSummary, error) {
	name, err := rootgroup.Name(ctx, s.pool)
	if err != nil {
		return nil, err
	}
	groups := []GroupSummary{{ID: rootgroup.ID, Name: name}}
	rows, err := sqlc.New(s.pool).ListGroupSummaries(ctx)
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		groups = append(groups, GroupSummary{ID: row.ID, Name: row.Name, ParentID: rootgroup.ParentID(row.ParentID)})
	}
	return groups, nil
}

func (s *Service) Search(ctx context.Context, query string, limit int) ([]GroupSummary, error) {
	name, err := rootgroup.Name(ctx, s.pool)
	if err != nil {
		return nil, err
	}
	groups := []GroupSummary{}
	if strings.Contains(strings.ToLower(name), strings.ToLower(query)) {
		groups = append(groups, GroupSummary{ID: rootgroup.ID, Name: name})
		limit--
	}
	if limit == 0 {
		return groups, nil
	}
	rows, err := sqlc.New(s.pool).SearchGroups(ctx, sqlc.SearchGroupsParams{
		RootID: rootgroup.ID, NameQuery: query, ResultLimit: int32(limit),
	})
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		groups = append(groups, GroupSummary{ID: row.ID, Name: row.Name, ParentID: rootgroup.ParentID(row.ParentID)})
	}
	return groups, nil
}
