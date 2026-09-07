package group

import (
	"context"
	"encoding/json"
	"slices"
	"strings"
	"unicode/utf8"

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

const selectSQL = `SELECT g.id,g.parent_id,g.name,ARRAY(
 SELECT gu.user_id::text FROM group_users gu JOIN users u ON u.id=gu.user_id
 WHERE gu.group_id=g.id AND gu.removed_at IS NULL AND u.deleted_at IS NULL ORDER BY gu.user_id
) FROM groups g WHERE g.deleted_at IS NULL`

func (s *Service) List(ctx context.Context) ([]Group, error) {
	rows, err := s.pool.Query(ctx, selectSQL+` ORDER BY g.created_at,g.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	groups := []Group{}
	for rows.Next() {
		var group Group
		if err := rows.Scan(&group.ID, &group.ParentID, &group.Name, &group.MemberIDs); err != nil {
			return nil, err
		}
		groups = append(groups, group)
	}
	return groups, rows.Err()
}

func get(ctx context.Context, tx pgx.Tx, id string) (Group, error) {
	var group Group
	err := tx.QueryRow(ctx, selectSQL+` AND g.id=$1`, id).Scan(&group.ID, &group.ParentID, &group.Name, &group.MemberIDs)
	return group, err
}

func (s *Service) begin(ctx context.Context) (pgx.Tx, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	// 串行化分组写入，避免并发移动绕过祖先校验形成环。
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(741209)`); err != nil {
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
		err = tx.QueryRow(ctx, `WITH RECURSIVE ancestors(id,parent_id) AS (
   SELECT id,parent_id FROM groups WHERE id=$1 AND deleted_at IS NULL
   UNION SELECT g.id,g.parent_id FROM groups g JOIN ancestors a ON g.id=a.parent_id WHERE g.deleted_at IS NULL
  ) SELECT EXISTS(SELECT 1 FROM ancestors WHERE id=NULLIF($2,'')::uuid)`, parent.ID, id).Scan(&cycle)
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
	err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM groups WHERE deleted_at IS NULL AND parent_id IS NOT DISTINCT FROM $1::uuid AND lower(name)=lower($2) AND id IS DISTINCT FROM NULLIF($3,'')::uuid)`, group.ParentID, group.Name, id).Scan(&duplicate)
	if err != nil {
		return Group{}, err
	}
	if duplicate {
		return Group{}, conflict("同一上级分组下已存在该名称")
	}
	action := "update"
	if create {
		action = "create"
		err = tx.QueryRow(ctx, `INSERT INTO groups(parent_id,name,created_by_user_id) VALUES($1,$2,$3) RETURNING id`, group.ParentID, group.Name, actor).Scan(&id)
	} else {
		_, err = tx.Exec(ctx, `UPDATE groups SET parent_id=$2,name=$3,updated_at=now() WHERE id=$1`, id, group.ParentID, group.Name)
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
	rows, err := tx.Query(ctx, `SELECT id FROM users WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL FOR SHARE`, ids)
	if err != nil {
		return Group{}, err
	}
	count := 0
	for rows.Next() {
		count++
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return Group{}, err
	}
	if count != len(ids) {
		return Group{}, resource.Invalid("所选成员不存在或已删除")
	}
	if _, err = tx.Exec(ctx, `UPDATE group_users SET removed_at=now() WHERE group_id=$1 AND removed_at IS NULL AND NOT(user_id=ANY($2::uuid[]))`, id, ids); err != nil {
		return Group{}, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO group_users(group_id,user_id,assigned_by_user_id) SELECT $1,unnest($2::uuid[]),$3 ON CONFLICT (group_id,user_id) WHERE removed_at IS NULL DO NOTHING`, id, ids, actor); err != nil {
		return Group{}, err
	}
	if _, err = tx.Exec(ctx, `UPDATE groups SET updated_at=now() WHERE id=$1`, id); err != nil {
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
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM groups WHERE parent_id=$1 AND deleted_at IS NULL)`, id).Scan(&children); err != nil {
		return err
	}
	if children {
		return conflict("请先移动或删除子分组")
	}
	var assigned bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE billing_group_id=$1 AND deleted_at IS NULL)`, id).Scan(&assigned); err != nil {
		return err
	}
	if assigned {
		return conflict("请先迁移成员的计费归属")
	}
	if _, err = tx.Exec(ctx, `UPDATE groups SET deleted_at=now(),updated_at=now() WHERE id=$1`, id); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `UPDATE group_users SET removed_at=now() WHERE group_id=$1 AND removed_at IS NULL`, id); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM resource_access_grants WHERE group_id=$1`, id); err != nil {
		return err
	}
	if err = resource.Audit(ctx, tx, actor, "group", id, "delete"); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
