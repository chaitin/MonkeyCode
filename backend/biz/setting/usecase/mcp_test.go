package usecase

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/domain"
)

func TestCreatePrivateMCPUpstream(t *testing.T) {
	repo := &userMCPRepoStub{}
	uc := &userMCPUsecase{
		repo:       repo,
		syncClient: &userMCPSyncClientStub{},
	}
	userID := uuid.MustParse("11111111-1111-1111-1111-111111111111")

	upstream, err := uc.CreateUpstream(context.Background(), userID, domain.CreateUserMCPUpstreamReq{
		Name: "My Docs",
		Slug: "mydocs",
		URL:  "https://example.com/mcp",
		Headers: []domain.MCPHeader{
			{Name: "Authorization", Value: "Bearer test-token"},
		},
	})
	if err != nil {
		t.Fatalf("CreateUpstream() error = %v", err)
	}
	if upstream.Scope != domain.MCPScopeUser || upstream.UserID != userID {
		t.Fatalf("unexpected upstream owner: %+v", upstream)
	}
	if repo.lastCreated.Scope != domain.MCPScopeUser || repo.lastCreated.UserID != userID {
		t.Fatalf("unexpected created upstream: %+v", repo.lastCreated)
	}
}

func TestUpdateUserToolSetting(t *testing.T) {
	repo := &userMCPRepoStub{
		visibleTool: &domain.MCPTool{ID: uuid.MustParse("22222222-2222-2222-2222-222222222222"), Scope: domain.MCPScopePlatform},
	}
	uc := &userMCPUsecase{
		repo:       repo,
		syncClient: &userMCPSyncClientStub{},
	}
	userID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	toolID := uuid.MustParse("22222222-2222-2222-2222-222222222222")

	if err := uc.UpdateToolSetting(context.Background(), userID, toolID, false); err != nil {
		t.Fatalf("UpdateToolSetting() error = %v", err)
	}
	if repo.lastToolSettingEnabled {
		t.Fatalf("expected tool to be disabled")
	}
}

type userMCPRepoStub struct {
	lastCreated            *domain.MCPUpstream
	lastToolSettingEnabled bool
	visibleTool            *domain.MCPTool
}

func (s *userMCPRepoStub) ListUserUpstreams(context.Context, uuid.UUID, domain.CursorReq) ([]*domain.MCPUpstream, error) {
	return nil, nil
}

func (s *userMCPRepoStub) CreateUserUpstream(_ context.Context, upstream *domain.MCPUpstream) (*domain.MCPUpstream, error) {
	cp := *upstream
	cp.ID = uuid.New()
	s.lastCreated = &cp
	return &cp, nil
}

func (s *userMCPRepoStub) UpdateUserUpstream(context.Context, uuid.UUID, uuid.UUID, domain.UpdateUserMCPUpstreamReq) error {
	return nil
}

func (s *userMCPRepoStub) DeleteUserUpstream(context.Context, uuid.UUID, uuid.UUID) error {
	return nil
}

func (s *userMCPRepoStub) GetUserUpstream(context.Context, uuid.UUID, uuid.UUID) (*domain.MCPUpstream, error) {
	return &domain.MCPUpstream{ID: uuid.New(), Scope: domain.MCPScopeUser}, nil
}

func (s *userMCPRepoStub) HasPlatformSlug(context.Context, string) (bool, error) {
	return false, nil
}

func (s *userMCPRepoStub) ListVisibleTools(context.Context, uuid.UUID) ([]*domain.MCPTool, error) {
	return nil, nil
}

func (s *userMCPRepoStub) GetVisibleTool(context.Context, uuid.UUID, uuid.UUID) (*domain.MCPTool, error) {
	return s.visibleTool, nil
}

func (s *userMCPRepoStub) ListToolSettings(context.Context, uuid.UUID) (map[uuid.UUID]bool, error) {
	return map[uuid.UUID]bool{}, nil
}

func (s *userMCPRepoStub) UpsertToolSetting(_ context.Context, _ uuid.UUID, _ uuid.UUID, enabled bool) error {
	s.lastToolSettingEnabled = enabled
	return nil
}

type userMCPSyncClientStub struct{}

func (s *userMCPSyncClientStub) SyncUpstream(context.Context, uuid.UUID) error {
	return nil
}
