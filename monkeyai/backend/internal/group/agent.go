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
		if err != nil || limit < 1 || limit > 100 || query == "" || len(query) > 200 {
			resource.Fail(w, resource.Invalid("q 必须为 1—200 字节，limit 必须为 1—100"))
			return
		}
		groups, err := s.Search(r.Context(), query, limit)
		if err != nil {
			resource.Fail(w, err)
			return
		}
		resource.JSON(w, http.StatusOK, map[string]any{"groups": groups})
	})
}

func (s *Service) Search(ctx context.Context, query string, limit int) ([]GroupSummary, error) {
	rows, err := sqlc.New(s.pool).SearchGroups(ctx, sqlc.SearchGroupsParams{
		RootID: rootgroup.ID, NameQuery: query, ResultLimit: int32(limit),
	})
	if err != nil {
		return nil, err
	}
	groups := []GroupSummary{}
	for _, row := range rows {
		groups = append(groups, GroupSummary{ID: row.ID, Name: row.Name, ParentID: rootgroup.ParentID(row.ParentID)})
	}
	return groups, nil
}
