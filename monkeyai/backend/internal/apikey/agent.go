package apikey

import (
	"context"
	"errors"
	"net/http"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/web"
	"github.com/go-chi/chi/v5"
)

func (s *Service) RegisterAgent(router chi.Router) {
	api := web.Routes(router.With(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Cache-Control", "private, no-store")
			next.ServeHTTP(w, r)
		})
	})).WithDecodeCode("api_key_error")
	api.Get("/api-keys", func(ctx context.Context) (map[string]any, error) {
		user, _ := identity.UserFromContext(ctx)
		keys, err := s.ListByUser(ctx, user.ID)
		if err != nil {
			return nil, &web.Error{Status: 500, Code: "api_key_error", Message: "读取调用密钥失败", Cause: err}
		}
		return map[string]any{"api_keys": keys}, nil
	})
	api.Post("/api-keys", s.create)
	api.Handle(http.MethodDelete, "/api-keys/{keyID}", 204, s.revoke)
	api.Handle(http.MethodPost, "/api-keys/{keyID}/rotate", 201, s.rotate)
}
func (s *Service) create(ctx context.Context, input CreateInput) (CreatedKey, error) {
	user, _ := identity.UserFromContext(ctx)
	key, err := s.Create(ctx, user.ID, input)
	if err != nil {
		var failure *web.Error
		if errors.As(err, &failure) {
			return CreatedKey{}, failure
		}
		return CreatedKey{}, (&web.Error{Status: 400, Code: "api_key_error", Message: err.Error()}).WithCause(err)
	}
	return key, nil
}
func (s *Service) revoke(ctx context.Context) (struct{}, error) {
	user, _ := identity.UserFromContext(ctx)
	err := s.Revoke(ctx, user.ID, chi.URLParamFromCtx(ctx, "keyID"))
	if err != nil {
		status := 500
		if errors.Is(err, ErrNotFound) {
			status = 404
		}
		return struct{}{}, (&web.Error{Status: status, Code: "api_key_error", Message: "调用密钥不存在"}).WithCause(err)
	}
	return struct{}{}, nil
}
func (s *Service) rotate(ctx context.Context) (CreatedKey, error) {
	user, _ := identity.UserFromContext(ctx)
	key, err := s.Rotate(ctx, user.ID, chi.URLParamFromCtx(ctx, "keyID"))
	if err != nil {
		status := 500
		if errors.Is(err, ErrNotFound) {
			status = 404
		}
		return CreatedKey{}, (&web.Error{Status: status, Code: "api_key_error", Message: "轮换调用密钥失败"}).WithCause(err)
	}
	return key, nil
}

func keyJSON(ctx context.Context, w http.ResponseWriter, status int, value any) {
	w.Header().Set("Cache-Control", "private, no-store")
	web.JSON(ctx, w, status, value)
}
func keyError(ctx context.Context, w http.ResponseWriter, status int, message string) {
	keyJSON(ctx, w, status, map[string]any{"error": web.Body(ctx, "api_key_error", message)})
}
