package repo

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"entgo.io/ent/dialect/sql"
	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/mcptool"
	"github.com/chaitin/MonkeyCode/backend/db/teamgroupmcpupstream"
	"github.com/chaitin/MonkeyCode/backend/db/teamgroupmember"
	"github.com/chaitin/MonkeyCode/backend/pkg/entx"
)

type ToolSnapshot struct {
	ID             uuid.UUID       `json:"id"`
	Name           string          `json:"name,omitempty"`
	UpstreamID     uuid.UUID       `json:"upstream_id,omitempty"`
	NamespacedName string          `json:"namespaced_name"`
	Description    string          `json:"description,omitempty"`
	InputSchema    json.RawMessage `json:"input_schema"`
	Scope          string          `json:"scope,omitempty"`
	UserID         *uuid.UUID      `json:"user_id,omitempty"`
	TeamID         *uuid.UUID      `json:"team_id,omitempty"`
	Price          int64           `json:"price,omitempty"`
	Enabled        bool            `json:"enabled"`
	DeletedAt      *time.Time      `json:"deleted_at,omitempty"`
}

type ToolReader interface {
	ListPlatformPublishedTools(ctx context.Context) ([]ToolSnapshot, error)
	ListUserPublishedTools(ctx context.Context, userID uuid.UUID) ([]ToolSnapshot, error)
	ListTeamPublishedTools(ctx context.Context, userID uuid.UUID) ([]ToolSnapshot, error)
}

type ToolRepo struct {
	db *db.Client
}

func NewToolRepo(client *db.Client) *ToolRepo {
	return &ToolRepo{db: client}
}

type UpsertToolInput struct {
	UpstreamID     uuid.UUID
	Name           string
	NamespacedName string
	Scope          string
	UserID         *uuid.UUID
	TeamID         *uuid.UUID
	Description    string
	InputSchema    json.RawMessage
	VersionHash    string
	Price          int64
}

func (r *ToolRepo) ListPlatformPublishedTools(ctx context.Context) ([]ToolSnapshot, error) {
	rows, err := r.db.MCPTool.Query().
		Where(mcptool.ScopeEQ(mcptool.ScopePlatform)).
		Order(mcptool.ByNamespacedName(sql.OrderAsc())).
		All(ctx)
	if err != nil {
		return nil, fmt.Errorf("query platform mcp tools: %w", err)
	}
	return toToolSnapshots(rows)
}

func (r *ToolRepo) ListUserPublishedTools(ctx context.Context, userID uuid.UUID) ([]ToolSnapshot, error) {
	rows, err := r.db.MCPTool.Query().
		Where(
			mcptool.ScopeEQ(mcptool.ScopeUser),
			mcptool.UserID(userID),
		).
		Order(mcptool.ByNamespacedName(sql.OrderAsc())).
		All(ctx)
	if err != nil {
		return nil, fmt.Errorf("query user mcp tools: %w", err)
	}
	return toToolSnapshots(rows)
}

func (r *ToolRepo) ListTeamPublishedTools(ctx context.Context, userID uuid.UUID) ([]ToolSnapshot, error) {
	memberships, err := r.db.TeamGroupMember.Query().
		Where(teamgroupmember.UserID(userID)).
		All(ctx)
	if err != nil {
		return nil, fmt.Errorf("query team group memberships: %w", err)
	}
	if len(memberships) == 0 {
		return nil, nil
	}

	groupIDs := make([]uuid.UUID, 0, len(memberships))
	for _, membership := range memberships {
		groupIDs = append(groupIDs, membership.GroupID)
	}

	bindings, err := r.db.TeamGroupMCPUpstream.Query().
		Where(teamgroupmcpupstream.GroupIDIn(groupIDs...)).
		All(ctx)
	if err != nil {
		return nil, fmt.Errorf("query team mcp upstream bindings: %w", err)
	}
	if len(bindings) == 0 {
		return nil, nil
	}

	upstreamIDs := make([]uuid.UUID, 0, len(bindings))
	seen := make(map[uuid.UUID]struct{}, len(bindings))
	for _, binding := range bindings {
		if _, ok := seen[binding.UpstreamID]; ok {
			continue
		}
		seen[binding.UpstreamID] = struct{}{}
		upstreamIDs = append(upstreamIDs, binding.UpstreamID)
	}

	rows, err := r.db.MCPTool.Query().
		Where(
			mcptool.ScopeEQ(mcptool.ScopeTeam),
			mcptool.UpstreamIDIn(upstreamIDs...),
		).
		Order(mcptool.ByNamespacedName(sql.OrderAsc())).
		All(ctx)
	if err != nil {
		return nil, fmt.Errorf("query team mcp tools: %w", err)
	}
	return toToolSnapshots(rows)
}

