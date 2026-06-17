package repo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/mcpupstream"
)

var ErrUpstreamNotFound = errors.New("mcp upstream not found")

type UpstreamConfig struct {
	ID      uuid.UUID
	Name    string
	Slug    string
	Scope   string
	UserID  *uuid.UUID
	TeamID  *uuid.UUID
	URL     string
	Headers map[string]string
	Enabled bool
}

type UpstreamTool struct {
	Name        string
	Description string
	InputSchema json.RawMessage
}

type UpstreamReader interface {
	Get(ctx context.Context, id uuid.UUID) (*UpstreamConfig, error)
}

type UpstreamRepo struct {
	db *db.Client
}

func NewUpstreamRepo(client *db.Client) *UpstreamRepo {
	return &UpstreamRepo{db: client}
}

func (r *UpstreamRepo) Get(ctx context.Context, id uuid.UUID) (*UpstreamConfig, error) {
	row, err := r.db.MCPUpstream.Query().
		Where(mcpupstream.ID(id)).
		Only(ctx)
	if err != nil {
		if db.IsNotFound(err) {
			return nil, fmt.Errorf("get upstream %s: %w", id, ErrUpstreamNotFound)
		}
		return nil, fmt.Errorf("get upstream %s: %w", id, err)
	}

	headers := row.Headers
	if headers == nil {
		headers = map[string]string{}
	}

	return &UpstreamConfig{
		ID:      row.ID,
		Name:    row.Name,
		Slug:    row.Slug,
		Scope:   string(row.Scope),
		UserID:  row.UserID,
		TeamID:  row.TeamID,
		URL:     row.URL,
		Headers: headers,
		Enabled: row.Enabled,
	}, nil
}

func (r *UpstreamRepo) MarkSyncSuccess(ctx context.Context, id uuid.UUID) error {
	if err := r.db.MCPUpstream.UpdateOneID(id).
		SetSyncStatus("success").
		SetLastSyncedAt(time.Now()).
		Exec(ctx); err != nil {
		return fmt.Errorf("mark upstream %s sync success: %w", id, err)
	}
	return nil
}

func (r *UpstreamRepo) MarkSyncFailed(ctx context.Context, id uuid.UUID) error {
	if err := r.db.MCPUpstream.UpdateOneID(id).
		SetSyncStatus("failed").
		Exec(ctx); err != nil {
		return fmt.Errorf("mark upstream %s sync failed: %w", id, err)
	}
	return nil
}

func IsUpstreamNotFound(err error) bool {
	return errors.Is(err, ErrUpstreamNotFound)
}
