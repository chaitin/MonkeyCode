package repo

import (
	"context"
	"fmt"
	"strings"

	"entgo.io/ent/dialect/sql"
	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/mcptool"
	"github.com/chaitin/MonkeyCode/backend/db/mcpupstream"
	"github.com/chaitin/MonkeyCode/backend/db/mcpusertoolsetting"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
	"github.com/chaitin/MonkeyCode/backend/pkg/entx"
)

type mcpRepo struct {
	cfg *config.Config
	db  *db.Client
}

func NewMCPRepo(i *do.Injector) (domain.UserMCPRepo, error) {
	return &mcpRepo{
		db:  do.MustInvoke[*db.Client](i),
		cfg: do.MustInvoke[*config.Config](i),
	}, nil
}

func (r *mcpRepo) ListUserUpstreams(ctx context.Context, uid uuid.UUID, _ domain.CursorReq) ([]*domain.MCPUpstream, error) {
	rows, err := r.db.MCPUpstream.Query().
		WithTools().
		WithUser().
		Where(
			mcpupstream.Or(
				mcpupstream.UserID(uid),
				mcpupstream.ScopeEQ(mcpupstream.ScopePlatform),
			),
		).
		Order(mcpupstream.ByCreatedAt(sql.OrderDesc())).
		All(ctx)
	if err != nil {
		return nil, fmt.Errorf("list user mcp upstreams: %w", err)
	}

	settings, err := r.ListToolSettings(ctx, uid)
	if err != nil {
		return nil, err
	}

	platform := &domain.MCPUpstream{
		ID: uuid.Max,
		User: &domain.User{
			Name: "monkeycode-ai",
		},
		Name:    "monkeycode-ai",
		Slug:    "monkeycode-ai",
		Scope:   mcpupstream.ScopePlatform,
		Type:    "",
		URL:     fmt.Sprintf("%s/mcp", strings.TrimSuffix(r.cfg.Server.BaseURL, "/")),
		Headers: []domain.MCPHeader{},
		Enabled: true,
	}
	users := make([]*domain.MCPUpstream, 0)
	for _, u := range rows {
		if u.Scope == mcpupstream.ScopePlatform {
			tools := cvt.Iter(u.Edges.Tools, func(_ int, t *db.MCPTool) *domain.MCPTool {
				tmp := cvt.From(t, &domain.MCPTool{})
				tmp.Enabled = len(settings) == 0 || settings[t.ID]
				return tmp
			})
			platform.Tools = append(platform.Tools, tools...)
		} else {
			users = append(users, cvt.From(u, &domain.MCPUpstream{}))
		}
	}

	return append([]*domain.MCPUpstream{platform}, users...), nil
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
	return cvt.From(row, &domain.MCPUpstream{}), nil
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
	return entx.WithTx2(ctx, r.db, func(tx *db.Tx) error {
		_, err = tx.MCPUpstream.Delete().
			Where(mcpupstream.UserID(uid)).
			Where(mcpupstream.ID(row.ID)).
			Exec(ctx)
		return err
	})
}

func (r *mcpRepo) GetUserUpstream(ctx context.Context, uid, id uuid.UUID) (*domain.MCPUpstream, error) {
	row, err := r.getUserUpstreamRow(ctx, uid, id)
	if err != nil {
		return nil, err
	}
	return cvt.From(row, &domain.MCPUpstream{}), nil
}

func (r *mcpRepo) HasPlatformSlug(ctx context.Context, slug string) (bool, error) {
	return r.db.MCPUpstream.Query().
		Where(
			mcpupstream.ScopeEQ(mcpupstream.ScopePlatform),
			mcpupstream.Slug(slug),
		).
		Exist(ctx)
}

func (r *mcpRepo) ListVisibleTools(ctx context.Context, uid uuid.UUID) ([]*domain.MCPTool, error) {
	platformRows, err := r.db.MCPTool.Query().
		WithUpstream(func(mq *db.MCPUpstreamQuery) { mq.WithUser() }).
		Where(
			mcptool.ScopeEQ(mcptool.ScopePlatform),
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
			mcptool.ScopeEQ(mcptool.ScopeUser),
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
		items = append(items, cvt.From(row, &domain.MCPTool{}))
	}
	for _, row := range userRows {
		items = append(items, cvt.From(row, &domain.MCPTool{}))
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
				mcptool.ScopeEQ(mcptool.ScopePlatform),
				mcptool.And(
					mcptool.ScopeEQ(mcptool.ScopeUser),
					mcptool.UserID(uid),
				),
			),
		).
		Only(ctx)
	if err != nil {
		return nil, fmt.Errorf("get visible mcp tool: %w", err)
	}
	return cvt.From(row, &domain.MCPTool{}), nil
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
	tool, err := r.db.MCPTool.Query().
		Where(mcptool.ID(toolID)).
		First(ctx)

	if err != nil {
		return err
	}

	if tool.Scope == mcptool.ScopePlatform {
		return r.db.MCPUserToolSetting.Create().
			SetUserID(uid).
			SetToolID(toolID).
			SetEnabled(enabled).
			OnConflictColumns(mcpusertoolsetting.FieldUserID, mcpusertoolsetting.FieldToolID).
			SetEnabled(enabled).
			Exec(ctx)
	}

	if tool.UserID == nil {
		return errcode.ErrNotFound.Wrap(fmt.Errorf("user_id is nil"))
	}

	if *tool.UserID != uid {
		return errcode.ErrNotFound.Wrap(fmt.Errorf("user is mismatch"))
	}

	return r.db.MCPTool.Update().
		Where(mcptool.ID(toolID)).
		Where(mcptool.UserID(uid)).
		SetEnabled(enabled).
		Exec(ctx)
}

func (r *mcpRepo) getUserUpstreamRow(ctx context.Context, uid, id uuid.UUID) (*db.MCPUpstream, error) {
	row, err := r.db.MCPUpstream.Query().
		Where(
			mcpupstream.ID(id),
			mcpupstream.ScopeEQ(mcpupstream.ScopeUser),
			mcpupstream.UserID(uid),
		).
		Only(ctx)
	if err != nil {
		return nil, fmt.Errorf("get user mcp upstream: %w", err)
	}
	return row, nil
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
