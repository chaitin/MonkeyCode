package apikey

import (
	"errors"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
)

func (s *Service) RegisterAdmin(router chi.Router) {
	router.Get("/api-keys", func(w http.ResponseWriter, r *http.Request) {
		keys, err := s.AdminList(r.Context(), r.URL.Query().Get("user_id"))
		if err != nil {
			logging.Event(r.Context(), slog.Default(), slog.LevelError, "apikey.request.failed", "读取管理员调用密钥列表失败", "module", "apikey", "operation", "RegisterAdmin", "error", err)
			keyError(r.Context(), w, http.StatusInternalServerError, "读取调用密钥失败")
			return
		}
		keyJSON(r.Context(), w, http.StatusOK, map[string]any{"api_keys": keys})
	})
	router.Delete("/api-keys/{keyID}", func(w http.ResponseWriter, r *http.Request) {
		if err := s.AdminRevoke(r.Context(), chi.URLParam(r, "keyID")); err != nil {
			status := http.StatusInternalServerError
			if errors.Is(err, ErrNotFound) {
				status = http.StatusNotFound
			} else {
				logging.Event(r.Context(), slog.Default(), slog.LevelError, "apikey.request.failed", "撤销调用密钥失败", "module", "apikey", "operation", "RegisterAdmin", "key_id", chi.URLParam(r, "keyID"), "error", err)
			}
			keyError(r.Context(), w, status, "调用密钥不存在")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}