func toToolSnapshots(rows []*db.MCPTool) ([]ToolSnapshot, error) {
	tools := make([]ToolSnapshot, 0, len(rows))
	for _, row := range rows {
		schemaBytes, err := json.Marshal(row.InputSchema)
		if err != nil {
			return nil, fmt.Errorf("marshal mcp tool schema %s: %w", row.ID, err)
		}
		if len(schemaBytes) == 0 {
			schemaBytes = []byte(`{}`)
		}

		var deletedAt *time.Time
		if !row.DeletedAt.IsZero() {
			deletedAt = &row.DeletedAt
		}

		tools = append(tools, ToolSnapshot{
			ID:             row.ID,
			Name:           row.Name,
			UpstreamID:     row.UpstreamID,
			NamespacedName: row.NamespacedName,
			Description:    row.Description,
			InputSchema:    schemaBytes,
			Scope:          string(row.Scope),
			UserID:         row.UserID,
			TeamID:         row.TeamID,
			Price:          row.Price,
			Enabled:        row.Enabled,
			DeletedAt:      deletedAt,
		})
	}
	return tools, nil
}

func (r *ToolRepo) ReplaceByUpstream(ctx context.Context, upstreamID uuid.UUID, rows []UpsertToolInput) error {
	queryCtx := entx.SkipSoftDelete(ctx)
	existingRows, err := r.db.MCPTool.Query().
		Where(mcptool.UpstreamID(upstreamID)).
		All(queryCtx)
	if err != nil {
		return fmt.Errorf("query upstream tools %s: %w", upstreamID, err)
	}

	existingByName := make(map[string]*db.MCPTool, len(existingRows))
	for _, row := range existingRows {
		existingByName[row.NamespacedName] = row
	}

	seen := make(map[string]struct{}, len(rows))
	now := time.Now()
	for _, row := range rows {
		seen[row.NamespacedName] = struct{}{}
		schemaMap, err := rawToMap(row.InputSchema)
		if err != nil {
			return fmt.Errorf("decode tool schema %s: %w", row.NamespacedName, err)
		}

		if current, ok := existingByName[row.NamespacedName]; ok {
			update := r.db.MCPTool.UpdateOneID(current.ID).
				SetName(row.Name).
				SetScope(mcptool.Scope(row.Scope)).
				SetDescription(row.Description).
				SetInputSchema(schemaMap).
				SetVersionHash(row.VersionHash).
				SetSyncedAt(now).
				SetPrice(row.Price)
			if row.UserID != nil {
				update = update.SetUserID(*row.UserID)
			} else {
				update = update.ClearUserID()
			}
			if row.TeamID != nil {
				update = update.SetTeamID(*row.TeamID)
			} else {
				update = update.ClearTeamID()
			}
			if !current.DeletedAt.IsZero() {
				update = update.ClearDeletedAt()
			}
			if err := update.Exec(queryCtx); err != nil {
				return fmt.Errorf("update tool %s: %w", row.NamespacedName, err)
			}
			continue
		}

		if _, err := r.db.MCPTool.Create().
			SetUpstreamID(row.UpstreamID).
			SetName(row.Name).
			SetNamespacedName(row.NamespacedName).
			SetScope(mcptool.Scope(row.Scope)).
			SetNillableUserID(row.UserID).
			SetNillableTeamID(row.TeamID).
			SetDescription(row.Description).
			SetInputSchema(schemaMap).
			SetPrice(row.Price).
			SetVersionHash(row.VersionHash).
			SetSyncedAt(now).
			Save(ctx); err != nil {
			return fmt.Errorf("create tool %s: %w", row.NamespacedName, err)
		}
	}

	for _, current := range existingRows {
		if _, ok := seen[current.NamespacedName]; ok {
			continue
		}
		if current.DeletedAt.IsZero() {
			if err := r.db.MCPTool.DeleteOneID(current.ID).Exec(ctx); err != nil {
				return fmt.Errorf("delete stale tool %s: %w", current.NamespacedName, err)
			}
		}
	}

	return nil
}
