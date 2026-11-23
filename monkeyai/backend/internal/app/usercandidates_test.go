package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func testAdminUserCandidates(t *testing.T, pool *pgxpool.Pool, h http.Handler) {
	t.Helper()
	var deleted string
	err := pool.QueryRow(t.Context(), "INSERT INTO users(name,email,status,deleted_at) VALUES('Candidate','a@example.test','disabled',now()) RETURNING id").Scan(&deleted)
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(t.Context(), "INSERT INTO users(name,email,status,avatar_url) SELECT 'Candidate','b'||i||'@example.test','disabled',' /avatar.png ' FROM generate_series(1,21) i")
	if err != nil {
		t.Fatal(err)
	}
	type result struct {
		Items   []map[string]any
		HasNext bool `json:"has_next"`
		Users   []map[string]any
	}
	call := func(query, actor string, want int) result {
		t.Helper()
		req := httptest.NewRequest("GET", "/api/admin/v1/users"+query, nil)
		if actor != "" {
			req.AddCookie(&http.Cookie{Name: "monkeyai_session", Value: actor})
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		if w.Code != want {
			t.Fatalf("%s %s: %d != %d: %s", actor, query, w.Code, want, w.Body)
		}
		var out result
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
		if query != "" && want == 200 && (w.Header().Get("Cache-Control") != "private, no-store" || out.Items == nil || out.Users != nil) {
			t.Fatalf("候选响应或缓存策略错误: %s", w.Body)
		}
		return out
	}
	full := call("", "lead", 200)
	if len(full.Users) <= 20 || full.Items != nil {
		t.Fatal("无参数必须返回完整列表")
	}
	for _, u := range full.Users {
		if u["id"] == deleted {
			t.Fatal("完整列表包含已删除用户")
		}
	}
	initial := call("?q=", "lead", 200)
	if len(initial.Items) != 20 || !initial.HasNext {
		t.Fatal("空关键词未返回有界候选")
	}
	for _, actor := range []string{"lead", "admin"} {
		out := call("?q=%20CANDIDATE%20&limit=1", actor, 200)
		if len(out.Items) != 1 || !out.HasNext || len(out.Items[0]) != 5 || out.Items[0]["email"] != "b10@example.test" || out.Items[0]["avatar_url"] != "/avatar.png" || out.Items[0]["deleted"] != false {
			t.Fatalf("排序、字段、停用成员或删除过滤错误: %+v", out)
		}
	}
	for _, q := range []string{"?id=" + deleted, "?id=" + deleted + "&include_deleted=false", "?id=" + deleted + "&q=another&include_deleted=true", "?q=%25", "?q=%5F"} {
		if out := call(q, "admin", 200); len(out.Items) != 0 || out.HasNext {
			t.Fatal(q, out)
		}
	}
	for _, q := range []string{"?id=" + deleted + "&include_deleted=true", "?q=" + deleted[:16] + "&include_deleted=true", "?q=A%40EXAMPLE.TEST&include_deleted=true"} {
		out := call(q, "admin", 200)
		if len(out.Items) != 1 || len(out.Items[0]) != 5 || out.Items[0]["id"] != deleted || out.Items[0]["deleted"] != true || out.HasNext {
			t.Fatal(q, out)
		}
	}
	for _, q := range []string{"?id=" + deleted + "&include_deleted=true", "?include_deleted=true"} {
		call(q, "lead", 403)
	}
	for _, q := range []string{"?id=bad", "?limit=0", "?limit=51", "?limit=no", "?include_deleted=yes", "?q=" + url.QueryEscape(strings.Repeat("张", 201))} {
		call(q, "admin", 400)
	}
	call("?q=", "ordinary", 403)
	call("?q=", "", 401)
}
