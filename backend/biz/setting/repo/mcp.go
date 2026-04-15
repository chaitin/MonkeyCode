package repo

import (
	"context"
	"fmt"

	"entgo.io/ent/dialect/sql"
	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/mcptool"
	"github.com/chaitin/MonkeyCode/backend/db/mcpupstream"
	"github.com/chaitin/MonkeyCode/backend/db/mcpusertoolsetting"
	"github.com/chaitin/MonkeyCode/backend/domain"
)

type mcpRepo struct {
	db *db.Client
}

func NewMCPRepo(i *do.Injector) (domain.UserMCPRepo, error) {
	return &mcpRepo{db: do.MustInvoke[*db.Client](i)}, nil
}

func (r *mcpRepo) ListUserUpstreams(ctx context.Context, uid uuid.UUID, _ domain.CursorReq) ([]*domain.MCPUpstream, error) {
	rows, err := r.db.MCPUpstream.Query().
		Where(
			mcpupstream.Scope(domain.MCPScopeUser),
			mcpupstream.UserID(uid),
		).
		Order(mcpupstream.ByCreatedAt(sql.OrderDesc())).
		All(ctx)
	if err != nil {
		return nil, fmt.Errorf("list user mcp upstreams: %w", err)
	}

	items := make([]*domain.MCPUpstream, 0, len(rows))
	for _, row := range rows {
		items = append(items, toDomainUpstream(row))
	}
	return items, nil
}

func (r *mcpRepo) CreateUserUpstream(ctx context.Context, upstream *domain.MCPUpstream) (*domain.MCPUpstream, error) {
	headers := headersToMap(upstream.Headers)
	row, err := r.db.MCPUpstream.Create().
		SetName(upstream.Name).
		SetSlug(upstream.Slug).
		SetScope(domain.MCPScopeUser).
		SetUserID(upstream.UserID).
		SetType(upstream.Type).
		SetURL(upstream.URL).
		SetHeaders(headers).
		SetDescription(upstream.Description).
		SetEnabled(upstream.Enabled).
		Save(ctx)
	if err != nil {
		return nil, fmt.Errorf("create user mcp upstream: %w", err)
	}
	return toDomainUpstream(row), nil
}

func (r *mcpRepo) UpdateUserUpstream(ctx context.Context, uid, id uuid.UUID, req domain.UpdateUserMCPUpstreamReq) error {
	row, err := r.getUserUpstreamRow(ctx, uid, id)
	if err != nil {
		return err
	}
	update := r.db.MCPUpstream.UpdateOneID(row.ID)
	if req.Name != nil {
		update = update.SetName(*req.Name)
	}
	if req.Slug != nil {
		update = update.SetSlug(*req.Slug)
	}
	if req.URL != nil {
		update = update.SetURL(*req.URL)
	}
	if req.Headers != nil {
		update = update.SetHeaders(headersToMap(*req.Headers))
	}
	if req.Description != nil {
		update = update.SetDescription(*req.Description)
	}
	if req.Enabled != nil {
		update = update.SetEnabled(*req.Enabled)
	}
	return update.Exec(ctx)
}

func (r *mcpRepo) DeleteUserUpstream(ctx context.Context, uid, id uuid.UUID) error {
	row, err := r.getUserUpstreamRow(ctx, uid, id)
	if err != nil {
		return err
	}
	return r.db.MCPUpstream.DeleteOneID(row.ID).Exec(ctx)
}

func (r *mcpRepo) GetUserUpstream(ctx context.Context, uid, id uuid.UUID) (*domain.MCPUpstream, error) {
	row, err := r.getUserUpstreamRow(ctx, uid, id)
	if err != nil {
		return nil, err
	}
	return toDomainUpstream(row), nil
}

func (r *mcpRepo) HasPlatformSlug(ctx context.Context, slug string) (bool, error) {
	return r.db.MCPUpstream.Query().
		Where(
			mcpupstream.Scope(domain.MCPScopePlatform),
			mcpupstream.Slug(slug),
		).
		Exist(ctx)
}

func (r *mcpRepo) ListVisibleTools(ctx context.Context, uid uuid.UUID) ([]*domain.MCPTool, error) {
	platformRows, err := r.db.MCPTool.Query().
		Where(
			mcptool.Scope(domain.MCPScopePlatform),
			mcptool.Enabled(true),
			mcptool.DeletedAtIsNil(),
		).
		Order(mcptool.ByNamespacedName(sql.OrderAsc())).
		All(ctx)
	if err != nil {
		return nil, fmt.Errorf("list platform mcp tools: %w", err)
	}
	userRows, err := r.db.MCPTool.Query().
		Where(
			mcptool.Scope(domain.MCPScopeUser),
			mcptool.UserID(uid),
			mcptool.Enabled(true),
			mcptool.DeletedAtIsNil(),
		).
		Order(mcptool.ByNamespacedName(sql.OrderAsc())).
		All(ctx)
	if err != nil {
		return nil, fmt.Errorf("list user mcp tools: %w", err)
	}

	items := make([]*domain.MCPTool, 0, len(platformRows)+len(userRows))
	for _, row := range platformRows {
		items = append(items, toDomainTool(row))
	}
	for _, row := range userRows {
		items = append(items, toDomainTool(row))
	}
	return items, nil
}

