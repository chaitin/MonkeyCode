package group

import (
	"context"
	"encoding/json"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/group/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Group struct {
	ID        string   `json:"id"`
	ParentID  *string  `json:"parent_id"`
	Name      string   `json:"name"`
	MemberIDs []string `json:"member_ids"`
}

type Input struct {
	Name     *string         `json:"name"`
	ParentID json.RawMessage `json:"parent_id"`
}

type AccountPreserver interface {
	PreserveAccounts(context.Context, pgx.Tx) error
}

type Service struct {
	pool     *pgxpool.Pool
	accounts AccountPreserver
}

func (s *Service) WithAccountPreserver(accounts AccountPreserver) *Service {
	s.accounts = accounts
	return s
}

func NewService(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

func (s *Service) List(ctx context.Context) ([]Group, error) {
	rows, err := sqlc.New(s.pool).ListGroups(ctx)
	if err != nil {
		return nil, err
	}

	groups := []Group{}
	for _, row := range rows {
		var group Group
		group.ID, group.ParentID, group.Name, group.MemberIDs = row.ID, row.ParentID, row.Name, row.MemberIds
		groups = append(groups, group)
	}
	return groups, nil
}

func get(ctx context.Context, tx pgx.Tx, id string) (Group, error) {
	var group Group
	record, err := sqlc.New(tx).GetGroup(ctx, id)
	if err == nil {
		group.ID, group.ParentID, group.Name, group.MemberIDs = record.ID, record.ParentID, record.Name, record.MemberIds
	}

	return group, err
}

func (s *Service) begin(ctx context.Context) (pgx.Tx, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	// 串行化分组写入，避免并发移动绕过祖先校验形成环。
	if _, err = sqlc.New(tx).LockGroups(ctx); err != nil {
		_ = tx.Rollback(ctx)
		return nil, err
	}
	if s.accounts != nil {
		if err = s.accounts.PreserveAccounts(ctx, tx); err != nil {
			_ = tx.Rollback(ctx)
			return nil, err
		}
	}
	return tx, nil
}

func conflict(message string) error {
	return &resource.Error{Status: 409, Code: "group_conflict", Message: message}
}

func (s *Service) Save(ctx context.Context, actor, id string, in Input) (Group, error) {
	if in.Name == nil && len(in.ParentID) == 0 {
		return Group{}, resource.Invalid("请指定分组名称或上级分组")
	}
	if in.Name != nil {
		*in.Name = strings.TrimSpace(*in.Name)
		if *in.Name == "" || utf8.RuneCountInString(*in.Name) > 100 {
			return Group{}, resource.Invalid("分组名称须为 1—100 个字符")
		}
	}
	var parentID *string
	if len(in.ParentID) > 0 {
		if err := json.Unmarshal(in.ParentID, &parentID); err != nil {
			return Group{}, resource.Invalid("parent_id 必须是分组 ID 或 null")
		}
	}
	create := id == ""
	if create && in.Name == nil {
		return Group{}, resource.Invalid("创建分组需要名称")
	}
	tx, err := s.begin(ctx)
	if err != nil {
		return Group{}, err
	}
	defer tx.Rollback(ctx)
	var group Group
	if !create {
		group, err = get(ctx, tx, id)
		if err != nil {
			return Group{}, err
		}
	}
	if parentID != nil {
		parent, err := get(ctx, tx, *parentID)
		if err != nil {
			return Group{}, err
		}
		var cycle bool
		cycle, err = sqlc.New(tx).WouldCreateCycle(ctx, sqlc.WouldCreateCycleParams{ID: parent.ID, GroupID: id})

		if err != nil {
			return Group{}, err
		}
		if cycle {
			return Group{}, conflict("不能移动到自身或子分组中")
		}
	}
	if len(in.ParentID) > 0 {
		group.ParentID = parentID
	}
	if in.Name != nil {
		group.Name = *in.Name
	}
	var duplicate bool
	duplicate, err = sqlc.New(tx).NameExists(ctx, sqlc.NameExistsParams{ParentID: group.ParentID, Name: group.Name, GroupID: id})

	if err != nil {
		return Group{}, err
	}
	if duplicate {
		return Group{}, conflict("同一上级分组下已存在该名称")
	}
	action := "update"
	if create {
		action = "create"

		id, err = sqlc.New(tx).CreateGroup(ctx, sqlc.CreateGroupParams{ParentID: group.ParentID, Name: group.Name, CreatedByUserID: new(actor)})
	} else {
		_, err = sqlc.New(tx).UpdateGroup(ctx, sqlc.UpdateGroupParams{ID: id, ParentID: group.ParentID, Name: group.Name})
	}
	if err != nil {
		return Group{}, err
	}
	group, err = get(ctx, tx, id)
	if err != nil {
		return Group{}, err
	}
	if err = resource.Audit(ctx, tx, actor, "group", id, action); err != nil {
		return Group{}, err
	}
	return group, tx.Commit(ctx)
}

func (s *Service) SetMembers(ctx context.Context, actor, id string, ids []string) (Group, error) {
	if ids == nil || len(ids) > 10000 {
		return Group{}, resource.Invalid("member_ids 必须是数组，最多包含 10000 个成员")
	}
	slices.Sort(ids)
	ids = slices.Compact(ids)
	tx, err := s.begin(ctx)
	if err != nil {
		return Group{}, err
	}
	defer tx.Rollback(ctx)
	group, err := get(ctx, tx, id)
	if err != nil {
		return Group{}, err
	}
	rows, err := sqlc.New(tx).LockMembers(ctx, ids)
	if err != nil {
		return Group{}, err
	}
	count := len(rows)
	if count != len(ids) {
		return Group{}, resource.Invalid("所选成员不存在或已删除")
	}
	if _, err = sqlc.New(tx).RemoveMembers(ctx, sqlc.RemoveMembersParams{GroupID: id, UserIds: ids}); err != nil {
		return Group{}, err
	}
	if _, err = sqlc.New(tx).AddMembers(ctx, sqlc.AddMembersParams{GroupID: id, UserIds: ids, AssignedByUserID: actor}); err != nil {
		return Group{}, err
	}
	if _, err = sqlc.New(tx).TouchGroup(ctx, id); err != nil {
		return Group{}, err
	}
	group, err = get(ctx, tx, id)
	if err != nil {
		return Group{}, err
	}
	if err = resource.Audit(ctx, tx, actor, "group", id, "members"); err != nil {
		return Group{}, err
	}
	return group, tx.Commit(ctx)
}

func (s *Service) Delete(ctx context.Context, actor, id string) error {
	tx, err := s.begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := get(ctx, tx, id); err != nil {
		return err
	}
	var children bool
	children, err = sqlc.New(tx).HasChildren(ctx, new(id))
	if err != nil {
		return err
	}

	if children {
		return conflict("请先移动或删除子分组")
	}
	var assigned bool
	assigned, err = sqlc.New(tx).HasBillingUsers(ctx, new(id))
	if err != nil {
		return err
	}

	if assigned {
		return conflict("请先迁移成员的计费归属")
	}
	if _, err = sqlc.New(tx).DeleteGroup(ctx, id); err != nil {
		return err
	}
	if _, err = sqlc.New(tx).RemoveAllMembers(ctx, id); err != nil {
		return err
	}
	if _, err = sqlc.New(tx).DeleteGrants(ctx, new(id)); err != nil {
		return err
	}
	if err = resource.Audit(ctx, tx, actor, "group", id, "delete"); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
