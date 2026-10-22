package stats

import (
	"net/url"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestResourceUserAvatars(t *testing.T) {
	s, user, _ := fixture(t)
	other := resource.ID()
	const otherAvatar = "https://example.com/other-avatar.webp"
	exec(t, s, `INSERT INTO users(id,name,email,avatar_url) VALUES($1,'另一用户','resource-avatar@example.com',$2)`, other, otherAvatar)
	for index, owner := range []string{user, other} {
		resourceSession(t, s, owner, s.now().Add(-time.Duration(index+1)*time.Hour), 5, 1, true)
	}
	for _, tc := range []struct {
		name   string
		stored any
		want   any
	}{
		{"url", "https://example.com/avatar.webp", "https://example.com/avatar.webp"},
		{"changed", "https://example.com/new-avatar.webp", "https://example.com/new-avatar.webp"},
		{"trimmed", " https://example.com/avatar.webp ", "https://example.com/avatar.webp"},
		{"empty", "", nil}, {"blank", "   ", nil}, {"null", nil, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			exec(t, s, `UPDATE users SET avatar_url=$2 WHERE id=$1`, user, tc.stored)
			seen := make(map[string]bool)
			owners := make(map[string]int)
			query := url.Values{"limit": {"1"}}
			for page := 0; page < 6; page++ {
				out := request(t, s, resourceUsagePath+"?"+query.Encode(), 200)
				items := out["items"].([]any)
				if len(items) != 1 {
					t.Fatalf("头像字段不应改变分页条数: %d", len(items))
				}
				item := items[0].(map[string]any)
				key := item["sort_key"].(string)
				if seen[key] {
					t.Fatalf("重复分页记录: %s", key)
				}
				seen[key] = true
				owner := item["user_id"].(string)
				owners[owner]++
				want, name, email := tc.want, "统计用户", "stats@example.com"
				if owner == other {
					want, name, email = otherAvatar, "另一用户", "resource-avatar@example.com"
				} else if owner != user {
					t.Fatalf("混入其他用户: %s", owner)
				}
				avatar, present := item["user_avatar_url"]
				if !present || avatar != want || item["user_name"] != name || item["user_email"] != email {
					t.Fatalf("用户头像或归属错误: owner=%s avatar=%v want=%v", owner, avatar, want)
				}
				if page < 5 {
					cursor, _ := out["next_cursor"].(string)
					if cursor == "" {
						t.Fatal("缺少下一页游标")
					}
					query.Set("cursor", cursor)
				} else if out["next_cursor"] != nil {
					t.Fatal("最后一页不应有游标")
				}
			}
			if owners[user] != 3 || owners[other] != 3 {
				t.Fatalf("头像字段改变了资源分组: %v", owners)
			}
		})
	}
}
