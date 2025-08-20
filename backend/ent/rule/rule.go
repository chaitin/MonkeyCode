package rule

import (
	"context"
	"fmt"
	"log/slog"
	"slices"

	"entgo.io/ent"
	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/adminloginhistory"
	"github.com/chaitin/MonkeyCode/backend/db/securityscanning"
	"github.com/chaitin/MonkeyCode/backend/db/task"
	"github.com/chaitin/MonkeyCode/backend/db/user"
	"github.com/chaitin/MonkeyCode/backend/db/usergroup"
	"github.com/chaitin/MonkeyCode/backend/db/usergroupadmin"
	"github.com/chaitin/MonkeyCode/backend/db/userloginhistory"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
)

type PermissionKey struct{}
type skipPermissionCheckKey struct{}

func SkipPermission(ctx context.Context) context.Context {
	return context.WithValue(ctx, skipPermissionCheckKey{}, struct{}{})
}

type PermissionHook struct {
	logger *slog.Logger
	next   ent.Mutator
}

// Mutate implements ent.Mutator.
func (p PermissionHook) Mutate(ctx context.Context, m ent.Mutation) (ent.Value, error) {
	p.logger.With(
		"mType", fmt.Sprintf("%T", m),
		"op", m.Op().String(),
		"type", m.Type(),
	).DebugContext(ctx, "[PermissionHook] mutate")

	if v := ctx.Value(skipPermissionCheckKey{}); v != nil {
		return p.next.Mutate(ctx, m)
	}

	perm, ok := ctx.Value(PermissionKey{}).(*domain.Permissions)
	if !ok {
		// 没有权限，直接返回. 用于向后兼容
		return p.next.Mutate(ctx, m)
	}

	if perm.IsAdmin {
		return p.next.Mutate(ctx, m)
	}

	switch m.Op() {
	case ent.OpCreate, ent.OpUpdate, ent.OpDelete, ent.OpDeleteOne, ent.OpUpdateOne:
		switch m.Type() {
		case "Model", "Admin", "Setting", "AdminRole", "UserGroup", "UserGroupUser":
			return nil, errcode.ErrPermission.Wrap(fmt.Errorf("model mutation is not allowed"))
		}
	}

	if val, ok := m.Field("user_id"); ok {
		id, ok := val.(uuid.UUID)
		if !ok {
			return nil, fmt.Errorf("user_id is not uuid")
		}
		if !slices.Contains(perm.UserIDs, id) {
			return nil, fmt.Errorf("no user:[%s] permission", id)
		}
	}
	if val, ok := m.Field("user_group_id"); ok {
		id, ok := val.(uuid.UUID)
		if !ok {
			return nil, fmt.Errorf("user_group_id is not uuid")
		}
		if !slices.Contains(perm.GroupIDs, id) {
			return nil, fmt.Errorf("no user_group:[%s] permission", id)
		}
	}
	return p.next.Mutate(ctx, m)
}

var _ ent.Mutator = PermissionHook{}

func PermissionHookFunc(logger *slog.Logger) ent.Hook {
	return func(next ent.Mutator) ent.Mutator {
		return PermissionHook{logger: logger, next: next}
	}
}

func WithPermission(ctx context.Context, next ent.Querier, q ent.Query, fn func(context.Context, *domain.Permissions) error) (ent.Value, error) {
	perm, ok := ctx.Value(PermissionKey{}).(*domain.Permissions)
	if !ok {
		return nil, fmt.Errorf("no permission by interceptor")
	}
	if perm.IsAdmin {
		return next.Query(ctx, q)
	}
	if err := fn(ctx, perm); err != nil {
		return nil, err
	}
	return next.Query(ctx, q)
}

func PermissionInterceptor(logger *slog.Logger) ent.Interceptor {
	return ent.InterceptFunc(func(next ent.Querier) ent.Querier {
		return ent.QuerierFunc(func(ctx context.Context, q ent.Query) (ent.Value, error) {
			if v := ctx.Value(skipPermissionCheckKey{}); v != nil {
				return next.Query(ctx, q)
			}

			switch qq := q.(type) {
			case *db.UserGroupQuery:
				return WithPermission(ctx, next, q, func(ctx context.Context, p *domain.Permissions) error {
					qq.Where(
						usergroup.Or(
							usergroup.AdminID(p.AdminID),
							usergroup.HasUserGroupAdminsWith(usergroupadmin.AdminID(p.AdminID)),
						),
					)
					return nil
				})

			case *db.TaskQuery:
				return WithPermission(ctx, next, q, func(ctx context.Context, p *domain.Permissions) error {
					qq.Where(task.UserIDIn(p.UserIDs...))
					return nil
				})

			case *db.SecurityScanningQuery:
				return WithPermission(ctx, next, q, func(ctx context.Context, p *domain.Permissions) error {
					qq.Where(securityscanning.UserIDIn(p.UserIDs...))
					return nil
				})

			case *db.UserLoginHistoryQuery:
				return WithPermission(ctx, next, q, func(ctx context.Context, p *domain.Permissions) error {
					qq.Where(userloginhistory.UserIDIn(p.UserIDs...))
					return nil
				})

			case *db.AdminLoginHistoryQuery:
				return WithPermission(ctx, next, q, func(ctx context.Context, p *domain.Permissions) error {
					// 普通管理员登录历史记录只能查询自己的
					qq.Where(adminloginhistory.AdminID(p.AdminID))
					return nil
				})

			case *db.UserQuery:
				admin, ok := ctx.Value(PermissionKey{}).(*domain.Permissions)
				if ok && admin.AdminID != uuid.Nil && !admin.IsAdmin {
					qq.Where(user.IDIn(admin.UserIDs...))
				}
			}
			return next.Query(ctx, q)
		})
	})
}
