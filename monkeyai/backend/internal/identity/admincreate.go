package identity

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"log/slog"
	"slices"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/rootgroup"
	"github.com/jackc/pgx/v5/pgtype"
)

var errCreationGroupUnavailable = errors.New("所选分组不存在或已删除")

func normalizeCreationGroups(ids []string) ([]string, error) {
	if len(ids) > 1000 {
		return nil, errors.New("group_ids 最多包含 1000 个分组")
	}
	if ids == nil {
		return nil, nil
	}
	normalized := make([]string, 0, len(ids))
	for _, id := range ids {
		var value pgtype.UUID
		if err := value.Scan(id); err != nil || !value.Valid {
			return nil, errors.New("group_ids 必须包含有效的分组 UUID")
		}
		if value.String() == rootgroup.ID {
			return nil, errors.New("不能直接加入根分组，请选择子分组或留空")
		}
		normalized = append(normalized, value.String())
	}
	slices.Sort(normalized)
	return slices.Compact(normalized), nil
}

// The caller validates and canonicalizes groupIDs before starting the transaction.
func (s *Service) insertUserWithGroups(ctx context.Context, actor string, input sqlc.CreateUserParams, groupIDs []string) (User, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return User{}, err
	}
	defer func() {
		if err := tx.Rollback(ctx); err != nil && !errors.Is(err, pgx.ErrTxClosed) && ctx.Err() == nil {
			slog.ErrorContext(ctx, "回滚创建用户事务失败", "actor_id", actor, "error", err)
		}
	}()
	q := sqlc.New(tx)
	if len(groupIDs) > 0 {
		// Coordinate with group deletion and membership replacement so validation
		// and assignment cannot observe different group states.
		if err := q.LockUserCreationGroups(ctx); err != nil {
			return User{}, err
		}
		groups, err := q.GetUserCreationGroups(ctx, groupIDs)
		if err != nil {
			return User{}, err
		}
		if len(groups) != len(groupIDs) {
			return User{}, errCreationGroupUnavailable
		}
	}
	row, err := q.CreateUser(ctx, input)
	if err != nil {
		return User{}, err
	}
	if len(groupIDs) > 0 {
		if err := q.AssignCreatedUserGroups(ctx, sqlc.AssignCreatedUserGroupsParams{GroupIds: groupIDs, UserID: row.ID, ActorID: actor}); err != nil {
			return User{}, err
		}
		if err := q.TouchUserCreationGroups(ctx, groupIDs); err != nil {
			return User{}, err
		}
	}
	// This user has no prior billing account to preserve. Its initial group
	// membership becomes visible atomically with the user, before any allocation.
	if err := tx.Commit(ctx); err != nil {
		return User{}, err
	}
	return User{ID: row.ID, Name: row.Name, Email: row.Email, AvatarURL: row.AvatarUrl, Role: row.Role, Status: row.Status, JoinedAt: row.JoinedAt, LastLoginAt: row.LastLoginAt}, nil
}
