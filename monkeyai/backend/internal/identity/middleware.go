package identity

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity/sqlc"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5"
)

type userContextKey struct{}

func UserFromContext(ctx context.Context) (User, bool) {
	user, ok := ctx.Value(userContextKey{}).(User)
	return user, ok
}

func (s *Service) BrowserUser(r *http.Request) (User, bool) {
	cookie, err := r.Cookie(sessionCookie)
	if err != nil || cookie.Value == "" {
		return User{}, false
	}
	user, _, err := s.userByBrowserToken(r.Context(), tokenHash(cookie.Value))
	return user, err == nil
}

func (s *Service) RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(sessionCookie)
		if err != nil || cookie.Value == "" {
			writeError(w, http.StatusUnauthorized, "unauthorized", "请先登录")
			return
		}
		user, _, err := s.userByBrowserToken(r.Context(), tokenHash(cookie.Value))
		if err != nil {
			writeError(w, http.StatusUnauthorized, "unauthorized", "请先登录")
			return
		}
		if user.Role != "admin" {
			writeError(w, http.StatusForbidden, "forbidden", "需要管理员权限")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userContextKey{}, user)))
	})
}

func (s *Service) RequireBrowser(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, ok := s.BrowserUser(r)
		if !ok {
			writeError(w, http.StatusUnauthorized, "unauthorized", "请先登录")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userContextKey{}, user)))
	})
}

func (s *Service) RequireAgent(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authorization := strings.TrimSpace(r.Header.Get("Authorization"))
		if len(authorization) < 8 || !strings.EqualFold(authorization[:7], "Bearer ") {
			writeError(w, http.StatusUnauthorized, "invalid_token", "缺少 Bearer access token")
			return
		}
		reference := tokenHash(strings.TrimSpace(authorization[7:]))
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		startedAt := time.Now()
		row, err := sqlc.New(s.db).GetTokenUser(ctx, reference)
		duration := time.Since(startedAt)
		cancel()
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusUnauthorized, "invalid_token", "access token 无效或已过期")
			return
		}
		if err != nil {
			stats := s.db.Stat()
			slog.ErrorContext(r.Context(), "Agent 认证查询失败",
				"request_id", middleware.GetReqID(r.Context()),
				"method", r.Method,
				"path", r.URL.Path,
				"duration", duration,
				"error", err,
				"db_pool_acquired_conns", stats.AcquiredConns(),
				"db_pool_idle_conns", stats.IdleConns(),
				"db_pool_total_conns", stats.TotalConns(),
				"db_pool_max_conns", stats.MaxConns(),
				"db_pool_empty_acquire_count", stats.EmptyAcquireCount(),
				"db_pool_canceled_acquire_count", stats.CanceledAcquireCount(),
			)
			writeError(w, http.StatusServiceUnavailable, "service_unavailable", "认证服务暂不可用")
			return
		}
		user := User{ID: row.ID, Name: row.Name, Email: row.Email, AvatarURL: row.AvatarUrl, Role: row.Role, Status: row.Status, JoinedAt: row.JoinedAt, LastLoginAt: row.LastLoginAt}
		ctx = context.WithValue(r.Context(), userContextKey{}, user)
		ctx = context.WithValue(ctx, credentialKey{}, AccessCredential{UserID: row.ID, Reference: reference, ExpiresAt: row.AccessExpiresAt})
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{
		"error": map[string]string{"code": code, "message": message},
	})
}
