package repo

import (
	"context"
	"fmt"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/mcpusertoolsetting"
)

type UserToolSettingReader interface {
	ListEnabledMap(ctx context.Context, userID uuid.UUID) (map[uuid.UUID]bool, error)
}

type UserToolSettingRepo struct {
	db *db.Client
}

func NewUserToolSettingRepo(client *db.Client) *UserToolSettingRepo {
	return &UserToolSettingRepo{db: client}
}

func (r *UserToolSettingRepo) ListEnabledMap(ctx context.Context, userID uuid.UUID) (map[uuid.UUID]bool, error) {
	rows, err := r.db.MCPUserToolSetting.Query().
		Where(mcpusertoolsetting.UserID(userID)).
		All(ctx)
	if err != nil {
		return nil, fmt.Errorf("query mcp user tool settings: %w", err)
	}
	settings := make(map[uuid.UUID]bool, len(rows))
	for _, row := range rows {
		settings[row.ToolID] = row.Enabled
	}
	return settings, nil
}
