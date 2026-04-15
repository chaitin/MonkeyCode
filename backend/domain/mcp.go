package domain

import (
	"context"
	"time"

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
	ID              uuid.UUID   `json:"id"`
	UserID          uuid.UUID   `json:"user_id"`
	Name            string      `json:"name"`
	Slug            string      `json:"slug"`
	Scope           string      `json:"scope"`
	Type            string      `json:"type"`
	URL             string      `json:"url"`
	Headers         []MCPHeader `json:"headers"`
	Description     string      `json:"description"`
	Enabled         bool        `json:"enabled"`
	HealthStatus    string      `json:"health_status"`
	SyncStatus      string      `json:"sync_status"`
	HealthCheckedAt *time.Time  `json:"health_checked_at,omitempty"`
	LastSyncedAt    *time.Time  `json:"last_synced_at,omitempty"`
	CreatedAt       time.Time   `json:"created_at"`
	UpdatedAt       time.Time   `json:"updated_at"`
}

type MCPTool struct {
	ID             uuid.UUID          `json:"id"`
	UpstreamID     uuid.UUID          `json:"upstream_id"`
	UserID         *uuid.UUID         `json:"user_id,omitempty"`
	Name           string             `json:"name"`
	NamespacedName string             `json:"namespaced_name"`
	Scope          string             `json:"scope"`
	Description    string             `json:"description"`
	InputSchema    map[string]any     `json:"input_schema"`
	Price          int64              `json:"price"`
	Enabled        bool               `json:"enabled"`
	Billable       bool               `json:"billable"`
	DeletedAt      *time.Time         `json:"deleted_at,omitempty"`
	CreatedAt      time.Time          `json:"created_at"`
	UpdatedAt      time.Time          `json:"updated_at"`
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
