package syncer

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/biz/mcphub/repo"
)

type upstreamRepo interface {
	Get(ctx context.Context, id uuid.UUID) (*repo.UpstreamConfig, error)
	MarkSyncSuccess(ctx context.Context, id uuid.UUID) error
	MarkSyncFailed(ctx context.Context, id uuid.UUID) error
	MarkHealthStatus(ctx context.Context, id uuid.UUID, healthy bool) error
}

type toolRepo interface {
	ReplaceByUpstream(ctx context.Context, upstreamID uuid.UUID, rows []repo.UpsertToolInput) error
}

type registryPublisher interface {
	Publish(ctx context.Context) error
}

type upstreamClient interface {
	ListTools(ctx context.Context, upstream *repo.UpstreamConfig) ([]repo.UpstreamTool, error)
}

type Service struct {
	upstreams upstreamRepo
	tools     toolRepo
	registry  registryPublisher
	client    upstreamClient
}

func NewService(upstreams upstreamRepo, tools toolRepo, registry registryPublisher, client upstreamClient) *Service {
	return &Service{
		upstreams: upstreams,
		tools:     tools,
		registry:  registry,
		client:    client,
	}
}

func (s *Service) Sync(ctx context.Context, upstreamID uuid.UUID) error {
	upstream, err := s.upstreams.Get(ctx, upstreamID)
	if err != nil {
		return err
	}

	tools, err := s.client.ListTools(ctx, upstream)
	if err != nil {
		_ = s.upstreams.MarkHealthStatus(ctx, upstreamID, false)
		_ = s.upstreams.MarkSyncFailed(ctx, upstreamID)
		return err
	}
	if err := s.upstreams.MarkHealthStatus(ctx, upstreamID, true); err != nil {
		_ = s.upstreams.MarkSyncFailed(ctx, upstreamID)
		return err
	}

	rows := make([]repo.UpsertToolInput, 0, len(tools))
	for _, tool := range tools {
		rows = append(rows, repo.UpsertToolInput{
			UpstreamID:     upstreamID,
			Name:           tool.Name,
			NamespacedName: NamespacedName(upstream.Slug, tool.Name),
			Scope:          upstream.Scope,
			UserID:         upstream.UserID,
			TeamID:         upstream.TeamID,
			Description:    tool.Description,
			InputSchema:    tool.InputSchema,
			VersionHash:    hashSchema(tool.InputSchema),
			Price:          0,
		})
	}

	if err := s.tools.ReplaceByUpstream(ctx, upstreamID, rows); err != nil {
		_ = s.upstreams.MarkSyncFailed(ctx, upstreamID)
		return err
	}
	if err := s.registry.Publish(ctx); err != nil {
		_ = s.upstreams.MarkSyncFailed(ctx, upstreamID)
		return err
	}
	if err := s.upstreams.MarkSyncSuccess(ctx, upstreamID); err != nil {
		return err
	}
	return nil
}

func hashSchema(raw json.RawMessage) string {
	if len(raw) == 0 {
		raw = json.RawMessage(`{}`)
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

func NamespacedName(slug, tool string) string {
	return fmt.Sprintf("%s__%s", slug, tool)
}
