package model

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"
	"log/slog"
	"net/http"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/rootgroup"
	"github.com/go-chi/chi/v5"
)

func (s *Service) RegisterAdmin(router chi.Router) {
	router.Get("/models", s.listModels)
	router.Get("/models/authorization-subjects", func(w http.ResponseWriter, r *http.Request) {
		subjects, err := s.Subjects(r.Context())
		if err != nil {
			logging.Event(r.Context(), slog.Default(), slog.LevelError, "model.operation.error", "读取模型授权对象失败", "module", "model", "operation", "RegisterAdmin", "error", err)
			modelError(w, http.StatusInternalServerError, "读取授权对象失败")
			return
		}
		modelJSON(w, http.StatusOK, subjects)
	})
	router.Get("/models/video-capabilities", func(w http.ResponseWriter, r *http.Request) {
		cap, err := VideoCapabilitiesFor(Provider(r.URL.Query().Get("provider")), r.URL.Query().Get("model_id"))
		if err != nil {
			modelError(w, http.StatusBadRequest, err.Error())
			return
		}
		modelJSON(w, http.StatusOK, cap)
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
			logging.Event(r.Context(), slog.Default(), slog.LevelError, "model.operation.error", "操作模型失败", "module", "model", "operation", "updateModel", "model_id", chi.URLParam(r, "modelID"), "error", err)
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
			logging.Event(r.Context(), slog.Default(), slog.LevelError, "model.operation.error", "操作模型失败", "module", "model", "operation", "setModelEnabled", "model_id", chi.URLParam(r, "modelID"), "error", err)
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
			logging.Event(r.Context(), slog.Default(), slog.LevelError, "model.operation.error", "操作模型失败", "module", "model", "operation", "deleteModel", "model_id", chi.URLParam(r, "modelID"), "error", err)
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
		logging.Event(context.Background(), slog.Default(), slog.LevelError, "model.operation.error", "写入模型 HTTP 响应失败", "module", "model", "operation", "modelJSON", "status", status, "error", err)
	}
}

func modelError(w http.ResponseWriter, status int, message string) {
	modelJSON(w, status, map[string]any{
		"error": map[string]string{"code": "model_error", "message": message},
	})
}
