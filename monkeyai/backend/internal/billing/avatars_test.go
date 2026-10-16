package billing

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

func TestAdminListUserAvatars(t *testing.T) {
	s, user, model := fixture(t)
	ctx := t.Context()
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := s.pool.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	other := resource.ID()
	exec(`INSERT INTO users(id,name,email) VALUES($1,'另一用户','other-avatar@example.com')`, other)
	for i, owner := range []string{user, other} {
		a, err := s.Account(ctx, owner)
		if err != nil {
			t.Fatal(err)
		}
		at := s.now().Add(time.Duration(i) * time.Second)
		exec(`INSERT INTO credit_ledger_entries(account_id,user_id,entry_type,category,item_name,credit_delta,balance_after,user_name,user_email,occurred_at)
			VALUES($1,$2,'charge','model','avatar-test',-1,0,'快照名称','snapshot@example.com',$3)`, a.ID, owner, at)
		exec(`INSERT INTO billing_transactions(user_id,account_id,category,resource_id,item_name,user_name,user_email,mode,status,reserve,pricing,started_at)
			VALUES($1,$2,'model',$3,'avatar-test','快照名称','snapshot@example.com','local','running',0,'{}',$4)`, owner, a.ID, model, at)
	}
	router := chi.NewRouter()
	s.RegisterAdmin(router)
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
			exec(`UPDATE users SET avatar_url=$2,name='当前名称',email='current@example.com' WHERE id=$1`, user, tc.stored)
			for _, endpoint := range []string{"entries", "reconciliation"} {
				seen := make(map[string]bool)
				for _, page := range []string{"1", "2"} {
					w := httptest.NewRecorder()
					router.ServeHTTP(w, httptest.NewRequest("GET", "/billing/"+endpoint+"?content=avatar-test&page_size=1&page="+page, nil))
					var out struct {
						Total int              `json:"total"`
						Items []map[string]any `json:"items"`
					}
					if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
						t.Fatal(err)
					}
					if w.Code != 200 || out.Total != 2 || len(out.Items) != 1 {
						t.Fatalf("%s 分页错误: %d %s", endpoint, w.Code, w.Body)
					}
					item := out.Items[0]
					owner := item["user_id"].(string)
					if seen[owner] {
						t.Fatalf("用户分页重复: %v", item)
					}
					seen[owner] = true
					avatar, present := item["user_avatar_url"]
					want := tc.want
					if owner == other {
						want = nil
					}
					if !present || avatar != want || item["user_name"] != "快照名称" || item["user_email"] != "snapshot@example.com" {
						t.Fatalf("%s 头像或快照错误: %v，头像期望 %v", endpoint, item, want)
					}
				}
			}
		})
	}
}
