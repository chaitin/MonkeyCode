package billing

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
	"gopkg.in/yaml.v3"
)

func TestAgentBillingRequiresToken(t *testing.T) {
	router := chi.NewRouter()
	router.Use(identity.NewService(nil, nil, "").RequireAgent)
	NewService(nil).RegisterAgent(router)
	for _, path := range []string{"/billing/account", "/billing/entries"} {
		r := httptest.NewRequest(http.MethodGet, path, nil)
		r.AddCookie(&http.Cookie{Name: "monkeyai_session", Value: "browser-session"})
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("%s 不能使用浏览器 Cookie 绕过 Bearer 鉴权: %d", path, w.Code)
		}
	}
}

func TestAgentBilling(t *testing.T) {
	s, user, model := fixture(t)
	ctx := t.Context()
	if _, err := s.pool.Exec(ctx, `UPDATE users SET role='user' WHERE id=$1`, user); err != nil {
		t.Fatal(err)
	}
	other := resource.ID()
	if _, err := s.pool.Exec(ctx, `INSERT INTO users(id,name,email,role) VALUES($1,'测试用户','other@example.com','user')`, other); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{user, other} {
		hash := sha256.Sum256([]byte(id))
		if _, err := s.pool.Exec(ctx, `INSERT INTO oauth_tokens(user_id,client_id,access_token_hash,refresh_token_hash,access_expires_at,refresh_expires_at) VALUES($1,'test',$2,$3,now()+interval '1 hour',now()+interval '2 hours')`, id, hex.EncodeToString(hash[:]), "refresh-"+id); err != nil {
			t.Fatal(err)
		}
	}
	agent := chi.NewRouter()
	agent.Use(identity.NewService(s.pool, nil, "").RequireAgent)
	s.RegisterAgent(agent)
	router := chi.NewRouter()
	router.Mount("/api/v1", agent)
	call := func(path, token string, status int) resource.Object {
		t.Helper()
		r := httptest.NewRequest(http.MethodGet, "/api/v1/billing/"+path, nil)
		r.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		if w.Code != status {
			t.Fatalf("%s: %d %s", path, w.Code, w.Body.String())
		}
		var out resource.Object
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
		return out
	}
	for _, path := range []string{"account", "entries"} {
		call(path, "invalid-token", http.StatusUnauthorized)
	}

	a := call("account?user_id="+other, user, http.StatusOK)
	if a.String("user_id") != user || a.String("balance") != "15000" || a.String("frozen") != "0" || a.String("available") != "15000" || a.String("quota") != "15000" {
		t.Fatalf("首次查询应初始化自己的周期账户: %v", a)
	}
	if again := call("account", user, http.StatusOK); again.String("id") != a.String("id") {
		t.Fatalf("重复查询不能重复发放额度: %v", again)
	}
	empty := call("entries", user, http.StatusOK)
	if empty.Int("total") != 0 || len(empty["items"].([]any)) != 0 {
		t.Fatalf("额度发放不能计入消耗历史: %v", empty)
	}

	reservation, err := s.Begin(ctx, Request{UserID: user, ResourceID: model, Category: "model"})
	if err != nil {
		t.Fatal(err)
	}
	frozen := call("account", user, http.StatusOK)
	if frozen.String("frozen") != "14" || frozen.String("available") != "14986" {
		t.Fatalf("状态应反映预留积分: %v", frozen)
	}
	if err := s.Start(ctx, reservation.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.Finish(ctx, reservation.ID, Usage{Input: 10000, Cached: 4000, Output: 2000, Known: true, Result: "succeeded"}); err != nil {
		t.Fatal(err)
	}
	after := call("account", user, http.StatusOK)
	if after.String("balance") != "14998.52" || after.String("frozen") != "0" || after.String("available") != "14998.52" {
		t.Fatalf("状态应反映结算后余额: %v", after)
	}

	otherAccount := call("account", other, http.StatusOK)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	for _, entry := range []struct{ account, kind, category, item, delta, mode string }{
		{a.String("id"), "refund", "model", "模型退款", "0.48", "local"},
		{a.String("id"), "charge", "tool", "工具调用", "-2.5", "remote"},
		{a.String("id"), "adjustment", "other", "管理员调整", "10", "local"},
		{a.String("id"), "reset", "other", "额度重置", "0", "local"},
		{otherAccount.String("id"), "charge", "model", "其他用户消费", "-99", "local"},
	} {
		if err := ledger(ctx, tx, entry.account, "", resource.ID(), entry.kind, entry.category, entry.item, amountText(entry.delta), entry.mode, map[string]any{"internal": "不能公开"}); err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}

	all := call("entries?user_id="+other+"&user=other&group_id=invalid", user, http.StatusOK)
	items := all["items"].([]any)
	if all.Int("total") != 3 || len(items) != 3 || all.Int("page") != 1 || all.Int("page_size") != 20 {
		t.Fatalf("历史应只包含当前用户的扣费及退款: %v", all)
	}
	allowed := map[string]bool{"id": true, "transaction_id": true, "entry_type": true, "category": true, "item_name": true, "credit_delta": true, "balance_after": true, "mode": true, "occurred_at": true}
	for i, raw := range items {
		item := resource.Object(raw.(map[string]any))
		for key := range item {
			if !allowed[key] {
				t.Fatalf("历史不应暴露内部字段 %s: %v", key, item)
			}
		}
		if _, ok := item["credit_delta"].(string); !ok {
			t.Fatalf("积分必须以十进制字符串返回: %v", item)
		}
		page := call("entries?page_size=1&page="+strconv.Itoa(i+1), user, http.StatusOK)
		if page.Int("total") != 3 || len(page["items"].([]any)) != 1 || page["items"].([]any)[0].(map[string]any)["id"] != item["id"] {
			t.Fatalf("分页顺序或总数不一致: %v", page)
		}
	}
	charge := resource.Object(items[len(items)-1].(map[string]any))
	if charge.String("transaction_id") != reservation.ID || charge.String("credit_delta") != "-1.480000" || charge.String("balance_after") != "14998.520000" {
		t.Fatalf("应返回真实结算的消耗明细: %v", charge)
	}
	for _, tc := range []struct {
		query string
		total int
	}{
		{"entry_type=charge", 2},
		{"entry_type=refund", 1},
		{"category=model", 2},
		{"category=tool&mode=remote&entry_type=charge&content=工具", 1},
		{"mode=local", 2},
		{"content=不存在", 0},
		{"from=2000-01-01T00:00:00Z&until=2100-01-01T00:00:00Z", 3},
		{"until=2000-01-01T00:00:00Z", 0},
		{"from=2100-01-01T00:00:00Z", 0},
	} {
		out := call("entries?"+tc.query, user, http.StatusOK)
		if out.Int("total") != int64(tc.total) || len(out["items"].([]any)) != tc.total {
			t.Fatalf("筛选 %s: %v", tc.query, out)
		}
	}
	for _, query := range []string{"entry_type=grant", "entry_type=adjustment", "from=invalid", "until=2026-09-01T00:00:00", "from=2026-09-02T00:00:00Z&until=2026-09-01T00:00:00Z", "content=" + strings.Repeat("a", 201)} {
		call("entries?"+query, user, http.StatusBadRequest)
	}
	if out := call("entries?page=100000&page_size=1", user, http.StatusOK); out.Int("total") != 3 || len(out["items"].([]any)) != 0 {
		t.Fatalf("超出末页应返回空数组但保留总数: %v", out)
	}
	if out := call("entries?page=0&page_size=101", user, http.StatusOK); out.Int("page") != 1 || out.Int("page_size") != 20 {
		t.Fatalf("非法分页应使用默认值: %v", out)
	}
	if out := call("entries", other, http.StatusOK); out.Int("total") != 1 || out["items"].([]any)[0].(map[string]any)["item_name"] != "其他用户消费" {
		t.Fatalf("其他用户也只能看到自己的消费: %v", out)
	}

	if _, err := s.pool.Exec(ctx, `UPDATE credit_accounts SET balance=-0.48 WHERE id=$1`, a.String("id")); err != nil {
		t.Fatal(err)
	}
	if out := call("account", user, http.StatusOK); out.String("balance") != "-0.48" || out.String("available") != "-0.48" {
		t.Fatalf("不能截断负余额: %v", out)
	}
	s.now = func() time.Time { return time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC) }
	if out := call("account", user, http.StatusOK); out.String("id") == a.String("id") || out.String("balance") != "15000" {
		t.Fatalf("新周期应刷新账户: %v", out)
	}
	if out := call("entries", user, http.StatusOK); out.Int("total") != 3 {
		t.Fatalf("历史应跨周期保留: %v", out)
	}
}

func TestAgentBillingContract(t *testing.T) {
	data, err := os.ReadFile("../../api/agent.yaml")
	if err != nil {
		t.Fatal(err)
	}
	var document map[string]any
	if err := yaml.Unmarshal(data, &document); err != nil {
		t.Fatal(err)
	}
	paths := document["paths"].(map[string]any)
	for _, path := range []string{"/api/v1/billing/account", "/api/v1/billing/entries"} {
		methods, ok := paths[path].(map[string]any)
		if !ok || methods["get"] == nil {
			t.Fatalf("缺少接口契约 %s", path)
		}
	}
	var check func(any)
	check = func(value any) {
		switch node := value.(type) {
		case map[string]any:
			if ref, ok := node["$ref"].(string); ok && strings.HasPrefix(ref, "#/") {
				var target any = document
				for _, part := range strings.Split(strings.TrimPrefix(ref, "#/"), "/") {
					parent, ok := target.(map[string]any)
					if !ok || parent[part] == nil {
						t.Fatalf("无效契约引用 %s", ref)
					}
					target = parent[part]
				}
			}
			for _, child := range node {
				check(child)
			}
		case []any:
			for _, child := range node {
				check(child)
			}
		}
	}
	check(document)
}
