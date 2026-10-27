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
	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"
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
		if err != nil {
			slog.WarnContext(r.Context(), "操作失败", "module", "identity", "operation", "BrowserUser", "error", err)
		}
		return User{}, false
	}
	user, _, err := s.userByBrowserToken(r.Context(), tokenHash(cookie.Value))
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		logging.Event(r.Context(), slog.Default(), slog.LevelError, "identity.request.failed", "查询浏览器会话失败", "module", "identity", "operation", "BrowserUser", "error", err)
	}
	return user, err == nil
}

func (s *Service) RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(sessionCookie)
		if err != nil || cookie.Value == "" {
			if err != nil {
				slog.Warn("操作失败", "module", "identity", "operation", "RequireAdmin", "error", err)
			}
			writeError(r.Context(), w, http.StatusUnauthorized, "unauthorized", "请先登录")
			return
		}
		user, _, err := s.userByBrowserToken(r.Context(), tokenHash(cookie.Value))
		if err != nil {
			if !errors.Is(err, pgx.ErrNoRows) {
				logging.Event(r.Context(), slog.Default(), slog.LevelError, "identity.request.failed", "查询管理员会话失败", "module", "identity", "operation", "RequireAdmin", "error", err)
			}
			writeError(r.Context(), w, http.StatusUnauthorized, "unauthorized", "请先登录")
			return
		}
		if user.Role != "admin" {
			writeError(r.Context(), w, http.StatusForbidden, "forbidden", "需要管理员权限")
			return
		}
		logging.Bind(r.Context(), slog.String("user_id", user.ID))
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userContextKey{}, user)))
	})
}

func (s *Service) RequireBrowser(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, ok := s.BrowserUser(r)
		if !ok {
			writeError(r.Context(), w, http.StatusUnauthorized, "unauthorized", "请先登录")
			return
		}
		logging.Bind(r.Context(), slog.String("user_id", user.ID))
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userContextKey{}, user)))
	})
}

func (s *Service) RequireAgent(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authorization := strings.TrimSpace(r.Header.Get("Authorization"))
		if len(authorization) < 8 || !strings.EqualFold(authorization[:7], "Bearer ") {
			writeError(r.Context(), w, http.StatusUnauthorized, "invalid_token", "缺少 Bearer access token")
			return
		}
		reference := tokenHash(strings.TrimSpace(authorization[7:]))
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		startedAt := time.Now()
		row, err := sqlc.New(s.db).GetTokenUser(ctx, reference)
		duration := time.Since(startedAt)
		cancel()
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(r.Context(), w, http.StatusUnauthorized, "invalid_token", "access token 无效或已过期")
			return
		}
		if err != nil {
			stats := s.db.Stat()
			logging.Event(r.Context(), slog.Default(), slog.LevelError, "identity.request.failed", "Agent 认证查询失败", "module", "identity", "operation", "RequireAgent", "request_id", logging.RequestID(r.Context()), "method", r.Method, "path", r.URL.Path, "duration", duration, "error", err, "db_pool_acquired_conns", stats.AcquiredConns(), "db_pool_idle_conns", stats.IdleConns(), "db_pool_total_conns", stats.TotalConns(), "db_pool_max_conns", stats.MaxConns(), "db_pool_empty_acquire_count", stats.EmptyAcquireCount(), "db_pool_canceled_acquire_count", stats.CanceledAcquireCount())
			writeError(r.Context(), w, http.StatusServiceUnavailable, "service_unavailable", "认证服务暂不可用")
			return
		}
		user := User{ID: row.ID, Name: row.Name, Email: row.Email, AvatarURL: row.AvatarUrl, Role: row.Role, Status: row.Status, JoinedAt: row.JoinedAt, LastLoginAt: row.LastLoginAt}
		logging.Bind(r.Context(), slog.String("user_id", row.ID))
		ctx = context.WithValue(r.Context(), userContextKey{}, user)
		ctx = context.WithValue(ctx, credentialKey{}, AccessCredential{UserID: row.ID, Reference: reference, ExpiresAt: row.AccessExpiresAt})
		p := Principal{UserID: row.ID, ClientID: row.ClientID, GrantID: row.GrantID, Scopes: row.Scopes,
			Audience: row.Audience, Purpose: row.Purpose, RevocationVersion: row.RevocationVersion}
		if row.MachineID != nil {
			p.MachineID = *row.MachineID
		}
		if row.KeyID != nil {
			p.KeyID = *row.KeyID
		}
		ctx = context.WithValue(ctx, principalKey{}, p)
		if p.Purpose == "runtime" && !runtimeRoute(p, r.Method, r.URL.Path) {
			writeError(r.Context(), w, 403, "permission_denied", "独立执行授权只能访问本机执行接口")
			return
		}
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func runtimeRoute(p Principal, method, path string) bool {
	path = strings.TrimPrefix(path, "/api/v1")
	if method == "GET" && (path == "/me" || path == "/settings" || path == "/endpoint-bridge") {
		return true
	}
	if strings.HasPrefix(path, "/api-keys") {
		return p.MachineID != "" && p.Has("device:publish")
	}
	if method == "PUT" && path == "/endpoints/"+p.MachineID && p.MachineID != "" {
		return true
	}
	if (method == "PUT" || method == "POST") && strings.HasPrefix(path, "/sessions/") {
		return p.Has("session:report")
	}
	if method == "POST" && path == "/resources/resolve" {
		return true
	}
	if method == "GET" {
		for _, prefix := range []string{"/models", "/rules", "/skills", "/experts", "/connectors"} {
			if path == prefix || strings.HasPrefix(path, prefix+"/") {
				return true
			}
		}
	}
	return false
}

func writeJSON(ctx context.Context, w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		if ctx.Err() == nil {
			logging.Diagnostic(ctx, slog.Default(), slog.LevelWarn, "http.response.failed", err, slog.Int("status", status))
		}
	}
}

func writeError(ctx context.Context, w http.ResponseWriter, status int, code, message string) {
	if status < 500 {
		logging.Expected(ctx)
	}
	writeJSON(ctx, w, status, map[string]any{
		"error": map[string]string{"code": code, "message": message},
	})
}
