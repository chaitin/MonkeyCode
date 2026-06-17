package repo

import (
	"context"
	"fmt"

	"entgo.io/ent/dialect/sql"
	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/mcpupstream"
	"github.com/chaitin/MonkeyCode/backend/db/teamgroup"
	"github.com/chaitin/MonkeyCode/backend/db/teamgroupmcpupstream"
	"github.com/chaitin/MonkeyCode/backend/db/teammember"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/entx"
)

type teamMCPRepo struct {
	db *db.Client
}

func NewTeamMCPRepo(i *do.Injector) (domain.TeamMCPRepo, error) {
	return &teamMCPRepo{db: do.MustInvoke[*db.Client](i)}, nil
}

func (r *teamMCPRepo) ListUpstreams(ctx context.Context, teamID uuid.UUID) ([]*db.MCPUpstream, error) {
	return r.db.MCPUpstream.Query().
		WithTools().
		WithTeamGroupMcpUpstreams(func(q *db.TeamGroupMCPUpstreamQuery) {
			q.WithGroup()
		}).
		Where(
			mcpupstream.ScopeEQ(mcpupstream.ScopeTeam),
			mcpupstream.TeamID(teamID),
		).
		Order(mcpupstream.ByCreatedAt(sql.OrderDesc())).
		All(ctx)
}

