package stats

import (
	"fmt"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"
)

func TestReportingLimitRanges(t *testing.T) {
	for _, maximum := range []int{100, 500} {
		for _, limit := range []int{0, 1, 100, 101, 200, 500, 501} {
			r := httptest.NewRequest("GET", fmt.Sprintf("/?limit=%d", limit), nil)
			f, err := parseReportingFilter(r, time.Now(), maximum)
			valid := limit >= 1 && limit <= maximum
			if valid && (err != nil || f.limit != limit) || !valid && err == nil {
				t.Fatalf("limit=%d maximum=%d: filter=%+v err=%v", limit, maximum, f, err)
			}
		}
	}
}

func TestClientLargePages(t *testing.T) {
	s, user, _ := fixture(t)
	id := clientSession(t, s, user, "desktop", "windows")
	exec(t, s, `INSERT INTO session_turns(session_id,turn_index,facts_version,report_hash,input_seq,started_at,ended_at,
		stop_reason,resources_snapshot_id,input_kind,client_version)
		SELECT $1, i, 1, 'hash', i::bigint, $2::timestamptz + i * interval '1 second',
		$2::timestamptz + (i + 1) * interval '1 second', 'complete', 'snapshot', 'prompt',
		'v' || lpad(i::text,4,'0') FROM generate_series(1,505) i`, id, s.now().Add(-time.Hour))
	const path = "/statistics/session-reporting/clients"
	for _, size := range []int{200, 500} {
		t.Run(fmt.Sprintf("limit_%d", size), func(t *testing.T) {
			seen := make(map[string]bool)
			cursor, previousKey := "", ""
			for offset := 0; offset < 505; offset += size {
				query := fmt.Sprintf("?limit=%d", size)
				if cursor != "" {
					query += "&cursor=" + url.QueryEscape(cursor)
				}
				out := request(t, s, path+query, 200)
				items := out["items"].([]any)
				if len(items) != min(size, 505-offset) {
					t.Fatalf("分页条数错误: limit=%d offset=%d got=%d", size, offset, len(items))
				}
				for _, raw := range items {
					item := raw.(map[string]any)
					version, key := item["client_version"].(string), item["sort_key"].(string)
					if seen[version] || key <= previousKey {
						t.Fatalf("分页重复或顺序错误: %v", item)
					}
					seen[version], previousKey = true, key
				}
				if offset+size < 505 {
					cursor, _ = out["next_cursor"].(string)
					if cursor == "" {
						t.Fatalf("缺少下一页游标: %v", out)
					}
				} else if out["next_cursor"] != nil {
					t.Fatalf("最后一页不应有游标: %v", out)
				}
			}
			if len(seen) != 505 {
				t.Fatalf("分页丢失记录: %d", len(seen))
			}
		})
	}
	request(t, s, path+"?limit=501", 400)
	request(t, s, "/statistics/session-reporting/resources?limit=101", 400)
	request(t, s, clientOverviewPath+"?limit=500", 400)
	number(t, request(t, s, clientOverviewPath, 200), "total", 1)
}
