package resource

import (
	"context"
	"net/http"
	"slices"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/rootgroup"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

type Shareable interface {
	LockOwned(context.Context, pgx.Tx, string, string) error
	TouchShared(context.Context, pgx.Tx, string) error
}

type ShareResource struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}

type ShareInput struct {
	Resources []ShareResource `json:"resources"`
	UserIDs   []string        `json:"user_ids"`
	GroupIDs  []string        `json:"group_ids"`
}

func SharedUsers(ctx context.Context, q Queryer, kind string, ids []string) (map[string][]Object, error) {
	users := make(map[string][]Object, len(ids))
	if len(ids) == 0 {
		return users, nil
	}
	for _, id := range ids {
		users[id] = []Object{}
	}
	rows, err := sqlc.New(q).ListSharedUsers(ctx, sqlc.ListSharedUsersParams{ResourceType: kind, ResourceIds: ids})
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		users[row.ResourceID] = append(users[row.ResourceID], Object{"id": row.ID, "name": row.Name, "email": row.Email})
	}
	return users, nil
}

func SharedGroups(ctx context.Context, q Queryer, kind string, ids []string) (map[string][]Object, error) {
	groups := make(map[string][]Object, len(ids))
	if len(ids) == 0 {
		return groups, nil
	}
	for _, id := range ids {
		groups[id] = []Object{}
	}
	rows, err := sqlc.New(q).ListSharedGroups(ctx, sqlc.ListSharedGroupsParams{ResourceType: kind, ResourceIds: ids})
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		groups[row.ResourceID] = append(groups[row.ResourceID], Object{"id": row.ID, "name": row.Name, "parent_id": row.ParentID})
	}
	return groups, nil
}

func (s *Store) RegisterSharing(router chi.Router, kinds map[string]Shareable) {
	share := func(w http.ResponseWriter, r *http.Request) {
		var input ShareInput
		if err := Decode(w, r, &input); err != nil {
			Fail(w, err)
			return
		}
		user, _ := identity.UserFromContext(r.Context())
		if err := s.Share(r.Context(), user.ID, input, r.Method == http.MethodDelete, kinds); err != nil {
			Fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
	router.Post("/resources/shares", share)
	router.Delete("/resources/shares", share)
}

func (s *Store) Share(ctx context.Context, actor string, input ShareInput, revoke bool, kinds map[string]Shareable) error {
	if len(input.Resources) == 0 || len(input.Resources) > 100 || len(input.UserIDs)+len(input.GroupIDs) == 0 || len(input.UserIDs)+len(input.GroupIDs) > 100 {
		return Invalid("resources 必须包含 1—100 项，user_ids 和 group_ids 合计必须包含 1—100 项")
	}
	input.Resources = slices.Clone(input.Resources)
	input.UserIDs = slices.Clone(input.UserIDs)
	input.GroupIDs = slices.Clone(input.GroupIDs)
	for _, item := range input.Resources {
		if kinds[item.Type] == nil {
			return Invalid("不支持分享此资源类型")
		}
		if !validUUID(item.ID) {
			return Invalid("资源 ID 必须是 UUID")
		}
	}
	for _, id := range input.UserIDs {
		if !validUUID(id) {
			return Invalid("用户 ID 必须是 UUID")
		}
		if strings.EqualFold(id, actor) {
			return Invalid("不能分享给自己")
		}
	}
	for _, id := range input.GroupIDs {
		if !validUUID(id) || strings.EqualFold(id, rootgroup.ID) {
			return Invalid("分组 ID 必须是真实分组的 UUID")
		}
	}
	for i := range input.Resources {
		input.Resources[i].ID = strings.ToLower(input.Resources[i].ID)
	}
	for i := range input.UserIDs {
		input.UserIDs[i] = strings.ToLower(input.UserIDs[i])
	}
	for i := range input.GroupIDs {
		input.GroupIDs[i] = strings.ToLower(input.GroupIDs[i])
	}
	slices.SortFunc(input.Resources, func(a, b ShareResource) int {
		if n := strings.Compare(a.Type, b.Type); n != 0 {
			return n
		}
		return strings.Compare(a.ID, b.ID)
	})
	input.Resources = slices.Compact(input.Resources)
	slices.Sort(input.UserIDs)
	input.UserIDs = slices.Compact(input.UserIDs)
	slices.Sort(input.GroupIDs)
	input.GroupIDs = slices.Compact(input.GroupIDs)
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { rollback(ctx, tx, "share", input.Resources[0].ID) }()
	if !revoke && len(input.GroupIDs) > 0 {
		groups, err := sqlc.New(tx).LockShareGroups(ctx, input.GroupIDs)
		if err != nil {
			return err
		}
		if len(groups) != len(input.GroupIDs) {
			return Invalid("接收分组不存在或已删除")
		}
	}
	// 固定加锁顺序，批量授权和删除共享资源行锁。
	for _, item := range input.Resources {
		if err := kinds[item.Type].LockOwned(ctx, tx, item.ID, actor); err != nil {
			return err
		}
	}
	if !revoke && len(input.UserIDs) > 0 {
		rows, err := sqlc.New(tx).LockRecipients(ctx, input.UserIDs)
		if err != nil {
			return err
		}
		count := len(rows)
		if count != len(input.UserIDs) {
			return Invalid("接收用户不存在或已停用")
		}
	}
	for _, item := range input.Resources {
		if revoke {
			if len(input.UserIDs) > 0 {
				_, err = sqlc.New(tx).RevokeShares(ctx, sqlc.RevokeSharesParams{ResourceType: item.Type, ResourceID: item.ID, UserIds: input.UserIDs})
			}
			if err == nil && len(input.GroupIDs) > 0 {
				_, err = sqlc.New(tx).RevokeGroupShares(ctx, sqlc.RevokeGroupSharesParams{ResourceType: item.Type, ResourceID: item.ID, GroupIds: input.GroupIDs})
			}
		} else {
			if len(input.UserIDs) > 0 {
				_, err = sqlc.New(tx).CreateShares(ctx, sqlc.CreateSharesParams{ResourceType: item.Type, ResourceID: item.ID, GrantedByUserID: actor, UserIds: input.UserIDs})
			}
			if err == nil && len(input.GroupIDs) > 0 {
				_, err = sqlc.New(tx).CreateGroupShares(ctx, sqlc.CreateGroupSharesParams{ResourceType: item.Type, ResourceID: item.ID, GrantedByUserID: actor, GroupIds: input.GroupIDs})
			}
		}
		if err != nil {
			return err
		}
		if err = kinds[item.Type].TouchShared(ctx, tx, item.ID); err != nil {
			return err
		}
		action := "share"
		if revoke {
			action = "unshare"
		}
		if err = Audit(ctx, tx, actor, item.Type, item.ID, action); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func validUUID(id string) bool {
	if len(id) != 36 {
		return false
	}
	for i, ch := range id {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			if ch != '-' {
				return false
			}
		} else if !(ch >= '0' && ch <= '9' || ch >= 'a' && ch <= 'f' || ch >= 'A' && ch <= 'F') {
			return false
		}
	}
	return true
}
