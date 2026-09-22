package group

import (
	"context"
	"slices"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/group/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/rootgroup"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type MoveMember struct {
	ID            string  `json:"id"`
	SourceGroupID *string `json:"source_group_id"`
}

type MoveInput struct {
	TargetID string       `json:"target_id"`
	GroupIDs []string     `json:"group_ids"`
	Members  []MoveMember `json:"members"`
}

func validMoveID(id string) bool {
	var value pgtype.UUID
	return value.Scan(id) == nil && value.Valid
}

func (s *Service) Move(ctx context.Context, actor string, in MoveInput) error {
	if !validMoveID(in.TargetID) || len(in.GroupIDs) > 100 || len(in.Members) > 1000 ||
		(len(in.GroupIDs) == 0) == (len(in.Members) == 0) {
		return resource.Invalid("请选择同一类型的分组或成员并指定目标分组")
	}
	if in.TargetID == rootgroup.ID && len(in.Members) > 0 {
		for _, member := range in.Members {
			if member.SourceGroupID == nil || *member.SourceGroupID == rootgroup.ID {
				return resource.Invalid("从成员列表或根分组移动到根分组不会改变成员关系")
			}
		}
	}
	tx, err := s.begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var target *string
	if in.TargetID != rootgroup.ID {
		if _, err := get(ctx, tx, in.TargetID); err != nil {
			return err
		}
		target = &in.TargetID
	}
	if len(in.GroupIDs) > 0 {
		err = moveGroups(ctx, tx, actor, target, in.GroupIDs)
	} else {
		err = moveMembers(ctx, tx, actor, target, in.Members)
	}
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func moveGroups(ctx context.Context, tx pgx.Tx, actor string, target *string, ids []string) error {
	seenIDs := map[string]bool{}
	seenNames := map[string]bool{}
	groups := make([]Group, 0, len(ids))
	queries := sqlc.New(tx)
	for _, id := range ids {
		if !validMoveID(id) || id == rootgroup.ID || seenIDs[id] {
			return resource.Invalid("所选分组无效或重复")
		}
		seenIDs[id] = true
		group, err := get(ctx, tx, id)
		if err != nil {
			return err
		}
		if group.ParentID != nil && target != nil && *group.ParentID == *target || group.ParentID == nil && target == nil {
			return resource.Invalid("分组已位于目标分组下")
		}
		name := strings.ToLower(group.Name)
		if seenNames[name] {
			return conflict("目标分组下不能有重名分组")
		}
		seenNames[name] = true
		if target != nil {
			cycle, err := queries.WouldCreateCycle(ctx, sqlc.WouldCreateCycleParams{ID: *target, GroupID: id})
			if err != nil {
				return err
			}
			if cycle {
				return conflict("不能移动到自身或子分组中")
			}
		}
		duplicate, err := queries.NameExists(ctx, sqlc.NameExistsParams{ParentID: target, Name: group.Name, GroupID: id})
		if err != nil {
			return err
		}
		if duplicate {
			return conflict("同一上级分组下已存在该名称")
		}
		groups = append(groups, group)
	}
	for _, group := range groups {
		for ancestor := group.ParentID; ancestor != nil; {
			if seenIDs[*ancestor] {
				return resource.Invalid("不能同时移动父分组和子分组；移动父分组会保留其子分组")
			}
			parent, err := get(ctx, tx, *ancestor)
			if err != nil {
				return err
			}
			ancestor = parent.ParentID
		}
	}
	for _, group := range groups {
		if _, err := queries.UpdateGroup(ctx, sqlc.UpdateGroupParams{ID: group.ID, ParentID: target, Name: group.Name}); err != nil {
			return err
		}
		if err := resource.Audit(ctx, tx, actor, "group", group.ID, "update"); err != nil {
			return err
		}
	}
	return nil
}

func moveMembers(ctx context.Context, tx pgx.Tx, actor string, target *string, members []MoveMember) error {
	ids := make([]string, 0, len(members))
	seen := map[string]bool{}
	for _, member := range members {
		if !validMoveID(member.ID) {
			return resource.Invalid("成员 ID 无效")
		}
		if member.SourceGroupID != nil && !validMoveID(*member.SourceGroupID) {
			return resource.Invalid("来源分组 ID 无效")
		}
		key := member.ID + ":"
		if member.SourceGroupID != nil {
			key += *member.SourceGroupID
		}
		if seen[key] {
			return resource.Invalid("成员与来源分组不能重复")
		}
		seen[key] = true
		ids = append(ids, member.ID)
	}
	slices.Sort(ids)
	ids = slices.Compact(ids)
	locked, err := sqlc.New(tx).LockMembers(ctx, ids)
	if err != nil {
		return err
	}
	if len(locked) != len(ids) {
		return resource.Invalid("所选成员不存在或已删除")
	}
	queries := sqlc.New(tx)
	for _, member := range members {
		if member.SourceGroupID == nil {
			continue
		}
		source := *member.SourceGroupID
		if source == rootgroup.ID {
			assigned, err := queries.HasUserInActiveGroup(ctx, member.ID)
			if err != nil {
				return err
			}
			if assigned {
				return conflict("所选成员已不在根分组直属成员中，请刷新后重试")
			}
			continue
		}
		if _, err := get(ctx, tx, source); err != nil {
			return err
		}
		present, err := queries.HasActiveMember(ctx, sqlc.HasActiveMemberParams{GroupID: source, UserID: member.ID})
		if err != nil {
			return err
		}
		if !present {
			return conflict("所选成员已不在来源分组中，请刷新后重试")
		}
		if target != nil && source == *target {
			return resource.Invalid("来源分组和目标分组不能相同")
		}
	}
	changed := map[string]bool{}
	for _, member := range members {
		if member.SourceGroupID != nil && *member.SourceGroupID != rootgroup.ID {
			id := *member.SourceGroupID
			if _, err := queries.RemoveMember(ctx, sqlc.RemoveMemberParams{GroupID: id, UserID: member.ID}); err != nil {
				return err
			}
			changed[id] = true
		}
		if target != nil {
			if _, err := queries.AddMember(ctx, sqlc.AddMemberParams{GroupID: *target, UserID: member.ID, AssignedByUserID: actor}); err != nil {
				return err
			}
			changed[*target] = true
		}
	}
	for id := range changed {
		if _, err := queries.TouchGroup(ctx, id); err != nil {
			return err
		}
		if err := resource.Audit(ctx, tx, actor, "group", id, "members"); err != nil {
			return err
		}
	}
	return nil
}
