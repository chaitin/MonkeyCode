package apikey

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/go-chi/chi/v5"
)

func (s *Service) RegisterAgent(router chi.Router) {
	router.Get("/api-keys", func(w http.ResponseWriter, r *http.Request) {
		user, _ := identity.UserFromContext(r.Context())
		keys, err := s.ListByUser(r.Context(), user.ID)
		if err != nil {
			logging.Event(r.Context(), slog.Default(), slog.LevelError, "apikey.request.failed", "读取用户调用密钥失败", "module", "apikey", "operation", "RegisterAgent", "user_id", user.ID, "error", err)
			keyError(r.Context(), w, http.StatusInternalServerError, "读取调用密钥失败")
			return
		}
		keyJSON(r.Context(), w, http.StatusOK, map[string]any{"api_keys": keys})
	})
	router.Post("/api-keys", s.create)
	router.Delete("/api-keys/{keyID}", s.revoke)
	router.Post("/api-keys/{keyID}/rotate", s.rotate)
}

func (s *Service) create(w http.ResponseWriter, r *http.Request) {
	var input CreateInput
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		slog.WarnContext(r.Context(), "操作失败", "module", "apikey", "operation", "create", "error", err)
		keyError(r.Context(), w, http.StatusBadRequest, "请求格式无效")
		return
	}
	user, _ := identity.UserFromContext(r.Context())
	key, err := s.Create(r.Context(), user.ID, input)
	if err != nil {
		keyError(r.Context(), w, http.StatusBadRequest, err.Error())
		return
	}
	keyJSON(r.Context(), w, http.StatusCreated, key)
}

func (s *Service) revoke(w http.ResponseWriter, r *http.Request) {
	user, _ := identity.UserFromContext(r.Context())
	if err := s.Revoke(r.Context(), user.ID, chi.URLParam(r, "keyID")); err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, ErrNotFound) {
			status = http.StatusNotFound
		} else {
			logging.Event(r.Context(), slog.Default(), slog.LevelError, "apikey.request.failed", "操作用户调用密钥失败", "module", "apikey", "operation", "revoke", "key_id", chi.URLParam(r, "keyID"), "user_id", user.ID, "error", err)
		}
		keyError(r.Context(), w, status, "调用密钥不存在")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Service) rotate(w http.ResponseWriter, r *http.Request) {
	user, _ := identity.UserFromContext(r.Context())
	key, err := s.Rotate(r.Context(), user.ID, chi.URLParam(r, "keyID"))
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, ErrNotFound) {
			status = http.StatusNotFound
		} else {
			logging.Event(r.Context(), slog.Default(), slog.LevelError, "apikey.request.failed", "操作用户调用密钥失败", "module", "apikey", "operation", "rotate", "key_id", chi.URLParam(r, "keyID"), "user_id", user.ID, "error", err)
		}
		keyError(r.Context(), w, status, "轮换调用密钥失败")
		return
	}
	keyJSON(r.Context(), w, http.StatusCreated, key)
}

func keyJSON(ctx context.Context, w http.ResponseWriter, status int, value any) {
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		logging.Event(ctx, slog.Default(), slog.LevelError, "apikey.request.failed", "写入调用密钥 HTTP 响应失败", "module", "apikey", "operation", "keyJSON", "status", status, "error", err)
	}
}

func keyError(ctx context.Context, w http.ResponseWriter, status int, message string) {
	keyJSON(ctx, w, status, map[string]any{
		"error": map[string]string{"code": "api_key_error", "message": message},
	})
}
