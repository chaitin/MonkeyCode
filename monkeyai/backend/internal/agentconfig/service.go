package agentconfig

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/database"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/model"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/setting"
	"github.com/go-chi/chi/v5"
)

type SettingReader interface {
	AgentConfig(context.Context) (setting.Config, error)
}

type ModelReader interface {
	AgentModels(context.Context, string, bool) ([]model.AgentModel, error)
}

type Gateway struct {
	BaseURL        string `json:"base_url"`
	Authentication string `json:"authentication"`
}

type Snapshot struct {
	Bundle
	Version      string                     `json:"version"`
	UpdatedAt    time.Time                  `json:"updated_at"`
	Settings     map[string]json.RawMessage `json:"settings"`
	ModelGateway Gateway                    `json:"model_gateway"`
	Models       []model.AgentModel         `json:"models"`
}

type Service struct {
	resources *Resources
	settings  SettingReader
	models    ModelReader
	publicURL string
}

func NewService(settings SettingReader, models ModelReader, publicURL string) *Service {
	return &Service{
		settings:  settings,
		models:    models,
		publicURL: strings.TrimRight(publicURL, "/"),
	}
}

func (s *Service) WithResources(r *Resources) *Service { s.resources = r; return s }

func (s *Service) Snapshot(ctx context.Context, user identity.User) (Snapshot, error) {
	if s.resources != nil {
		tx, err := s.resources.transaction(ctx)
		if err != nil {
			return Snapshot{}, err
		}
		defer tx.Rollback(ctx)
		ctx = database.WithSnapshot(ctx, tx)
	}
	settings, err := s.settings.AgentConfig(ctx)
	if err != nil {
		return Snapshot{}, fmt.Errorf("读取全局设置: %w", err)
	}
	models, err := s.models.AgentModels(ctx, user.ID, user.Role == "admin")
	if err != nil {
		return Snapshot{}, fmt.Errorf("读取模型配置: %w", err)
	}
	updatedAt := settings.UpdatedAt
	for _, item := range models {
		if item.UpdatedAt.After(updatedAt) {
			updatedAt = item.UpdatedAt
		}
	}
	snapshot := Snapshot{
		UpdatedAt: updatedAt,
		Settings:  settings.Settings,
		ModelGateway: Gateway{
			BaseURL:        s.publicURL + "/v1",
			Authentication: "api_key",
		},
		Models: models,
	}
	if s.resources != nil {
		snapshot.Bundle, err = s.resources.Snapshot(ctx, database.Reader(ctx, s.resources.store.Pool), user.ID)
		if err != nil {
			return Snapshot{}, err
		}
	}
	if snapshot.ResourceUpdatedAt.After(snapshot.UpdatedAt) {
		snapshot.UpdatedAt = snapshot.ResourceUpdatedAt
	}
	encoded, err := json.Marshal(snapshot)
	if err != nil {
		return Snapshot{}, err
	}
	digest := sha256.Sum256(encoded)
	snapshot.Version = "sha256:" + hex.EncodeToString(digest[:])
	return snapshot, nil
}

func (s *Service) RegisterAgent(router chi.Router) {
	router.Get("/config", func(w http.ResponseWriter, r *http.Request) {
		user, _ := identity.UserFromContext(r.Context())
		snapshot, err := s.Snapshot(r.Context(), user)
		if err != nil {
			slog.Error("读取 Agent 配置失败", "error", err)
			configError(w, http.StatusInternalServerError, "读取 Agent 配置失败")
			return
		}
		etag := `"` + snapshot.Version + `"`
		w.Header().Set("ETag", etag)
		w.Header().Set("Cache-Control", "private, no-cache")
		if r.Header.Get("If-None-Match") == etag {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		configJSON(w, http.StatusOK, snapshot)
	})
}

func configJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func configError(w http.ResponseWriter, status int, message string) {
	configJSON(w, status, map[string]any{
		"error": map[string]string{"code": "agent_config_error", "message": message},
	})
}
