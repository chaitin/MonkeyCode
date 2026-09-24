package setting

import (
	"log/slog"
	"net/http"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/httpapi"
	"github.com/go-chi/chi/v5"
)

func (s *Service) RegisterAgent(router chi.Router) {
	router.Get("/settings", func(w http.ResponseWriter, r *http.Request) {
		config, err := s.AgentConfig(r.Context())
		if err == nil {
			err = httpapi.CachedJSON(w, r, map[string]any{"settings": config.Settings})
		}
		if err != nil {
			slog.ErrorContext(r.Context(), "读取 Agent 设置失败", "error", err)
			settingError(r.Context(), w, http.StatusInternalServerError, "读取设置失败")
		}
	})
}
