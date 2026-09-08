package identity

import (
	"context"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity/sqlc"
)

type UserSummary struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
}

func (s *Service) searchUsers(w http.ResponseWriter, r *http.Request) {
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	limit := 20
	var err error
	if raw := r.URL.Query().Get("limit"); raw != "" {
		limit, err = strconv.Atoi(raw)
	}
	if err != nil || limit < 1 || limit > 100 || query == "" || len(query) > 200 {
		writeError(w, http.StatusBadRequest, "invalid_request", "q 必须为 1—200 字节，limit 必须为 1—100")
		return
	}
	user, _ := UserFromContext(r.Context())
	users, err := s.SearchUsers(r.Context(), user.ID, query, limit)
	if err != nil {
		slog.Error("查找用户失败", "error", err)
		writeError(w, http.StatusInternalServerError, "server_error", "查找用户失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": users})
}

func (s *Service) SearchUsers(ctx context.Context, actor, query string, limit int) ([]UserSummary, error) {
	rows, err := sqlc.New(s.db).SearchUsers(ctx, sqlc.SearchUsersParams{ID: actor, Lower: query, Limit: int32(limit)})
	if err != nil {
		return nil, err
	}

	users := []UserSummary{}
	for _, row := range rows {
		var user UserSummary
		user.ID, user.Name, user.Email = row.ID, row.Name, row.Email
		users = append(users, user)
	}
	return users, nil
}
