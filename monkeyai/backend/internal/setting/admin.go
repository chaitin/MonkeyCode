package setting

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/go-chi/chi/v5"
)

func (s *Service) RegisterAdmin(router chi.Router) {
	router.Get("/settings", func(w http.ResponseWriter, r *http.Request) {
		records, err := s.AdminList(r.Context())
		if err != nil {
			slog.ErrorContext(r.Context(), "读取设置列表失败", "error", err)
			settingError(r.Context(), w, http.StatusInternalServerError, "读取设置失败")
			return
		}
		settingJSON(r.Context(), w, http.StatusOK, map[string]any{"settings": records})
	})
	router.Get("/settings/{key}", func(w http.ResponseWriter, r *http.Request) {
		record, err := s.AdminGet(r.Context(), chi.URLParam(r, "key"))
		if err != nil {
			status := http.StatusInternalServerError
			if errors.Is(err, ErrUnknownKey) || errors.Is(err, ErrNotFound) {
				status = http.StatusNotFound
			} else {
				slog.ErrorContext(r.Context(), "读取设置失败", "key", chi.URLParam(r, "key"), "error", err)
			}
			settingError(r.Context(), w, status, "设置不存在")
			return
		}
		settingJSON(r.Context(), w, http.StatusOK, record)
	})
	router.Put("/settings/{key}", s.putSetting)
	router.Post("/settings/email/test", s.testEmail)
}

func (s *Service) putSetting(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Value         json.RawMessage `json:"value"`
		SchemaVersion int             `json:"schema_version"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2<<20)).Decode(&input); err != nil {
		settingError(r.Context(), w, http.StatusBadRequest, "请求格式无效")
		return
	}
	user, _ := identity.UserFromContext(r.Context())
	record, err := s.Put(r.Context(), chi.URLParam(r, "key"), input.Value, input.SchemaVersion, user.ID)
	if err != nil {
		settingError(r.Context(), w, http.StatusBadRequest, err.Error())
		return
	}
	record.Value, err = redact(record.Key, record.Value)
	if err != nil {
		slog.ErrorContext(r.Context(), "设置响应脱敏失败", "key", record.Key, "error", err)
		settingError(r.Context(), w, http.StatusInternalServerError, "设置已保存，但响应脱敏失败")
		return
	}
	settingJSON(r.Context(), w, http.StatusOK, record)
}

func settingJSON(ctx context.Context, w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		slog.WarnContext(ctx, "写入设置响应失败", "error", err)
	}
}

func settingError(ctx context.Context, w http.ResponseWriter, status int, message string) {
	settingJSON(ctx, w, status, map[string]any{"error": map[string]string{"code": "setting_error", "message": message}})
}
