package model

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/rootgroup"
	"github.com/go-chi/chi/v5"
)

func (s *Service) RegisterAdmin(router chi.Router) {
	router.Get("/models", func(w http.ResponseWriter, r *http.Request) {
		ownership := r.URL.Query().Get("ownership_type")
		models, err := s.List(r.Context(), ownership)
		if err != nil {
			if ownership != "" && ownership != "system" && ownership != "user" {
				modelError(w, http.StatusBadRequest, err.Error())
			} else {
				slog.ErrorContext(r.Context(), "读取模型列表失败", "error", err)
				modelError(w, http.StatusInternalServerError, "读取模型列表失败")
			}
			return
		}
		for i := range models {
			models[i] = presentModel(models[i])
		}
		modelJSON(w, http.StatusOK, map[string]any{"models": models})
	})
	router.Get("/models/authorization-subjects", func(w http.ResponseWriter, r *http.Request) {
		subjects, err := s.Subjects(r.Context())
		if err != nil {
			slog.ErrorContext(r.Context(), "读取模型授权对象失败", "error", err)
			modelError(w, http.StatusInternalServerError, "读取授权对象失败")
			return
		}
		modelJSON(w, http.StatusOK, subjects)
	})
	router.Get("/models/image-capabilities", func(w http.ResponseWriter, r *http.Request) {
		cap, err := s.DescribeImage(Provider(r.URL.Query().Get("provider")), "")
		if err != nil {
			modelError(w, http.StatusBadRequest, err.Error())
			return
		}
		modelJSON(w, http.StatusOK, map[string]any{
			"operations": cap.Operations, "qualities": cap.Qualities,
			"aspect_ratios": cap.AspectRatios, "allowed_aspect_ratios": cap.AllowedAspectRatios,
			"max_images": cap.MaxImages, "max_reference_images": cap.MaxReferenceImages,
			"supports_reference_image": cap.SupportsReference, "supports_mask": cap.SupportsMask,
		})
	})
	router.Post("/models", s.createModel)
	router.Put("/models/{modelID}", s.updateModel)
	router.Patch("/models/{modelID}/enabled", s.setModelEnabled)
	router.Delete("/models/{modelID}", s.deleteModel)
}

func (s *Service) createModel(w http.ResponseWriter, r *http.Request) {
	var input SaveInput
	if err := decodeModelRequest(w, r, &input); err != nil {
		modelError(w, http.StatusBadRequest, "请求格式无效")
		return
	}
	user, _ := identity.UserFromContext(r.Context())
	item, err := s.Create(r.Context(), user.ID, input)
	if err != nil {
		modelError(w, http.StatusBadRequest, err.Error())
		return
	}
	modelJSON(w, http.StatusCreated, presentModel(item))
}

func (s *Service) updateModel(w http.ResponseWriter, r *http.Request) {
	var input SaveInput
	if err := decodeModelRequest(w, r, &input); err != nil {
		modelError(w, http.StatusBadRequest, "请求格式无效")
		return
	}
	user, _ := identity.UserFromContext(r.Context())
	item, err := s.Update(r.Context(), chi.URLParam(r, "modelID"), user.ID, input)
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, ErrNotFound) {
			status = http.StatusNotFound
		} else {
			slog.ErrorContext(r.Context(), "操作模型失败", "model_id", chi.URLParam(r, "modelID"), "error", err)
		}
		modelError(w, status, err.Error())
		return
	}
	modelJSON(w, http.StatusOK, presentModel(item))
}

func (s *Service) setModelEnabled(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Enabled *bool `json:"enabled"`
	}
	if err := decodeModelRequest(w, r, &input); err != nil || input.Enabled == nil {
		modelError(w, http.StatusBadRequest, "enabled 必须是布尔值")
		return
	}
	item, err := s.SetEnabled(r.Context(), chi.URLParam(r, "modelID"), *input.Enabled)
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, ErrNotFound) {
			status = http.StatusNotFound
		} else {
			slog.ErrorContext(r.Context(), "操作模型失败", "model_id", chi.URLParam(r, "modelID"), "error", err)
		}
		modelError(w, status, err.Error())
		return
	}
	modelJSON(w, http.StatusOK, presentModel(item))
}

func (s *Service) deleteModel(w http.ResponseWriter, r *http.Request) {
	if err := s.Delete(r.Context(), chi.URLParam(r, "modelID")); err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, ErrNotFound) {
			status = http.StatusNotFound
		} else {
			slog.ErrorContext(r.Context(), "操作模型失败", "model_id", chi.URLParam(r, "modelID"), "error", err)
		}
		modelError(w, status, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func presentModel(item Model) Model {
	if item.Authorization.AllUsers {
		item.Authorization.AllUsers = false
		item.Authorization.GroupIDs = []string{rootgroup.ID}
		item.Authorization.UserIDs = []string{}
	}
	return item
}

func decodeModelRequest(w http.ResponseWriter, r *http.Request, target any) error {
	return json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(target)
}

func modelJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		slog.Error("写入模型 HTTP 响应失败", "status", status, "error", err)
	}
}

func modelError(w http.ResponseWriter, status int, message string) {
	modelJSON(w, status, map[string]any{
		"error": map[string]string{"code": "model_error", "message": message},
	})
}
