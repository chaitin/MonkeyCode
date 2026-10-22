package testmember

import (
	"context"
	"errors"
	"time"

	groupdb "github.com/chaitin/MonkeyCode/monkeyai/backend/internal/group/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/member"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Users 只供数据库集成测试显式注入，不参与生产成员与 License 授权。
func Users(pool *pgxpool.Pool) member.UserWriter { return userWriter{pool: pool} }
func Groups() member.GroupWriter                 { return groupWriter{} }

type userWriter struct {
	member.EmptyUserWriter
	pool *pgxpool.Pool
}

func (w userWriter) EnsureInitialAdmin(ctx context.Context, in member.InitialAdmin) error {
	tx, err := w.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(context.WithoutCancel(ctx))
	q := sqlc.New(tx)
	if _, err = q.LockInitialAdmin(ctx); err != nil {
		return err
	}
	count, err := q.CountUsers(ctx)
	if err != nil || count > 0 {
		return err
	}
	hash, err := member.HashPassword(in.Password)
	if err != nil {
		return err
	}
	if _, err = q.CreateInitialAdmin(ctx, sqlc.CreateInitialAdminParams{Name: in.Name, Email: in.Email, PasswordHash: new(hash)}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (w userWriter) TouchLogin(ctx context.Context, id string) error {
	_, err := sqlc.New(w.pool).TouchLogin(ctx, id)
	return err
}
func (w userWriter) CreateUser(ctx context.Context, in member.CreateUser) (member.User, error) {
	tx, err := w.pool.Begin(ctx)
	if err != nil {
		return member.User{}, err
	}
	defer tx.Rollback(context.WithoutCancel(ctx))
	q := sqlc.New(tx)
	if err = q.LockUserCreationGroups(ctx); err != nil {
		return member.User{}, err
	}
	if len(in.GroupIDs) > 0 {
		rows, err := q.GetUserCreationGroups(ctx, in.GroupIDs)
		if err != nil {
			return member.User{}, err
		}
		if len(rows) != len(in.GroupIDs) {
			return member.User{}, member.ErrGroupUnavailable
		}
	}
	var hash *string
	if in.Password != "" {
		value, err := member.HashPassword(in.Password)
		if err != nil {
			return member.User{}, err
		}
		hash = new(value)
	}
	row, err := q.CreateUser(ctx, sqlc.CreateUserParams{Name: in.Name, Email: in.Email, Role: in.Role, PasswordHash: hash})
	if err != nil {
		return member.User{}, err
	}
	if len(in.GroupIDs) > 0 {
		if err = q.AssignCreatedUserGroups(ctx, sqlc.AssignCreatedUserGroupsParams{GroupIds: in.GroupIDs, UserID: row.ID, ActorID: in.ActorID}); err != nil {
			return member.User{}, err
		}
	}
	return member.User{ID: row.ID, Name: row.Name, Email: row.Email, AvatarURL: row.AvatarUrl, Role: row.Role, Status: row.Status, JoinedAt: row.JoinedAt, LastLoginAt: row.LastLoginAt}, tx.Commit(ctx)
}
func (w userWriter) UpdateUser(ctx context.Context, tx pgx.Tx, in member.UpdateUser) (member.User, error) {
	var disabled *time.Time
	if in.Status == "disabled" {
		disabled = new(time.Now())
	}
	row, err := sqlc.New(tx).UpdateUser(ctx, sqlc.UpdateUserParams{ID: in.ID, Name: in.Name, Role: in.Role, Status: in.Status, PasswordHash: in.PasswordHash, DisabledAt: disabled})
	return member.User{ID: row.ID, Name: row.Name, Email: row.Email, AvatarURL: row.AvatarUrl, Role: row.Role, Status: row.Status, JoinedAt: row.JoinedAt, LastLoginAt: row.LastLoginAt}, err
}
func (w userWriter) ResetUserPassword(ctx context.Context, tx pgx.Tx, id, hash string) error {
	_, err := sqlc.New(tx).ResetUserPassword(ctx, sqlc.ResetUserPasswordParams{ID: id, PasswordHash: new(hash)})
	return err
}

type groupWriter struct{}

func (groupWriter) SetMembers(ctx context.Context, tx pgx.Tx, in member.GroupMembers) error {
	q := groupdb.New(tx)
	if _, err := q.RemoveMembers(ctx, groupdb.RemoveMembersParams{GroupID: in.GroupID, UserIds: in.UserIDs}); err != nil {
		return err
	}
	_, err := q.AddMembers(ctx, groupdb.AddMembersParams{GroupID: in.GroupID, UserIds: in.UserIDs, AssignedByUserID: in.ActorID})
	return err
}
func (groupWriter) MoveMembers(ctx context.Context, tx pgx.Tx, in member.MoveMembers) error {
	q := groupdb.New(tx)
	for _, item := range in.Members {
		if item.SourceGroupID != nil && *item.SourceGroupID == member.RootGroupID {
			present, err := q.HasUserInActiveGroup(ctx, item.ID)
			if err != nil {
				return err
			}
			if present {
				return errors.New("成员归属已变化")
			}
		} else if item.SourceGroupID != nil {
			result, err := q.RemoveMember(ctx, groupdb.RemoveMemberParams{UserID: item.ID, GroupID: *item.SourceGroupID})
			if err != nil {
				return err
			}
			if result.RowsAffected() != 1 {
				return errors.New("成员归属已变化")
			}
		}
		if in.TargetGroupID != nil && *in.TargetGroupID != member.RootGroupID {
			if _, err := q.AddMember(ctx, groupdb.AddMemberParams{GroupID: *in.TargetGroupID, UserID: item.ID, AssignedByUserID: in.ActorID}); err != nil {
				return err
			}
		}
	}
	return nil
}
func (groupWriter) RemoveAllMembers(ctx context.Context, tx pgx.Tx, id string) error {
	_, err := groupdb.New(tx).RemoveAllMembers(ctx, id)
	return err
}
