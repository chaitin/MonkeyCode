package httpapi

import (
	"context"
	"io"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

type Pinger interface {
	Ping(context.Context) error
}

func New(logger *slog.Logger, database Pinger, admin, agent, auth http.Handler) http.Handler {
	router := chi.NewRouter()
	router.Use(middleware.RequestID)
	router.Use(middleware.Recoverer)

	router.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		if _, err := io.WriteString(w, "{\"status\":\"ok\"}\n"); err != nil {
			logger.ErrorContext(r.Context(), "健康检查响应写入失败", "request_id", middleware.GetReqID(r.Context()), "error", err)
		}
	})
	router.Get("/readyz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		if err := database.Ping(r.Context()); err != nil {
			logger.ErrorContext(r.Context(), "数据库就绪检查失败", "request_id", middleware.GetReqID(r.Context()), "error", err)
			w.WriteHeader(http.StatusServiceUnavailable)
			if _, writeErr := io.WriteString(w, "{\"status\":\"unavailable\"}\n"); writeErr != nil {
				logger.ErrorContext(r.Context(), "就绪检查响应写入失败", "request_id", middleware.GetReqID(r.Context()), "error", writeErr)
			}
			return
		}
		if _, err := io.WriteString(w, "{\"status\":\"ok\"}\n"); err != nil {
			logger.ErrorContext(r.Context(), "就绪检查响应写入失败", "request_id", middleware.GetReqID(r.Context()), "error", err)
		}
	})

	router.Mount("/api/admin/v1", admin)
	router.Mount("/api/v1", agent)
	router.Mount("/api/auth/v1", auth)

	return router
}
