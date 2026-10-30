package stats

import (
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestHistoryUserIDValidation(t *testing.T) {
	for _, value := range []string{"invalid", "00000000-0000-4000-8000-00000000000z", strings.Repeat("a", 200)} {
		recorder := httptest.NewRecorder()
		(&Service{}).history(recorder, httptest.NewRequest("GET", "/statistics/history?user_id="+url.QueryEscape(value), nil))
		if recorder.Code != 400 || !strings.Contains(recorder.Body.String(), "用户 ID 无效") {
			t.Fatalf("invalid user UUID %q: %d %s", value, recorder.Code, recorder.Body.String())
		}
	}
}

func TestHistoryUserIDFilter(t *testing.T) {
	s, user, _ := fixture(t)
	other := resource.ID()
	exec(t, s, `UPDATE users SET name='重名用户',email='primary@example.test' WHERE id=$1`, user)
	exec(t, s, `INSERT INTO users(id,name,email,role) VALUES($1,'重名用户','other@example.test','user')`, other)
	newer, older, foreign := resource.ID(), resource.ID(), resource.ID()
	at := s.now()
	conversationSession(t, s, user, newer, "new task", at.Add(-time.Hour))
	conversationSession(t, s, user, older, "old task", at.Add(-2*time.Hour))
	conversationSession(t, s, other, foreign, "new task", at)
	check := func(query string, next bool, ids ...string) {
		t.Helper()
		out := request(t, s, "/statistics/history?"+query, 200)
		assertHistoryPage(t, out, next, len(ids))
		for i, row := range out["items"].([]any) {
			if row.(map[string]any)["id"] != ids[i] {
				t.Fatalf("%s: unexpected task %v, want %s", query, row, ids[i])
			}
		}
	}
	check("user="+url.QueryEscape("重名用户"), false, foreign, newer, older)
	check("user_id="+user, false, newer, older)
	check("user_id="+strings.ToUpper(user), false, newer, older)
	check("user_id="+user+"&page_size=1", true, newer)
	check("user_id="+user+"&page_size=1&page=2", false, older)
	check("user_id="+user+"&page_size=1&page=3", false)
	check("user_id="+other, false, foreign)
	check("user_id="+resource.ID(), false)
	check("user_id="+user+"&user=other%40example.test", false)
	check("user_id="+user+"&user=PRIMARY&task=old", false, older)
	check("user_id="+user+"&from="+url.QueryEscape(at.Add(-time.Hour).Format(time.RFC3339))+"&until="+url.QueryEscape(at.Format(time.RFC3339)), false, newer)
	check("user_id="+user+"&until="+url.QueryEscape(at.Add(-time.Hour).Format(time.RFC3339)), false, older)
	exec(t, s, `UPDATE users SET name='改名用户' WHERE id=$1`, user)
	check("user_id="+user, false, newer, older)
	check("user_id=", false, foreign, newer, older)
}
