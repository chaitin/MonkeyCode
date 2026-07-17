package syncer

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/biz/mcphub/repo"
)

func TestSyncMarksUpstreamHealthy(t *testing.T) {
	upstreamID := uuid.New()
	upstreams := &upstreamRepoStub{
		upstream: &repo.UpstreamConfig{ID: upstreamID, Slug: "images"},
	}
	service := NewService(upstreams, &toolRepoStub{}, &registryStub{}, &upstreamClientStub{
		tools: []repo.UpstreamTool{{Name: "search"}},
	})

	if err := service.Sync(context.Background(), upstreamID); err != nil {
		t.Fatal(err)
	}
	if upstreams.healthy == nil || !*upstreams.healthy {
		t.Fatalf("health status = %v, want healthy", upstreams.healthy)
	}
	if !upstreams.syncSuccess {
		t.Fatal("sync success was not recorded")
	}
}

func TestSyncMarksUpstreamUnhealthyWhenListToolsFails(t *testing.T) {
	upstreamID := uuid.New()
	upstreams := &upstreamRepoStub{
		upstream: &repo.UpstreamConfig{ID: upstreamID, Slug: "images"},
	}
	service := NewService(upstreams, &toolRepoStub{}, &registryStub{}, &upstreamClientStub{
		err: errors.New("upstream unavailable"),
	})

	if err := service.Sync(context.Background(), upstreamID); err == nil {
		t.Fatal("Sync() error = nil, want upstream error")
	}
	if upstreams.healthy == nil || *upstreams.healthy {
		t.Fatalf("health status = %v, want unhealthy", upstreams.healthy)
	}
	if !upstreams.syncFailed {
		t.Fatal("sync failure was not recorded")
	}
}

type upstreamRepoStub struct {
	upstream    *repo.UpstreamConfig
	healthy     *bool
	syncSuccess bool
	syncFailed  bool
}

func (s *upstreamRepoStub) Get(context.Context, uuid.UUID) (*repo.UpstreamConfig, error) {
	return s.upstream, nil
}

func (s *upstreamRepoStub) MarkSyncSuccess(context.Context, uuid.UUID) error {
	s.syncSuccess = true
	return nil
}

func (s *upstreamRepoStub) MarkSyncFailed(context.Context, uuid.UUID) error {
	s.syncFailed = true
	return nil
}

func (s *upstreamRepoStub) MarkHealthStatus(_ context.Context, _ uuid.UUID, healthy bool) error {
	s.healthy = &healthy
	return nil
}

type toolRepoStub struct{}

func (s *toolRepoStub) ReplaceByUpstream(context.Context, uuid.UUID, []repo.UpsertToolInput) error {
	return nil
}

type registryStub struct{}

func (s *registryStub) Publish(context.Context) error {
	return nil
}

type upstreamClientStub struct {
	tools []repo.UpstreamTool
	err   error
}

func (s *upstreamClientStub) ListTools(context.Context, *repo.UpstreamConfig) ([]repo.UpstreamTool, error) {
	return s.tools, s.err
}
