package model

import (
	"context"
	"errors"
	"net/http"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

func (s *Service) CreateUser(ctx context.Context, userID string, input UserInput) (Model, error) {
	item, err := userModelFromInput(input)
	if err != nil {
		return Model{}, err
	}
	if item.APIKey == "" {
		return Model{}, resource.Invalid("api_key 不能为空")
	}
	item.OwnershipType = "user"
	item.OwnerUserID = userID
	item.Enabled = true
	return s.repository.Create(ctx, item)
}

func (s *Service) GetUser(ctx context.Context, id, userID string) (Model, error) {
	item, err := s.repository.Get(ctx, id)
	if err != nil {
		return Model{}, err
	}
	if item.OwnershipType != "user" || item.OwnerUserID != userID {
		return Model{}, ErrNotFound
	}
	return item, nil
}

func (s *Service) UpdateUser(ctx context.Context, id, userID string, input UserInput) (Model, error) {
	existing, err := s.GetUser(ctx, id, userID)
	if err != nil {
		return Model{}, err
	}
	item, err := userModelFromInput(input)
	if err != nil {
		return Model{}, err
	}
	item.ID = id
	item.OwnershipType = "user"
	item.OwnerUserID = userID
	item.Enabled = existing.Enabled
	item.Authorization = existing.Authorization
	item.CreditMultiplier = existing.CreditMultiplier
	if item.APIKey == "" {
		item.APIKey = existing.APIKey
	}
	return s.repository.UpdateUser(ctx, item)
}

func userModelFromInput(input UserInput) (Model, error) {
	item, err := modelFromInput(SaveInput{
		ModelID: input.ModelID, DisplayName: input.DisplayName, Protocol: input.Protocol,
		BaseURL: input.BaseURL, APIKey: input.APIKey, AdvancedConfig: input.AdvancedConfig,
		CreditMultiplier: 1,
	})
	if err != nil {
		return Model{}, resource.Invalid(err.Error())
	}
	return item, nil
}

func (s *Service) RegisterAgent(router chi.Router) {
	router.Get("/models", func(w http.ResponseWriter, r *http.Request) {
		user, _ := identity.UserFromContext(r.Context())
		items, err := s.AgentModels(r.Context(), user.ID, user.Role == "admin")
		if err != nil {
			userModelError(w, err)
			return
		}
		modelJSON(w, http.StatusOK, map[string]any{"models": items})
	})
	router.Get("/models/{modelID}", func(w http.ResponseWriter, r *http.Request) {
		user, _ := identity.UserFromContext(r.Context())
		item, err := s.GetUser(r.Context(), chi.URLParam(r, "modelID"), user.ID)
		if err != nil {
			userModelError(w, err)
			return
		}
		modelJSON(w, http.StatusOK, item)
	})
	save := func(w http.ResponseWriter, r *http.Request) {
		var input UserInput
		if err := resource.Decode(w, r, &input); err != nil {
			userModelError(w, err)
			return
		}
		user, _ := identity.UserFromContext(r.Context())
		var item Model
		var err error
		status := http.StatusOK
		if r.Method == http.MethodPost {
			item, err = s.CreateUser(r.Context(), user.ID, input)
			status = http.StatusCreated
		} else {
			item, err = s.UpdateUser(r.Context(), chi.URLParam(r, "modelID"), user.ID, input)
		}
		if err != nil {
			userModelError(w, err)
			return
		}
		modelJSON(w, status, item)
	}
	router.Post("/models", save)
	router.Put("/models/{modelID}", save)
	router.Delete("/models/{modelID}", func(w http.ResponseWriter, r *http.Request) {
		user, _ := identity.UserFromContext(r.Context())
		if err := s.repository.DeleteUser(r.Context(), chi.URLParam(r, "modelID"), user.ID); err != nil {
			userModelError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}

func userModelError(w http.ResponseWriter, err error) {
	if errors.Is(err, ErrNotFound) {
		err = resource.NotFound
	}
	resource.Fail(w, err)
}
