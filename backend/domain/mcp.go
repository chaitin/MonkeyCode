package domain

import (
	"context"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/mcptool"
	"github.com/chaitin/MonkeyCode/backend/db/mcpupstream"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
	"github.com/google/uuid"
)

const (
	MCPScopePlatform = "platform"
	MCPScopeUser     = "user"
)

type MCPHeader struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

type UserMCPUsecase interface {
	ListUpstreams(ctx context.Context, uid uuid.UUID, cursor CursorReq) (*ListUserMCPUpstreamsResp, error)
	CreateUpstream(ctx context.Context, uid uuid.UUID, req CreateUserMCPUpstreamReq) (*MCPUpstream, error)
	UpdateUpstream(ctx context.Context, uid, id uuid.UUID, req UpdateUserMCPUpstreamReq) error
	DeleteUpstream(ctx context.Context, uid, id uuid.UUID) error
	SyncUpstream(ctx context.Context, uid, id uuid.UUID) error
	ListTools(ctx context.Context, uid uuid.UUID) (*ListUserMCPToolsResp, error)
	UpdateToolSetting(ctx context.Context, uid, toolID uuid.UUID, enabled bool) error
}

type UserMCPRepo interface {
	ListUserUpstreams(ctx context.Context, uid uuid.UUID, cursor CursorReq) ([]*MCPUpstream, error)
	CreateUserUpstream(ctx context.Context, upstream *MCPUpstream) (*MCPUpstream, error)
	UpdateUserUpstream(ctx context.Context, uid, id uuid.UUID, req UpdateUserMCPUpstreamReq) error
	DeleteUserUpstream(ctx context.Context, uid, id uuid.UUID) error
	GetUserUpstream(ctx context.Context, uid, id uuid.UUID) (*MCPUpstream, error)
	HasPlatformSlug(ctx context.Context, slug string) (bool, error)
	ListVisibleTools(ctx context.Context, uid uuid.UUID) ([]*MCPTool, error)
	GetVisibleTool(ctx context.Context, uid, toolID uuid.UUID) (*MCPTool, error)
	ListToolSettings(ctx context.Context, uid uuid.UUID) (map[uuid.UUID]bool, error)
	UpsertToolSetting(ctx context.Context, uid, toolID uuid.UUID, enabled bool) error
}

type UserMCPSyncClient interface {
	SyncUpstream(ctx context.Context, upstreamID uuid.UUID) error
}

type MCPUpstream struct {
	ID              uuid.UUID         `json:"id"`
	UserID          uuid.UUID         `json:"-"`
	User            *User             `json:"user"`
	Name            string            `json:"name"`
	Slug            string            `json:"slug"`
	Scope           mcpupstream.Scope `json:"scope"`
	Type            string            `json:"type"`
	URL             string            `json:"url"`
	Headers         []MCPHeader       `json:"headers"`
	Description     string            `json:"description"`
	Enabled         bool              `json:"enabled"`
	HealthStatus    string            `json:"health_status"`
	SyncStatus      string            `json:"sync_status"`
	HealthCheckedAt int64             `json:"health_checked_at,omitempty"`
	LastSyncedAt    int64             `json:"last_synced_at,omitempty"`
	CreatedAt       int64             `json:"created_at"`
	Tools           []*MCPTool        `json:"tools"`
}

func (m *MCPUpstream) From(src *db.MCPUpstream) *MCPUpstream {
	if src == nil {
		return m
	}

	m.ID = src.ID
	m.User = cvt.From(src.Edges.User, &User{})
	m.Name = src.Name
	m.Slug = src.Slug
	m.Scope = src.Scope
	m.Type = src.Type
	m.URL = src.URL
	m.Headers = cvt.MapToList(src.Headers, func(k, v string) MCPHeader {
		return MCPHeader{
			Name:  k,
			Value: v,
		}
	})
	m.Description = src.Description
	m.Enabled = src.Enabled
	m.HealthStatus = src.HealthStatus
	m.SyncStatus = src.SyncStatus
	if src.HealthCheckedAt != nil {
		m.HealthCheckedAt = src.HealthCheckedAt.Unix()
	}
	if src.LastSyncedAt != nil {
		m.LastSyncedAt = src.LastSyncedAt.Unix()
	}
	m.CreatedAt = src.CreatedAt.Unix()
	m.Tools = cvt.Iter(src.Edges.Tools, func(_ int, t *db.MCPTool) *MCPTool {
		return cvt.From(t, &MCPTool{})
	})

	return m
}

type MCPTool struct {
	ID             uuid.UUID      `json:"id"`
	Name           string         `json:"name"`
	NamespacedName string         `json:"namespaced_name"`
	Scope          mcptool.Scope  `json:"scope"`
	Description    string         `json:"description"`
	InputSchema    map[string]any `json:"input_schema"`
	Price          int64          `json:"price"`
	Enabled        bool           `json:"enabled"`
	CreatedAt      int64          `json:"created_at"`
}

func (m *MCPTool) From(src *db.MCPTool) *MCPTool {
	if src == nil {
		return m
	}

	m.ID = src.ID
	m.Name = src.Name
	m.NamespacedName = src.NamespacedName
	m.Scope = src.Scope
	m.Description = src.Description
	m.InputSchema = src.InputSchema
	m.Price = src.Price
	m.Enabled = src.Enabled
	m.CreatedAt = src.CreatedAt.Unix()

	return m
}

type ListUserMCPUpstreamsResp struct {
	Items []*MCPUpstream `json:"items"`
}

type CreateUserMCPUpstreamReq struct {
	Name        string      `json:"name"`
	Slug        string      `json:"slug"`
	URL         string      `json:"url"`
	Headers     []MCPHeader `json:"headers"`
	Description string      `json:"description"`
	Enabled     *bool       `json:"enabled"`
	UserID      uuid.UUID   `json:"-"`
}

type UpdateUserMCPUpstreamReq struct {
	ID          uuid.UUID    `param:"id" validate:"required" json:"-"`
	Name        *string      `json:"name,omitempty"`
	Slug        *string      `json:"slug,omitempty"`
	URL         *string      `json:"url,omitempty"`
	Headers     *[]MCPHeader `json:"headers,omitempty"`
	Description *string      `json:"description,omitempty"`
	Enabled     *bool        `json:"enabled,omitempty"`
}

type DeleteUserMCPUpstreamReq struct {
	ID uuid.UUID `param:"id" validate:"required"`
}

type SyncUserMCPUpstreamReq struct {
	ID uuid.UUID `param:"id" validate:"required"`
}

type ListUserMCPToolsResp struct {
	Items []*MCPTool `json:"items"`
}

type UpdateUserMCPToolSettingReq struct {
	ID      uuid.UUID `param:"id" validate:"required" json:"-"`
	Enabled bool      `json:"enabled"`
}
