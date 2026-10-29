package billing

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

func entrySearchAccount(t *testing.T, s *Service, user string) string {
	t.Helper()
	id := resource.ID()
	ledgerExec(t, s, `INSERT INTO credit_accounts(id,user_id,period_start_at,period_end_at,last_refreshed_at)
 VALUES($1,$2,'2026-09-01T00:00:00Z','2026-10-01T00:00:00Z','2026-09-01T00:00:00Z')`, id, user)
	return id
}

func TestBillingUserSelectionHistory(t *testing.T) {
	s, user, _ := fixture(t)
	ledgerMigration(t, s, "down")
	other, deleted := resource.ID(), resource.ID()
	ledgerExec(t, s, `UPDATE users SET name='张三',email='renamed@example.test',avatar_url='  /avatar.png  ' WHERE id=$1`, user)
	ledgerExec(t, s, `INSERT INTO users(id,name,email,status,deleted_at) VALUES($1,'张三','other@example.test','active',NULL),($2,'离职成员','deleted@example.test','active',NULL)`, other, deleted)
	for i, id := range []string{user, other, deleted} {
		account := entrySearchAccount(t, s, id)
		ledgerExec(t, s, `INSERT INTO credit_ledger_entries(account_id,user_id,user_name,user_email,entry_type,category,item_name,credit_delta,balance_after,occurred_at,mode)
 VALUES($1,$2,'旧名','old@example.test','charge','model','模型扣费',-3,0,$3,'local')`, account, id, s.now().Add(-time.Duration(i)*time.Hour))
		if i == 0 {
			ledgerExec(t, s, `INSERT INTO credit_ledger_entries(account_id,user_id,user_name,user_email,entry_type,category,item_name,credit_delta,balance_after,occurred_at,mode)
 VALUES($1,$2,'旧名','old@example.test','refund','tool','工具退款',1,0,$3,'local')`, account, id, s.now().Add(time.Second))
		}
	}
	ledgerExec(t, s, `UPDATE users SET status='disabled',deleted_at=now() WHERE id=$1`, deleted)
	router := chi.NewRouter()
	s.RegisterAdmin(router)
	call := func(t *testing.T, path string, status int) map[string]any {
		t.Helper()
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if w.Code != status {
			t.Fatalf("%s: %d %s", path, w.Code, w.Body)
		}
		var out map[string]any
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
		return out
	}
	check := func(t *testing.T) {
		for _, tc := range []struct {
			query string
			count int
			next  bool
		}{
			{"user_id=" + user, 2, false}, {"user_id=" + other, 1, false}, {"user_id=" + deleted, 1, false},
			{"user_id=" + user + "&page_size=1", 1, true}, {"user_id=" + user + "&page_size=1&page=2", 1, false},
			{"user_id=" + user + "&page_size=1&page=3", 0, false},
			{"user_id=" + user + "&user=" + url.QueryEscape("旧名"), 2, false},
			{"user_id=" + user + "&user=renamed", 0, false},
			{"user_id=" + user + "&category=tool&entry_type=refund&mode=local&content=" + url.QueryEscape("退款"), 1, false},
			{"user=" + url.QueryEscape("旧名"), 4, false}, {"user=old%40example.test", 4, false},
			{"user=" + url.QueryEscape("张三"), 0, false},
			{"user_id=" + resource.ID(), 0, false},
		} {
			out := call(t, "/billing/entries?range=all&"+tc.query, 200)
			items := out["items"].([]any)
			if len(items) != tc.count || out["has_next"] != tc.next || out["total"] != nil {
				t.Fatalf("%s: %#v", tc.query, out)
			}
			if strings.HasPrefix(tc.query, "user_id="+user) {
				for _, item := range items {
					if item.(map[string]any)["user_id"] != user {
						t.Fatalf("cross-user result: %#v", out)
					}
				}
			}
		}
		out := call(t, "/billing/summary?user_id="+user, 200)
		if out["count"] != float64(2) || out["charges"] != "3.000000" || out["refunds"] != "1.000000" || out["net_consumption"] != "2.000000" {
			t.Fatalf("summary: %#v", out)
		}
	}
	t.Run("ordinary", check)
	ledgerMigration(t, s, "up")
	t.Run("backfill", check)
	ledgerCutover(t, s)
	t.Run("partitioned", check)
	out := call(t, "/billing/users?q="+url.QueryEscape("张三")+"&limit=1", 200)
	if len(out["items"].([]any)) != 1 || out["has_next"] != true {
		t.Fatalf("bounded duplicate-name options: %#v", out)
	}
	out = call(t, "/billing/users?q=EXAMPLE.TEST", 200)
	if len(out["items"].([]any)) != 3 {
		t.Fatalf("case-insensitive email: %#v", out)
	}
	out = call(t, "/billing/users?id="+user, 200)
	item := out["items"].([]any)[0].(map[string]any)
	if len(item) != 5 || item["avatar_url"] != "/avatar.png" || item["name"] != "张三" {
		t.Fatalf("unexpected directory fields: %#v", item)
	}
	out = call(t, "/billing/users?id="+deleted, 200)
	if out["items"].([]any)[0].(map[string]any)["deleted"] != true {
		t.Fatalf("deleted user unavailable: %#v", out)
	}
	for _, query := range []string{"q=%25", "q=%5F", "id=" + resource.ID()} {
		out = call(t, "/billing/users?"+query, 200)
		if len(out["items"].([]any)) != 0 {
			t.Fatalf("literal search or missing ID: %#v", out)
		}
	}
	for _, path := range []string{"/billing/entries?user_id=bad", "/billing/summary?user_id=bad", "/billing/users?id=bad", "/billing/users?limit=0", "/billing/users?limit=51", "/billing/users?limit=no", "/billing/users?q=" + url.QueryEscape(strings.Repeat("张", 201))} {
		call(t, path, 400)
	}

	protected := chi.NewRouter()
	protected.Use(identity.NewService(s.pool, nil, "").RequireAdmin)
	s.RegisterAdmin(protected)
	for _, id := range []string{user, other} {
		hash := sha256.Sum256([]byte(id))
		ledgerExec(t, s, `INSERT INTO browser_sessions(token_hash,user_id,authentication_method,expires_at) VALUES($1,$2,'password',now()+interval '1 hour')`, hex.EncodeToString(hash[:]), id)
	}
	for _, tc := range []struct {
		token  string
		status int
	}{{"", 401}, {other, 403}, {user, 200}} {
		request := httptest.NewRequest("GET", "/billing/users", nil)
		if tc.token != "" {
			request.AddCookie(&http.Cookie{Name: "monkeyai_session", Value: tc.token})
		}
		w := httptest.NewRecorder()
		protected.ServeHTTP(w, request)
		if w.Code != tc.status {
			t.Fatalf("user directory permissions: %d %s", w.Code, w.Body)
		}
		if tc.status == 200 && w.Header().Get("Cache-Control") != "private, no-store" {
			t.Fatal("user directory must not be cached")
		}
	}
}
