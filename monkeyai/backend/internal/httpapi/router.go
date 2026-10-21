package httpapi

import (
	"context"
	"io"
	"log/slog"
	"net/http"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"
	"github.com/go-chi/chi/v5"
)

type Pinger interface{ Ping(context.Context) error }

func New(logger *slog.Logger, database Pinger, admin, agent, auth http.Handler) http.Handler {
	router := chi.NewRouter()
	write := func(w http.ResponseWriter, r *http.Request, body string) {
		if _, err := io.WriteString(w, body); err != nil && r.Context().Err() == nil {
			logging.Diagnostic(r.Context(), logger, slog.LevelWarn, "http.response.failed", err)
		}
	}
	router.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		write(w, r, "{\"status\":\"ok\"}\n")
	})
	router.Get("/readyz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		if err := database.Ping(r.Context()); err != nil {
			attrs := logging.ErrorAttrs(err)
			stopping := false
			for _, a := range attrs {
				if a.Key == "dependency" && a.Value.String() == "endpoint" {
					stopping = true
				}
			}
			if stopping {
				logging.Expected(r.Context())
			} else {
				logging.Diagnostic(r.Context(), logger, slog.LevelError, "readiness.failed", err)
			}
			w.WriteHeader(http.StatusServiceUnavailable)
			write(w, r, "{\"status\":\"unavailable\"}\n")
			return
		}
		write(w, r, "{\"status\":\"ok\"}\n")
	})
	router.Mount("/api/admin/v1", admin)
	router.Mount("/api/v1", agent)
	router.Mount("/api/auth/v1", auth)
	return router
}
