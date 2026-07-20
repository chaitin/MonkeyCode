package usecase

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/pkg/netguard"
)

type userMCPUsecase struct {
	repo       domain.UserMCPRepo
	syncClient domain.UserMCPSyncClient
	logger     *slog.Logger
	guard      *netguard.Guard
}

func NewUserMCPUsecase(i *do.Injector) (domain.UserMCPUsecase, error) {
	cfg := do.MustInvoke[*config.Config](i)
	return &userMCPUsecase{
		repo:       do.MustInvoke[domain.UserMCPRepo](i),
		syncClient: do.MustInvoke[domain.UserMCPSyncClient](i),
		logger:     do.MustInvoke[*slog.Logger](i).With("module", "usecase.UserMCPUsecase"),
		guard:      netguard.New(cfg.Security.BlockPrivateNetwork),
	}, nil
}

func NewUserMCPSyncClient(i *do.Injector) (domain.UserMCPSyncClient, error) {
	cfg := do.MustInvoke[*config.Config](i)
	logger := do.MustInvoke[*slog.Logger](i).With("module", "usecase.UserMCPSyncClient")
	if strings.TrimSpace(cfg.MCPHub.URL) == "" || strings.TrimSpace(cfg.MCPHub.Token) == "" {
		return &unconfiguredUserMCPSyncClient{}, nil
	}
	return &httpUserMCPSyncClient{
		baseURL: cfg.MCPHub.URL,
		token:   cfg.MCPHub.Token,
		client:  &http.Client{Timeout: 15 * time.Second},
		logger:  logger,
	}, nil
}

func (u *userMCPUsecase) ListUpstreams(ctx context.Context, uid uuid.UUID, cursor domain.CursorReq) (*domain.ListUserMCPUpstreamsResp, error) {
	items, err := u.repo.ListUserUpstreams(ctx, uid, cursor)
	if err != nil {
		return nil, err
	}
	return &domain.ListUserMCPUpstreamsResp{Items: items}, nil
}

func (u *userMCPUsecase) CreateUpstream(ctx context.Context, uid uuid.UUID, req domain.CreateUserMCPUpstreamReq) (*domain.MCPUpstream, error) {
	if err := u.guard.ValidateURL(ctx, req.URL); err != nil {
		return nil, errcode.ErrInvalidParameter.Wrap(err)
	}
	if ok, err := u.repo.HasPlatformSlug(ctx, req.Slug); err != nil {
		return nil, err
	} else if ok {
		return nil, fmt.Errorf("mcp upstream slug conflicts with platform upstream")
	}

	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	upstream := &domain.MCPUpstream{
		UserID:       uid,
		Name:         req.Name,
		Slug:         req.Slug,
		Scope:        domain.MCPScopeUser,
		Type:         "server",
		URL:          req.URL,
		Headers:      req.Headers,
		Description:  req.Description,
		Enabled:      enabled,
		HealthStatus: "unknown",
		SyncStatus:   "pending",
	}
	return u.repo.CreateUserUpstream(ctx, upstream)
}

func (u *userMCPUsecase) UpdateUpstream(ctx context.Context, uid, id uuid.UUID, req domain.UpdateUserMCPUpstreamReq) error {
	if req.URL != nil {
		if err := u.guard.ValidateURL(ctx, *req.URL); err != nil {
			return errcode.ErrInvalidParameter.Wrap(err)
		}
	}
	if req.Slug != nil {
		if ok, err := u.repo.HasPlatformSlug(ctx, *req.Slug); err != nil {
			return err
		} else if ok {
			return fmt.Errorf("mcp upstream slug conflicts with platform upstream")
		}
	}
	return u.repo.UpdateUserUpstream(ctx, uid, id, req)
}

func (u *userMCPUsecase) DeleteUpstream(ctx context.Context, uid, id uuid.UUID) error {
	return u.repo.DeleteUserUpstream(ctx, uid, id)
}

func (u *userMCPUsecase) SyncUpstream(ctx context.Context, uid, id uuid.UUID) error {
	if _, err := u.repo.GetUserUpstream(ctx, uid, id); err != nil {
		return err
	}
	return u.syncClient.SyncUpstream(ctx, id)
}

func (u *userMCPUsecase) ListTools(ctx context.Context, uid uuid.UUID) (*domain.ListUserMCPToolsResp, error) {
	tools, err := u.repo.ListVisibleTools(ctx, uid)
	if err != nil {
		return nil, err
	}
	settings, err := u.repo.ListToolSettings(ctx, uid)
	if err != nil {
		return nil, err
	}
	items := make([]*domain.MCPTool, 0, len(tools))
	for _, tool := range tools {
		if enabled, ok := settings[tool.ID]; ok {
			tool.Enabled = enabled
		}
		items = append(items, tool)
	}
	return &domain.ListUserMCPToolsResp{Items: items}, nil
}

func (u *userMCPUsecase) UpdateToolSetting(ctx context.Context, uid, toolID uuid.UUID, enabled bool) error {
	return u.repo.UpsertToolSetting(ctx, uid, toolID, enabled)
}

type unconfiguredUserMCPSyncClient struct{}

func (c *unconfiguredUserMCPSyncClient) SyncUpstream(context.Context, uuid.UUID) error {
	return fmt.Errorf("mcp hub sync is not configured")
}

type httpUserMCPSyncClient struct {
	baseURL string
	token   string
	client  *http.Client
	logger  *slog.Logger
}

func (c *httpUserMCPSyncClient) SyncUpstream(ctx context.Context, upstreamID uuid.UUID) error {
	endpoint, err := buildUserMCPSyncURL(c.baseURL, upstreamID)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader([]byte(`{}`)))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= http.StatusBadRequest {
		return fmt.Errorf("sync user mcp upstream failed: status %d", resp.StatusCode)
	}
	return nil
}

func buildUserMCPSyncURL(baseURL string, upstreamID uuid.UUID) (string, error) {
	parsed, err := url.Parse(baseURL)
	if err != nil {
		return "", err
	}
	parsed.Path = "/internal/upstreams/" + upstreamID.String() + "/sync"
	parsed.RawQuery = ""
	return parsed.String(), nil
}
