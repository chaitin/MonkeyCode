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

func TestMemberAnalysisAdminAccess(t *testing.T) {
	dsn := os.Getenv("MONKEYAI_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("需要 PostgreSQL 测试环境")
	}
	ctx := t.Context()
	root, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	schema := "test_member_analysis_http_" + strings.ReplaceAll(resource.ID(), "-", "")
	if _, err = root.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		root.Close()
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
	paths, err := filepath.Glob("../../migrations/*.up.sql")
	if err != nil {
		t.Fatal(err)
	}
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
	storage := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) }))
	t.Cleanup(storage.Close)
	t.Setenv("MONKEYAI_S3_ENDPOINT", storage.URL)
	t.Setenv("MONKEYAI_S3_ACCESS_KEY", "member-analysis-test")
	t.Setenv("MONKEYAI_S3_SECRET_KEY", "member-analysis-test")
	handler, err := newMemberTestHandler(ctx, slog.New(slog.NewTextHandler(io.Discard, nil)), pool, config.Config{PublicURL: "http://localhost:8080", InitialAdminName: "分析管理员", InitialAdminEmail: "member-analysis@example.test", InitialAdminPassword: "member-analysis-test-password"})
	if err != nil {
		t.Fatal(err)
	}
	var userID string
	if err = pool.QueryRow(ctx, `SELECT id::text FROM users WHERE email='member-analysis@example.test'`).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	path := "/api/admin/v1/statistics/session-reporting/members/" + userID
	var cookie *http.Cookie
	call := func(method, path, body string) *httptest.ResponseRecorder {
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
	if w := call("GET", path, ""); w.Code != 401 {
		t.Fatalf("匿名访问: %d %s", w.Code, w.Body)
	}
	login := call("POST", "/api/auth/v1/admin/login", `{"email":"member-analysis@example.test","password":"member-analysis-test-password"}`)
	if login.Code != 200 || len(login.Result().Cookies()) == 0 {
		t.Fatalf("登录失败: %d %s", login.Code, login.Body)
	}
	cookie = login.Result().Cookies()[0]
	w := call("GET", path, "")
	if w.Code != 200 || w.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("管理员读取: %d %s", w.Code, w.Body)
	}
	var out struct {
		Member struct {
			ID string `json:"id"`
		} `json:"member"`
	}
	if err = json.Unmarshal(w.Body.Bytes(), &out); err != nil || out.Member.ID != userID {
		t.Fatalf("成员响应错误: %s %v", w.Body, err)
	}
	for _, field := range []string{"password_hash", "api_key", "oauth_client_secret", "input_text"} {
		if strings.Contains(w.Body.String(), `"`+field+`"`) {
			t.Fatalf("分析接口泄漏私密字段 %s", field)
		}
	}
	if _, err = pool.Exec(ctx, `UPDATE users SET role='user' WHERE id=$1`, userID); err != nil {
		t.Fatal(err)
	}
	if w = call("GET", path, ""); w.Code != 403 {
		t.Fatalf("普通用户访问: %d %s", w.Code, w.Body)
	}
}
