package stats

import (
	"fmt"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestConversationFilters(t *testing.T) {
	f, err := parseConversationFilter(httptest.NewRequest("GET", "/statistics/conversations", nil))
	if err != nil || f.page != 1 || f.size != 20 || f.params.FromTime != nil || f.params.UntilTime != nil {
		t.Fatalf("默认不应限制历史时间: %+v %v", f, err)
	}
	query := url.Values{
		"task": {"  中文任务  "}, "user": {"  STATS  "}, "content": {strings.Repeat("字", 200)},
		"task_id": {"00000000-0000-4000-8000-000000000001"},
		"from":    {"2026-09-08T00:00:00+08:00"}, "until": {"2026-09-09T00:00:00+08:00"},
		"page": {"1000000"}, "page_size": {"500"},
	}
	f, err = parseConversationFilter(httptest.NewRequest("GET", "/statistics/conversations?"+query.Encode(), nil))
	if err != nil || f.params.TitleQuery != "中文任务" || f.params.UserQuery != "STATS" || f.size != 500 || f.page != 1_000_000 {
		t.Fatalf("有效筛选被拒绝: %+v %v", f, err)
	}
	if !f.params.FromTime.Equal(time.Date(2026, 9, 7, 16, 0, 0, 0, time.UTC)) {
		t.Fatal("应正确解析带时区时间")
	}
	for _, query := range []string{
		"page=0", "page=-1", "page=x", "page=1000001", "page_size=0", "page_size=501",
		"task_id=bad", "from=bad", "until=2026-09-09T00:00:00",
		"from=2026-09-09T00:00:00Z&until=2026-09-08T00:00:00Z",
		"from=2026-09-08T00:00:00Z&until=2026-09-08T00:00:00Z",
		"task=" + strings.Repeat("a", 201), "user=" + strings.Repeat("a", 201),
		"content=" + url.QueryEscape(strings.Repeat("字", 201)),
	} {
		t.Run(query, func(t *testing.T) {
			request(t, &Service{}, "/statistics/conversations?"+query, 400)
		})
	}
}

func conversationSession(t *testing.T, s *Service, user, id, title string, at time.Time) {
	t.Helper()
	exec(t, s, `INSERT INTO sessions(id,owner_user_id,title,session_type,client_type,client_name,started_at,last_active_at,reporting_enabled_at)
		VALUES($1,$2,$3,'conversation','web','test',$4,$4,$4)`, id, user, title, at)
	exec(t, s, `INSERT INTO session_resource_snapshots(session_id,snapshot_id,items) VALUES($1,'snapshot','[]')`, id)
}

func conversationTurn(t *testing.T, s *Service, session string, turn int, at time.Time, outcome string, text, input, output any) {
	t.Helper()
	exec(t, s, `INSERT INTO session_turns(session_id,turn_index,facts_version,report_hash,input_seq,started_at,ended_at,stop_reason,resources_snapshot_id,input_kind,input_text,input_tokens,output_tokens)
		VALUES($1,$2,1,'hash',1,$3,$4,$5,'snapshot','prompt',$6,$7,$8)`,
		session, turn, at, at.Add(1250*time.Millisecond), outcome, text, input, output)
}

func TestConversationsHistory(t *testing.T) {
	s, user, _ := fixture(t)
	now := s.now()
	at := now.Add(-time.Hour)
	root := "00000000-0000-4000-8000-000000000001"
	other := "00000000-0000-4000-8000-000000000002"
	conversationSession(t, s, user, root, "旧任务 100%_", now.Add(-30*24*time.Hour))
	conversationSession(t, s, user, other, "另一个任务", now.Add(-24*time.Hour))
	outcomes := []string{"complete", "interrupted", "error", "max_turns", "output_limit", "unknown"}
	for i, outcome := range outcomes {
		var text any = fmt.Sprintf("轮次 %d", i+1)
		var input, output any = int64(12345), int64(2345)
		if i == 0 {
			text = "正文 100%_ 中文\n第二行"
		}
		if i == 2 {
			text = "LOWERcase message"
		}
		if i == 1 || i == 5 {
			text = nil
			input, output = nil, nil
		}
		conversationTurn(t, s, root, i+1, at, outcome, text, input, output)
	}
	exec(t, s, `UPDATE session_turns SET input_text_truncated=true WHERE session_id=$1 AND turn_index=1`, root)
	exec(t, s, `UPDATE session_turns SET error_code='upstream_failed' WHERE session_id=$1 AND turn_index=3`, root)
	conversationTurn(t, s, other, 1, at, "complete", "另一条正文", 0, 0)
	for _, mode := range []string{"deleted", "purged", "placeholder", "unreported", "child"} {
		id := resource.ID()
		conversationSession(t, s, user, id, mode, now.Add(-time.Hour))
		conversationTurn(t, s, id, 1, at, "complete", "不可见", 999, 999)
		switch mode {
		case "deleted":
			exec(t, s, `UPDATE sessions SET deleted_at=$2 WHERE id=$1`, id, now)
		case "purged":
			exec(t, s, `UPDATE sessions SET purged_at=$2 WHERE id=$1`, id, now)
		case "placeholder":
			exec(t, s, `UPDATE sessions SET placeholder=true WHERE id=$1`, id)
		case "unreported":
			exec(t, s, `UPDATE sessions SET reporting_enabled_at=NULL WHERE id=$1`, id)
		case "child":
			exec(t, s, `UPDATE sessions SET parent_session_id=$2 WHERE id=$1`, id, root)
		}
	}

	out := request(t, s, "/statistics/conversations", 200)
	number(t, out, "total", 7)
	items := out["items"].([]any)
	if len(items) != 7 || items[0].(map[string]any)["session_id"] != other {
		t.Fatalf("跨任务同一时间的排序或可见范围错误: %v", out)
	}
	for i, raw := range items[1:] {
		item := raw.(map[string]any)
		turn := 6 - i
		number(t, item, "turn_index", float64(turn))
		number(t, item, "duration_seconds", 1.25)
		if item["user_id"] != user || item["user_name"] != "统计用户" || item["task_title"] != "旧任务 100%_" || item["outcome"] != outcomes[turn-1] {
			t.Fatalf("轮次字段错误: %v", item)
		}
		if turn == 6 {
			if item["is_completed"] != nil || item["input_text"] != nil || item["input_tokens"] != nil || item["output_tokens"] != nil {
				t.Fatalf("未知结果和未采集数据应保留 null: %v", item)
			}
		} else if item["is_completed"] != (turn == 1) {
			t.Fatalf("必须使用本轮结果，不应依赖任务是否结束: %v", item)
		}
		if turn == 1 && (item["input_text"] != "正文 100%_ 中文\n第二行" || item["input_text_truncated"] != true || item["input_tokens"] != float64(12345)) {
			t.Fatalf("正文或原始 Token 数据错误: %v", item)
		}
		if turn == 3 && item["error_code"] != "upstream_failed" {
			t.Fatal("应返回真实错误码")
		}
	}

	seen := map[string]bool{}
	for page := 1; page <= 4; page++ {
		out := request(t, s, fmt.Sprintf("/statistics/conversations?page=%d&page_size=2", page), 200)
		number(t, out, "total", 7)
		number(t, out, "page", float64(page))
		for _, raw := range out["items"].([]any) {
			item := raw.(map[string]any)
			key := fmt.Sprintf("%s:%v", item["session_id"], item["turn_index"])
			if seen[key] {
				t.Fatalf("分页出现重复轮次: %s", key)
			}
			seen[key] = true
		}
	}
	if len(seen) != 7 {
		t.Fatalf("分页遗漏记录: %v", seen)
	}
	out = request(t, s, "/statistics/conversations?page=99&page_size=2", 200)
	number(t, out, "page", 4)

	for _, filter := range []struct {
		query string
		total float64
	}{
		{"task_id=" + root, 6},
		{"task=" + url.QueryEscape("%"), 6},
		{"task=" + url.QueryEscape("_"), 6},
		{"user=STATS%40EXAMPLE.COM", 7},
		{"user=" + url.QueryEscape("统计"), 7},
		{"content=" + url.QueryEscape("%"), 1},
		{"content=" + url.QueryEscape("_"), 1},
		{"content=lowerCASE", 1},
		{"task_id=" + root + "&task=" + url.QueryEscape("另一个任务"), 0},
		{"task_id=00000000-0000-4000-8000-000000000099", 0},
	} {
		out := request(t, s, "/statistics/conversations?"+filter.query, 200)
		number(t, out, "total", filter.total)
		if len(out["items"].([]any)) != int(filter.total) {
			t.Fatalf("总数和列表筛选不一致: %s: %v", filter.query, out)
		}
	}
	// The root task was created 30 days ago; today's turns must still match.
	conversationTurn(t, s, root, 7, at.Add(-time.Second), "complete", "左边界外", 1, 1)
	conversationTurn(t, s, root, 8, at.Add(time.Second), "complete", "右边界", 1, 1)
	query := url.Values{"from": {at.Format(time.RFC3339)}, "until": {at.Add(time.Second).Format(time.RFC3339)}}
	out = request(t, s, "/statistics/conversations?"+query.Encode(), 200)
	number(t, out, "total", 7)
	for _, raw := range out["items"].([]any) {
		if turn := raw.(map[string]any)["turn_index"].(float64); turn > 6 {
			t.Fatal("日期筛选必须包含下界、排除上界")
		}
	}
	out = request(t, s, "/statistics/conversations?task_id="+root, 200)
	history := request(t, s, "/statistics/history?task="+root, 200)
	if out["total"] != history["items"].([]any)[0].(map[string]any)["turn_count"] {
		t.Fatal("进入任务的对话总数应与任务历史轮次计数一致，包括空正文")
	}
}

func TestConversationsEmpty(t *testing.T) {
	s, _, _ := fixture(t)
	out := request(t, s, "/statistics/conversations?page=99", 200)
	number(t, out, "total", 0)
	number(t, out, "page", 1)
	items, ok := out["items"].([]any)
	if !ok || len(items) != 0 {
		t.Fatalf("空历史应返回空数组: %v", out)
	}
}
