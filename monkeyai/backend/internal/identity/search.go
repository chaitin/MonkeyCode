package identity

import (
	"context"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
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
	rows, err := s.db.Query(ctx, `SELECT id,name,email FROM users
 WHERE status='active' AND deleted_at IS NULL AND id<>$1
 AND (strpos(lower(name),lower($2))>0 OR strpos(lower(email),lower($2))>0)
 ORDER BY lower(name),id LIMIT $3`, actor, query, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	users := []UserSummary{}
	for rows.Next() {
		var user UserSummary
		if err := rows.Scan(&user.ID, &user.Name, &user.Email); err != nil {
			return nil, err
		}
		users = append(users, user)
	}
	return users, rows.Err()
}