func (r *teamMCPRepo) CreateUpstream(ctx context.Context, teamID uuid.UUID, req *domain.CreateTeamMCPUpstreamReq) (*db.MCPUpstream, error) {
	var result *db.MCPUpstream
	err := entx.WithTx2(ctx, r.db, func(tx *db.Tx) error {
		groupIDs, err := r.normalizeGroupIDs(ctx, tx, teamID, req.GroupIDs)
		if err != nil {
			return err
		}

		enabled := true
		if req.Enabled != nil {
			enabled = *req.Enabled
		}
		upstream, err := tx.MCPUpstream.Create().
			SetID(uuid.New()).
			SetName(req.Name).
			SetSlug(req.Slug).
			SetScope(mcpupstream.ScopeTeam).
			SetTeamID(teamID).
			SetType("server").
			SetURL(req.URL).
			SetHeaders(headersToMap(req.Headers)).
			SetDescription(req.Description).
			SetEnabled(enabled).
			Save(ctx)
		if err != nil {
			return err
		}
		if err := r.replaceGroupBindings(ctx, tx, teamID, upstream.ID, groupIDs); err != nil {
			return err
		}
		result, err = tx.MCPUpstream.Query().
			WithTools().
			WithTeamGroupMcpUpstreams(func(q *db.TeamGroupMCPUpstreamQuery) { q.WithGroup() }).
			Where(mcpupstream.ID(upstream.ID)).
			Only(ctx)
		return err
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

func (r *teamMCPRepo) UpdateUpstream(ctx context.Context, teamID uuid.UUID, req *domain.UpdateTeamMCPUpstreamReq) (*db.MCPUpstream, error) {
	var result *db.MCPUpstream
	err := entx.WithTx2(ctx, r.db, func(tx *db.Tx) error {
		row, err := tx.MCPUpstream.Query().
			Where(
				mcpupstream.ID(req.UpstreamID),
				mcpupstream.ScopeEQ(mcpupstream.ScopeTeam),
				mcpupstream.TeamID(teamID),
			).
			Only(ctx)
		if err != nil {
			return err
		}

		update := tx.MCPUpstream.UpdateOneID(row.ID)
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
		if err := update.Exec(ctx); err != nil {
			return err
		}

		if req.GroupIDs != nil {
			groupIDs, err := r.normalizeGroupIDs(ctx, tx, teamID, req.GroupIDs)
			if err != nil {
				return err
			}
			if err := r.replaceGroupBindings(ctx, tx, teamID, row.ID, groupIDs); err != nil {
				return err
			}
		}
		result, err = tx.MCPUpstream.Query().
			WithTools().
			WithTeamGroupMcpUpstreams(func(q *db.TeamGroupMCPUpstreamQuery) { q.WithGroup() }).
			Where(mcpupstream.ID(row.ID)).
			Only(ctx)
		return err
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

func (r *teamMCPRepo) DeleteUpstream(ctx context.Context, teamID, upstreamID uuid.UUID) error {
	return entx.WithTx2(ctx, r.db, func(tx *db.Tx) error {
		if _, err := tx.TeamGroupMCPUpstream.Delete().
			Where(
				teamgroupmcpupstream.TeamID(teamID),
				teamgroupmcpupstream.UpstreamID(upstreamID),
			).
			Exec(ctx); err != nil {
			return err
		}
		_, err := tx.MCPUpstream.Delete().
			Where(
				mcpupstream.ID(upstreamID),
				mcpupstream.ScopeEQ(mcpupstream.ScopeTeam),
				mcpupstream.TeamID(teamID),
			).
			Exec(ctx)
		return err
	})
}

func (r *teamMCPRepo) GetUpstream(ctx context.Context, teamID, upstreamID uuid.UUID) (*db.MCPUpstream, error) {
	return r.db.MCPUpstream.Query().
		Where(
			mcpupstream.ID(upstreamID),
			mcpupstream.ScopeEQ(mcpupstream.ScopeTeam),
			mcpupstream.TeamID(teamID),
		).
		Only(ctx)
}

func (r *teamMCPRepo) HasPlatformSlug(ctx context.Context, slug string) (bool, error) {
	return r.db.MCPUpstream.Query().
		Where(
			mcpupstream.ScopeEQ(mcpupstream.ScopePlatform),
			mcpupstream.Slug(slug),
		).
		Exist(ctx)
}

func (r *teamMCPRepo) GetMember(ctx context.Context, teamID, userID uuid.UUID) (*domain.TeamMember, error) {
	row, err := r.db.TeamMember.Query().
		Where(teammember.TeamID(teamID), teammember.UserID(userID)).
		Only(ctx)
	if err != nil {
		return nil, err
	}
	return (&domain.TeamMember{}).From(row), nil
}

func (r *teamMCPRepo) normalizeGroupIDs(ctx context.Context, tx *db.Tx, teamID uuid.UUID, groupIDs []uuid.UUID) ([]uuid.UUID, error) {
	if len(groupIDs) == 0 {
		return ensureDefaultGroupIDs(ctx, tx, teamID, nil)
	}
	count, err := tx.TeamGroup.Query().
		Where(teamgroup.IDIn(groupIDs...), teamgroup.TeamID(teamID)).
		Count(ctx)
	if err != nil {
		return nil, err
	}
	if count != len(groupIDs) {
		return nil, fmt.Errorf("some group ids do not belong to team %s", teamID)
	}
	return groupIDs, nil
}

func (r *teamMCPRepo) replaceGroupBindings(ctx context.Context, tx *db.Tx, teamID, upstreamID uuid.UUID, groupIDs []uuid.UUID) error {
	if _, err := tx.TeamGroupMCPUpstream.Delete().
		Where(teamgroupmcpupstream.TeamID(teamID), teamgroupmcpupstream.UpstreamID(upstreamID)).
		Exec(ctx); err != nil {
		return err
	}
	builders := make([]*db.TeamGroupMCPUpstreamCreate, 0, len(groupIDs))
	for _, groupID := range groupIDs {
		builders = append(builders, tx.TeamGroupMCPUpstream.Create().
			SetID(uuid.New()).
			SetTeamID(teamID).
			SetGroupID(groupID).
			SetUpstreamID(upstreamID))
	}
	if len(builders) == 0 {
		return nil
	}
	_, err := tx.TeamGroupMCPUpstream.CreateBulk(builders...).Save(ctx)
	return err
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
