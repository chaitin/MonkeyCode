package rootgroup

import (
	"context"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/group/sqlc"
	"github.com/jackc/pgx/v5/pgxpool"
)

const ID = "00000000-0000-0000-0000-000000000000"

func Name(ctx context.Context, pool *pgxpool.Pool) (string, error) {
	return sqlc.New(pool).RootName(ctx)
}

func DirectMemberIDs(ctx context.Context, pool *pgxpool.Pool) ([]string, error) {
	return sqlc.New(pool).RootDirectMemberIDs(ctx)
}

func UserGroups(ctx context.Context, pool *pgxpool.Pool) (map[string]string, error) {
	rows, err := sqlc.New(pool).RootUserGroups(ctx, ID)
	if err != nil {
		return nil, err
	}
	groups := make(map[string]string, len(rows))
	for _, row := range rows {
		groups[row.UserID] = row.GroupID
	}
	return groups, nil
}

func ParentID(parent *string) *string {
	if parent == nil {
		id := ID
		return &id
	}
	return parent
}
