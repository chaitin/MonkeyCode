package model

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/database"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/model/sqlc"
)

type ListFilter struct {
	Ownership string `json:"ownership"`
	Search    string `json:"search"`
	Cursor    string `json:"cursor"`
	Limit     int    `json:"limit"`
}

func (s *Service) Page(ctx context.Context, filter ListFilter) ([]Model, string, error) {
	if filter.Ownership != "" && filter.Ownership != "system" && filter.Ownership != "user" {
		return nil, "", errors.New("ownership_type 无效")
	}
	if filter.Limit < 1 || filter.Limit > 200 {
		return nil, "", errors.New("limit 必须在 1—200 之间")
	}
	limit := filter.Limit
	filter.Limit++
	items, err := s.repository.Page(ctx, filter)
	if err != nil {
		return nil, "", err
	}
	cursor := ""
	if len(items) > limit {
		items = items[:limit]
		cursor = items[len(items)-1].ID
	}
	return items, cursor, nil
}

func (p *Postgres) Page(ctx context.Context, filter ListFilter) ([]Model, error) {
	data, err := json.Marshal(filter)
	if err != nil {
		return nil, err
	}
	rows, err := sqlc.New(database.Reader(ctx, p.pool)).PageModels(ctx, data)
	if err != nil {
		return nil, err
	}
	items, err := readModels(rows)
	if err != nil {
		return nil, err
	}
	if err := p.loadGrants(ctx, items); err != nil {
		return nil, err
	}
	if err := p.loadTags(ctx, items); err != nil {
		return nil, err
	}
	return items, nil
}

func (s *Service) listModels(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	ownership := query.Get("ownership_type")
	if ownership != "" && ownership != "system" && ownership != "user" {
		modelError(w, http.StatusBadRequest, "ownership_type 无效")
		return
	}
	var items []Model
	var next string
	var err error
	if query.Has("limit") || query.Has("cursor") || query.Has("q") {
		limit := 200
		if raw := query.Get("limit"); raw != "" {
			limit, err = strconv.Atoi(raw)
			if err != nil || limit < 1 || limit > 200 {
				modelError(w, http.StatusBadRequest, "limit 必须在 1—200 之间")
				return
			}
		}
		items, next, err = s.Page(r.Context(), ListFilter{Ownership: ownership, Search: query.Get("q"), Cursor: query.Get("cursor"), Limit: limit})
	} else {
		items, err = s.List(r.Context(), ownership)
	}
	if err != nil {
		slog.ErrorContext(r.Context(), "读取模型列表失败", "error", err)
		modelError(w, http.StatusInternalServerError, "读取模型列表失败")
		return
	}
	for i := range items {
		items[i] = presentModel(items[i])
	}
	modelJSON(w, http.StatusOK, map[string]any{"models": items, "next_cursor": next})
}
