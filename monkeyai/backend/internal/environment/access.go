package environment

import (
	"context"
	"sort"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/rootgroup"
)

func validateHostGrants(grants []resource.Object) error {
	seen := map[string]bool{}
	for _, g := range grants {
		user, group, all := g.String("user_id"), g.String("group_id"), g.Bool("all_users")
		if user != "" && !uuid.MatchString(user) || group != "" && !uuid.MatchString(group) {
			return bad("宿主授权对象无效")
		}
		count := 0
		if user != "" {
			count++
		}
		if group != "" {
			count++
		}
		if all {
			count++
		}
		if count != 1 {
			return bad("每条宿主授权须指定用户、分组或全员")
		}
		if g.String("usage_requirement") != "" && g.String("usage_requirement") != "optional" {
			return bad("宿主授权不支持强制应用")
		}
		key := user + ":" + group
		if all || group == rootgroup.ID {
			key = "all"
		}
		if seen[key] {
			return bad("宿主授权对象重复")
		}
		seen[key] = true
	}
	return nil
}

func sameHostGrants(a, b []resource.Object) bool {
	keys := func(grants []resource.Object) []string {
		out := make([]string, 0, len(grants))
		for _, g := range grants {
			user, group, all := g.String("user_id"), g.String("group_id"), g.Bool("all_users")
			if group == rootgroup.ID && user == "" && !all {
				group = ""
				all = true
			}
			usage := g.String("usage_requirement")
			if usage == "" {
				usage = "optional"
			}
			out = append(out, resource.Hash(resource.Object{"user_id": user, "group_id": group, "all_users": all, "usage_requirement": usage}))
		}
		sort.Strings(out)
		return out
	}
	left, right := keys(a), keys(b)
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}

func hostAllowed(ctx context.Context, db resource.Queryer, host, user string) error {
	allowed, err := resource.Allowed(ctx, db, "host", host, user)
	if err != nil {
		return err
	}
	if !allowed {
		return &failure{403, "host_access_denied", "没有该宿主的新建或启动权限"}
	}
	return nil
}
