package apikey

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
)

func (s *Service) RegisterAdmin(router chi.Router) {
	router.Get("/api-keys", func(w http.ResponseWriter, r *http.Request) {
		keys, err := s.AdminList(r.Context(), r.URL.Query().Get("user_id"))
		if err != nil {
			slog.ErrorContext(r.Context(), "读取管理员调用密钥列表失败", "error", err)
			keyError(w, http.StatusInternalServerError, "读取调用密钥失败")
			return
		}
		keyJSON(w, http.StatusOK, map[string]any{"api_keys": keys})
	})
	router.Delete("/api-keys/{keyID}", func(w http.ResponseWriter, r *http.Request) {
		if err := s.AdminRevoke(r.Context(), chi.URLParam(r, "keyID")); err != nil {
			status := http.StatusInternalServerError
			if errors.Is(err, ErrNotFound) {
				status = http.StatusNotFound
			} else {
				slog.ErrorContext(r.Context(), "撤销调用密钥失败", "key_id", chi.URLParam(r, "keyID"), "error", err)
			}
			keyError(w, status, "调用密钥不存在")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}
