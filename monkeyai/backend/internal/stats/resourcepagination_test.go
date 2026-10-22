package stats

import (
	"fmt"
	"net/url"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestResourceLargePages(t *testing.T) {
	s, user, _ := fixture(t)
	id := resource.ID()
	conversationSession(t, s, user, id, "资源分页", s.now().Add(-time.Hour))
	conversationTurn(t, s, id, 1, s.now().Add(-time.Minute), "complete", "正文", 1, 1)
	exec(t, s, `INSERT INTO session_resource_snapshot_items(session_id,snapshot_id,resource_id,kind,version,enabled,available)
		SELECT $1,'snapshot','page-' || lpad(i::text,4,'0'),'rule','v1',true,true FROM generate_series(1,505) i`, id)
	for _, size := range []int{200, 500} {
		query := url.Values{"limit": {fmt.Sprint(size)}}
		seen := make(map[string]bool)
		for offset := 0; offset < 505; offset += size {
			out := request(t, s, resourceUsagePath+"?"+query.Encode(), 200)
			items := out["items"].([]any)
			if len(items) != min(size, 505-offset) {
				t.Fatalf("size=%d offset=%d: 返回 %d 条", size, offset, len(items))
			}
			for _, raw := range items {
				item := raw.(map[string]any)
				key := item["resource_id"].(string)
				if seen[key] {
					t.Fatalf("资源分页重复: %s", key)
				}
				seen[key] = true
			}
			if offset+size < 505 {
				cursor, _ := out["next_cursor"].(string)
				if cursor == "" {
					t.Fatal("缺少下一页游标")
				}
				query.Set("cursor", cursor)
			} else if out["next_cursor"] != nil {
				t.Fatalf("最后一页不应有游标: %v", out["next_cursor"])
			}
		}
		if len(seen) != 505 {
			t.Fatalf("分页丢失记录: %d", len(seen))
		}
	}
	request(t, s, resourceUsagePath+"?limit=501", 400)
}
