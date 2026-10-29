package stats

import (
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestHistoryUserAvatars(t *testing.T) {
	s, user, _ := fixture(t)
	other := resource.ID()
	exec(t, s, `INSERT INTO users(id,name,email) VALUES($1,'另一用户','other-avatar@example.com')`, other)
	for i, owner := range []string{user, other} {
		id := resource.ID()
		at := s.now().Add(-time.Duration(i+1) * time.Hour)
		conversationSession(t, s, owner, id, "头像测试", at)
		conversationTurn(t, s, id, 1, at, "complete", "正文", 10, 5)
	}
	for _, tc := range []struct {
		name   string
		stored any
		want   any
	}{
		{"url", "https://example.com/avatar.webp", "https://example.com/avatar.webp"},
		{"changed", "https://example.com/new.webp", "https://example.com/new.webp"},
		{"trimmed", " https://example.com/avatar.webp ", "https://example.com/avatar.webp"},
		{"empty", "", nil}, {"blank", "   ", nil}, {"null", nil, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			exec(t, s, `UPDATE users SET avatar_url=$2 WHERE id=$1`, user, tc.stored)
			for _, endpoint := range []string{"history", "conversations"} {
				seen := make(map[string]bool)
				for _, page := range []string{"1", "2"} {
					out := request(t, s, "/statistics/"+endpoint+"?page_size=1&page="+page, 200)
					assertHistoryPage(t, out, page == "1", 1)
					items := out["items"].([]any)
					if len(items) != 1 {
						t.Fatalf("分页条数错误: %v", out)
					}
					item := items[0].(map[string]any)
					owner := item["user_id"].(string)
					if seen[owner] {
						t.Fatalf("用户分页重复: %v", out)
					}
					seen[owner] = true
					avatar, present := item["user_avatar_url"]
					want := tc.want
					if owner == other {
						want = nil
					}
					if !present || avatar != want {
						t.Fatalf("%s 用户头像错误: %v，期望 %v", endpoint, item, want)
					}
				}
			}
		})
	}
}
