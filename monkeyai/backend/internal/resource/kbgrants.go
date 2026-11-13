package resource

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/audit"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/rootgroup"
	"github.com/jackc/pgx/v5"
)

// SaveKbGrants preserves grant identity and omitted access levels for older clients.
// The caller must hold the knowledge base row lock (or be creating that row).
func SaveKbGrants(ctx context.Context, tx pgx.Tx, id, actor string, raw any, personal bool) error {
	data, err := json.Marshal(raw)
	if err != nil {
		return err
	}
	var entries []Object
	if err = json.Unmarshal(data, &entries); err != nil {
		return Invalid("授权格式无效")
	}
	current, err := Grants(ctx, tx, "kb", id)
	if err != nil {
		return err
	}
	key := func(g Object) string {
		if g.Bool("all_users") || g.String("group_id") == rootgroup.ID {
			return "all"
		}
		if g.String("user_id") != "" {
			return "user:" + strings.ToLower(g.String("user_id"))
		}
		return "group:" + strings.ToLower(g.String("group_id"))
	}
	previous := map[string]Object{}
	for _, g := range current {
		previous[key(g)] = g
	}
	seen := map[string]bool{}
	queries := sqlc.New(tx)
	for _, entry := range entries {
		user, group, all := strings.ToLower(entry.String("user_id")), strings.ToLower(entry.String("group_id")), entry.Bool("all_users")
		if group == rootgroup.ID && user == "" {
			group, all = "", true
		}
		if (all && (user != "" || group != "")) || (!all && ((user == "") == (group == ""))) {
			return Invalid("每条授权必须指定一个用户、分组或全体用户")
		}
		k := key(entry)
		if seen[k] {
			return Invalid("同一授权对象不能重复")
		}
		seen[k] = true
		old := previous[k]
		if personal && all && old == nil {
			return Invalid("个人知识库不支持新增全员授权")
		}
		if user != "" && !validUUID(user) || group != "" && !validUUID(group) {
			return Invalid("授权对象 ID 无效")
		}
		if !all && (old == nil || (entry.String("access_level") != "" && entry.String("access_level") != old.String("access_level"))) {
			exists, err := queries.SubjectExists(ctx, sqlc.SubjectExistsParams{UserID: user, GroupID: group})
			if err != nil {
				return err
			}
			if !exists {
				return Invalid("授权对象不存在")
			}
		}
		level := entry.String("access_level")
		if level == "" {
			level = old.String("access_level")
			if level == "" {
				level = "read_only"
			}
		}
		if level != "read_only" && level != "read_write" {
			return Invalid("权限必须为只读或读写")
		}
		if usage := entry.String("usage_requirement"); usage != "" && usage != "optional" {
			return Invalid("知识库不支持强制应用")
		}
		if old != nil {
			if err = queries.UpdateKbGrant(ctx, sqlc.UpdateKbGrantParams{ID: old.String("id"), AccessLevel: level, UpdatedByUserID: &actor}); err != nil {
				return err
			}
			continue
		}
		if err = queries.CreateKbGrant(ctx, sqlc.CreateKbGrantParams{ResourceID: id, UserID: user, GroupID: group, AllUsers: all, AccessLevel: level, Actor: actor}); err != nil {
			return err
		}
	}
	for k, old := range previous {
		if !seen[k] {
			if err = queries.DeleteKbGrant(ctx, old.String("id")); err != nil {
				return err
			}
		}
	}
	after, err := Grants(ctx, tx, "kb", id)
	if err != nil {
		return err
	}
	if Hash(current) != Hash(after) {
		return audit.Write(ctx, tx, audit.Event{ActorID: actor, Action: "grants", Category: "resource", TargetType: "kb", TargetID: id, Params: Object{"before": current, "after": after}})
	}
	return nil
}
