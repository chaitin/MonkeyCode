package app

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/config"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestAuditIntegration(t *testing.T) {
	dsn := os.Getenv("MONKEYAI_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("需要 PostgreSQL 与 RustFS 测试环境")
	}
	ctx := t.Context()
	root, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	schema := "test_audit_http_" + strings.ReplaceAll(resource.ID(), "-", "")
	if _, err = root.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Close()
		_, _ = root.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE")
		root.Close()
	})
	paths, _ := filepath.Glob("../../migrations/*.up.sql")
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = pool.Exec(ctx, string(data)); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("MONKEYAI_MCP_ALLOWED_CIDRS", "127.0.0.0/8")
	handler, err := newApplicationHandler(ctx, slog.New(slog.NewTextHandler(io.Discard, nil)), pool, config.Config{PublicURL: "http://localhost:8080", InitialAdminName: "审计测试", InitialAdminEmail: "audit-http@example.com", InitialAdminPassword: "audit-test-password"})
	if err != nil {
		t.Fatal(err)
	}

	var cookie *http.Cookie
	call := func(method, path, body string) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		r.RemoteAddr = "127.0.0.1:9999"
		if cookie != nil {
			r.AddCookie(cookie)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	if w := call("GET", "/api/admin/v1/audits", ""); w.Code != 401 {
		t.Fatalf("匿名用户可读取审计: %d", w.Code)
	}
	if w := call("POST", "/api/auth/v1/admin/login", `{"email":"audit-http@example.com","password":"secret-wrong"}`); w.Code != 401 {
		t.Fatalf("失败登录: %d", w.Code)
	}
	w := call("POST", "/api/auth/v1/admin/login", `{"email":"audit-http@example.com","password":"audit-test-password"}`)
	if w.Code != 200 || len(w.Result().Cookies()) == 0 {
		t.Fatalf("登录失败: %d %s", w.Code, w.Body)
	}
	cookie = w.Result().Cookies()[0]
	var user struct{ ID string }
	if err = json.Unmarshal(w.Body.Bytes(), &user); err != nil {
		t.Fatal(err)
	}
	w = call("POST", "/api/admin/v1/users", `{"name":"新成员","email":"new-audit@example.com","role":"user","password":"secret-unused"}`)
	if w.Code != 201 {
		t.Fatalf("创建成员: %d %s", w.Code, w.Body)
	}
	var target struct{ ID string }
	if err = json.Unmarshal(w.Body.Bytes(), &target); err != nil {
		t.Fatal(err)
	}
	w = call("POST", "/api/admin/v1/users", `{"name":"新成员","email":"new-audit@example.com","role":"user"}`)
	if w.Code != 409 {
		t.Fatalf("重复成员: %d %s", w.Code, w.Body)
	}
	w = call("GET", "/api/admin/v1/audits", "")
	var page struct {
		Total int
		Items []struct {
			Action, Category, Result string
			ActorID                  *string `json:"actor_user_id"`
			ActorName                string  `json:"actor_name"`
			TargetID                 *string `json:"target_id"`
			RequestID                *string `json:"request_id"`
		}
	}
	if err = json.Unmarshal(w.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	if w.Code != 200 || page.Total != 4 || len(page.Items) != 4 {
		t.Fatalf("审计缺失: %d %s", w.Code, w.Body)
	}
	for _, item := range page.Items {
		if item.RequestID == nil {
			t.Fatalf("缺少请求 ID: %+v", item)
		}
		if item.Action == "sign_in" && item.Result == "failed" && item.ActorID != nil {
			t.Fatalf("失败登录冒用用户: %+v", item)
		}
		if item.Result == "success" && (item.ActorID == nil || *item.ActorID != user.ID || item.ActorName != "审计测试") {
			t.Fatalf("操作者快照错误: %+v", item)
		}
		if item.Action == "create" && item.Result == "success" && (item.TargetID == nil || *item.TargetID != target.ID || item.Category != "identity") {
			t.Fatalf("创建目标缺失: %+v", item)
		}
	}
	var raw string
	if err = pool.QueryRow(ctx, `SELECT jsonb_agg(to_jsonb(audits))::text FROM audits`).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{"secret-wrong", "secret-unused", "audit-test-password", cookie.Value} {
		if strings.Contains(raw, secret) {
			t.Fatal("审计包含敏感值")
		}
	}
	if w = call("POST", "/api/auth/v1/logout", ""); w.Code != 204 {
		t.Fatalf("退出登录: %d", w.Code)
	}
	var actor, action string
	if err = pool.QueryRow(ctx, `SELECT actor_user_id, action FROM audits ORDER BY occurred_at DESC LIMIT 1`).Scan(&actor, &action); err != nil || actor != user.ID || action != "sign_out" {
		t.Fatalf("退出审计错误: %s %s %v", actor, action, err)
	}
	if w = call("GET", "/api/admin/v1/audits", ""); w.Code != 401 {
		t.Fatalf("退出后仍可读取审计: %d", w.Code)
	}
	w = call("POST", "/api/auth/v1/admin/login", `{"email":"audit-http@example.com","password":"audit-test-password"}`)
	if w.Code != 200 {
		t.Fatalf("重新登录失败: %d", w.Code)
	}
	cookie = w.Result().Cookies()[0]
	if _, err = pool.Exec(ctx, `UPDATE users SET role='user' WHERE id=$1`, user.ID); err != nil {
		t.Fatal(err)
	}
	if w = call("GET", "/api/admin/v1/audits", ""); w.Code != 403 {
		t.Fatalf("普通用户可读取审计: %d", w.Code)
	}
}