func (r *mcpRepo) GetVisibleTool(ctx context.Context, uid, toolID uuid.UUID) (*domain.MCPTool, error) {
	row, err := r.db.MCPTool.Query().
		Where(
			mcptool.ID(toolID),
			mcptool.Enabled(true),
			mcptool.DeletedAtIsNil(),
			mcptool.Or(
				mcptool.Scope(domain.MCPScopePlatform),
				mcptool.And(
					mcptool.Scope(domain.MCPScopeUser),
					mcptool.UserID(uid),
				),
			),
		).
		Only(ctx)
	if err != nil {
		return nil, fmt.Errorf("get visible mcp tool: %w", err)
	}
	return toDomainTool(row), nil
}

func (r *mcpRepo) ListToolSettings(ctx context.Context, uid uuid.UUID) (map[uuid.UUID]bool, error) {
	rows, err := r.db.MCPUserToolSetting.Query().
		Where(mcpusertoolsetting.UserID(uid)).
		All(ctx)
	if err != nil {
		return nil, fmt.Errorf("list mcp tool settings: %w", err)
	}
	settings := make(map[uuid.UUID]bool, len(rows))
	for _, row := range rows {
		settings[row.ToolID] = row.Enabled
	}
	return settings, nil
}

func (r *mcpRepo) UpsertToolSetting(ctx context.Context, uid, toolID uuid.UUID, enabled bool) error {
	row, err := r.db.MCPUserToolSetting.Query().
		Where(
			mcpusertoolsetting.UserID(uid),
			mcpusertoolsetting.ToolID(toolID),
		).
		Only(ctx)
	if err == nil {
		return r.db.MCPUserToolSetting.UpdateOneID(row.ID).SetEnabled(enabled).Exec(ctx)
	}
	if !db.IsNotFound(err) {
		return fmt.Errorf("query mcp tool setting: %w", err)
	}
	return r.db.MCPUserToolSetting.Create().
		SetUserID(uid).
		SetToolID(toolID).
		SetEnabled(enabled).
		Exec(ctx)
}

func (r *mcpRepo) getUserUpstreamRow(ctx context.Context, uid, id uuid.UUID) (*db.MCPUpstream, error) {
	row, err := r.db.MCPUpstream.Query().
		Where(
			mcpupstream.ID(id),
			mcpupstream.Scope(domain.MCPScopeUser),
			mcpupstream.UserID(uid),
		).
		Only(ctx)
	if err != nil {
		return nil, fmt.Errorf("get user mcp upstream: %w", err)
	}
	return row, nil
}

func toDomainUpstream(row *db.MCPUpstream) *domain.MCPUpstream {
	headers := make([]domain.MCPHeader, 0, len(row.Headers))
	for k, v := range row.Headers {
		headers = append(headers, domain.MCPHeader{Name: k, Value: v})
	}
	item := &domain.MCPUpstream{
		ID:              row.ID,
		Name:            row.Name,
		Slug:            row.Slug,
		Scope:           row.Scope,
		Type:            row.Type,
		URL:             row.URL,
		Headers:         headers,
		Description:     row.Description,
		Enabled:         row.Enabled,
		HealthStatus:    row.HealthStatus,
		SyncStatus:      row.SyncStatus,
		HealthCheckedAt: row.HealthCheckedAt,
		LastSyncedAt:    row.LastSyncedAt,
		CreatedAt:       row.CreatedAt,
		UpdatedAt:       row.UpdatedAt,
	}
	if row.UserID != nil {
		item.UserID = *row.UserID
	}
	return item
}

func toDomainTool(row *db.MCPTool) *domain.MCPTool {
	item := &domain.MCPTool{
		ID:             row.ID,
		UpstreamID:     row.UpstreamID,
		Name:           row.Name,
		NamespacedName: row.NamespacedName,
		Scope:          row.Scope,
		Description:    row.Description,
		InputSchema:    row.InputSchema,
		Price:          row.Price,
		Enabled:        true,
		Billable:       row.Scope == domain.MCPScopePlatform && row.Price > 0,
		DeletedAt:      row.DeletedAt,
		CreatedAt:      row.CreatedAt,
		UpdatedAt:      row.UpdatedAt,
	}
	if row.UserID != nil {
		item.UserID = row.UserID
	}
	return item
}

func headersToMap(headers []domain.MCPHeader) map[string]string {
	result := make(map[string]string, len(headers))
	for _, header := range headers {
		if header.Name == "" {
			continue
		}
		result[header.Name] = header.Value
	}
	return result
}
