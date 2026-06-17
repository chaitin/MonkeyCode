package registry

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/chaitin/MonkeyCode/backend/biz/mcphub/repo"
)

const PublishedSnapshotKey = "mcphub:published:tools"

type snapshotReader interface {
	Get(ctx context.Context, key string) ([]byte, error)
}

type snapshotWriter interface {
	Set(ctx context.Context, key string, value []byte, expiration time.Duration) error
}

type redisSnapshotStore struct {
	client redis.Cmdable
}

func (r *redisSnapshotStore) Get(ctx context.Context, key string) ([]byte, error) {
	return r.client.Get(ctx, key).Bytes()
}

func (r *redisSnapshotStore) Set(ctx context.Context, key string, value []byte, expiration time.Duration) error {
	return r.client.Set(ctx, key, value, expiration).Err()
}

type Service struct {
	cache        snapshotReader
	write        snapshotWriter
	repo         repo.ToolReader
	userSettings repo.UserToolSettingReader
}

func NewService(rdb redis.Cmdable, repo repo.ToolReader, userSettings repo.UserToolSettingReader) *Service {
	svc := &Service{
		repo:         repo,
		userSettings: userSettings,
	}
	if rdb != nil {
		store := &redisSnapshotStore{client: rdb}
		svc.cache = store
		svc.write = store
	}
	return svc
}

func (s *Service) ListEffectiveTools(ctx context.Context, userID uuid.UUID) ([]repo.ToolSnapshot, error) {
	platform, err := s.listPlatformTools(ctx)
	if err != nil {
		return nil, err
	}
	userTools, err := s.repo.ListUserPublishedTools(ctx, userID)
	if err != nil {
		return nil, err
	}
	teamTools, err := s.repo.ListTeamPublishedTools(ctx, userID)
	if err != nil {
		return nil, err
	}

	settings := map[uuid.UUID]bool{}
	if s.userSettings != nil {
		settings, err = s.userSettings.ListEnabledMap(ctx, userID)
		if err != nil {
			return nil, err
		}
	}

	tools := append(platform, userTools...)
	tools = append(tools, teamTools...)
	return applyUserSettingsDefaultEnabled(tools, settings), nil
}

func (s *Service) listPlatformTools(ctx context.Context) ([]repo.ToolSnapshot, error) {
	if s.cache != nil {
		b, err := s.cache.Get(ctx, PublishedSnapshotKey)
		if err == nil {
			var tools []repo.ToolSnapshot
			if json.Unmarshal(b, &tools) == nil {
				return filterPublishedTools(tools), nil
			}
		}
	}

	tools, err := s.repo.ListPlatformPublishedTools(ctx)
	if err != nil {
		return nil, err
	}
	filtered := filterPublishedTools(tools)
	if s.write != nil {
		if payload, err := json.Marshal(filtered); err == nil {
			_ = s.write.Set(ctx, PublishedSnapshotKey, payload, 0)
		}
	}
	return filtered, nil
}

func (s *Service) Publish(ctx context.Context) error {
	if s.write == nil {
		return nil
	}

	tools, err := s.repo.ListPlatformPublishedTools(ctx)
	if err != nil {
		return err
	}
	payload, err := json.Marshal(filterPublishedTools(tools))
	if err != nil {
		return err
	}
	return s.write.Set(ctx, PublishedSnapshotKey, payload, 0)
}

func applyUserSettingsDefaultEnabled(tools []repo.ToolSnapshot, settings map[uuid.UUID]bool) []repo.ToolSnapshot {
	filtered := make([]repo.ToolSnapshot, 0, len(tools))
	for _, tool := range filterPublishedTools(tools) {
		enabled, ok := settings[tool.ID]
		if ok && !enabled {
			continue
		}
		filtered = append(filtered, tool)
	}
	return filtered
}

func filterPublishedTools(tools []repo.ToolSnapshot) []repo.ToolSnapshot {
	filtered := make([]repo.ToolSnapshot, 0, len(tools))
	for _, tool := range tools {
		if !tool.Enabled {
			continue
		}
		if tool.DeletedAt != nil {
			continue
		}
		filtered = append(filtered, tool)
	}
	return filtered
}
