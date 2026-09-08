package audit

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestRedaction(t *testing.T) {
	data, err := params(json.RawMessage(`{"name":"模型","password":"secret-password","api_key":"secret-key","value":{"oauth":{"client_secret":"secret-oauth"},"headers":{"X-Key":"secret-header"},"base_url":"https://secret-url","content":"secret-content","new_credential":"secret-new","resources":[{"id":"public-id","token":"secret-token"}]},"amount":9007199254740993}`))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "secret-") || !strings.Contains(string(data), "9007199254740993") || !strings.Contains(string(data), "public-id") {
		t.Fatalf("脱敏或数值精度错误: %s", data)
	}
	data, err = params(nil)
	if err != nil || string(data) != "{}" {
		t.Fatalf("空参数: %s %v", data, err)
	}
	if got := sourceIP("[::ffff:127.0.0.1]:8080"); got != "127.0.0.1" {
		t.Fatal(got)
	}
	if got := sourceIP("[fe80::1%en0]:8080"); got != "fe80::1" {
		t.Fatal(got)
	}
}

func TestFilters(t *testing.T) {
	for _, query := range []string{"page=0", "page=-1", "page=1000001", "page=x", "page_size=501", "page_size=0", "category=unknown", "result=unknown", "since=x", "until=", "since=2026-09-08T00:00:00Z&until=2026-09-07T00:00:00Z", "params=%00", "actor=" + strings.Repeat("a", 513)} {
		if _, _, err := filters(httptest.NewRequest("GET", "/?"+query, nil)); err == nil {
			t.Errorf("未拒绝 %s", query)
		}
	}
	in, page, err := filters(httptest.NewRequest("GET", "/?page=2&page_size=50&actor=%25", nil))
	if err != nil || page != 2 || in.PageOffset != 50 || in.Actor != "%" {
		t.Fatalf("分页筛选错误: %+v %v", in, err)
	}
}

func fixture(t *testing.T) (*Service, Actor) {
	t.Helper()
	dsn := os.Getenv("MONKEYAI_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("设置 MONKEYAI_TEST_DATABASE_URL 运行审计数据库测试")
	}
	ctx := t.Context()
	root, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	schema := "audit_test_" + strings.ReplaceAll(time.Now().Format("20060102150405.000000000"), ".", "")
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
	actor := Actor{ID: "11111111-1111-4111-8111-111111111111", Name: "审计管理员", Email: "audit@example.com"}
	if _, err = pool.Exec(ctx, `INSERT INTO users (id, name, email, role) VALUES ($1, $2, $3, 'admin')`, actor.ID, actor.Name, actor.Email); err != nil {
		t.Fatal(err)
	}
	return NewService(pool, slog.New(slog.NewTextHandler(io.Discard, nil))), actor
}

func TestRequestIntegration(t *testing.T) {
	s, actor := fixture(t)
	router := chi.NewRouter()
	router.Use(s.Middleware(func(*http.Request) Actor { return actor }))
	s.RegisterAdmin(router)
	const target = "22222222-2222-4222-8222-222222222222"
	router.Post("/models/{id}/{operation}", func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		switch chi.URLParam(r, "operation") {
		case "commit", "batch", "rollback":
			tx, err := s.pool.Begin(r.Context())
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback(context.WithoutCancel(r.Context()))
			count := 1
			if chi.URLParam(r, "operation") == "batch" {
				count = 2
			}
			for range count {
				if err := Write(r.Context(), tx, Event{ActorID: actor.ID, Action: "save", Category: "model", TargetType: "model", TargetID: target, Params: map[string]any{"before": map[string]any{"enabled": false}, "after": map[string]any{"enabled": true, "password": "secret-snapshot"}}}); err != nil {
					t.Fatal(err)
				}
			}
			if chi.URLParam(r, "operation") == "rollback" {
				w.WriteHeader(409)
				return
			}
			if err = tx.Commit(r.Context()); err != nil {
				t.Fatal(err)
			}
		case "failed":
			w.WriteHeader(400)
			_, _ = w.Write([]byte(`{"error":{"message":"secret-upstream"}}`))
			return
		case "panic":
			panic("secret-panic")
		}
		w.WriteHeader(204)
	})
	call := func(operation, body, media string) {
		t.Helper()
		r := httptest.NewRequest("POST", "/models/"+target+"/"+operation, strings.NewReader(body))
		r.RemoteAddr = "127.0.0.1:1234"
		r.Header.Set("Content-Type", media)
		r.Header.Set("User-Agent", "audit-test")
		r.Header.Set("X-Forwarded-For", "203.0.113.99")
		r.Header.Set("X-Request-ID", "forged-request")
		w := httptest.NewRecorder()
		if operation == "panic" {
			func() {
				defer func() {
					if recover() == nil {
						t.Error("异常未传播")
					}
				}()
				router.ServeHTTP(w, r)
			}()
		} else {
			router.ServeHTTP(w, r)
		}
	}
	for _, operation := range []string{"commit", "batch", "rollback", "failed", "panic"} {
		call(operation, `{"name":"测试模型","api_key":"secret-input"}`, "application/json")
	}
	call("large", `{"name":"`+strings.Repeat("secret-large", 10000)+`"}`, "application/json")
	call("upload", "secret-file-content", "multipart/form-data; boundary=test")
	call("invalid", "secret-invalid-json", "application/json")
	var count, requests, failed, preserved, omitted int
	var raw string
	err := s.pool.QueryRow(t.Context(), `SELECT count(*), count(DISTINCT request_id), count(*) FILTER (WHERE result='failed'), count(*) FILTER (WHERE request_params ? 'before'), count(*) FILTER (WHERE request_params @> '{"body_omitted":true}'), jsonb_agg(to_jsonb(audits))::text FROM audits`).Scan(&count, &requests, &failed, &preserved, &omitted, &raw)
	if err != nil {
		t.Fatal(err)
	}
	if count != 9 || requests != 8 || failed != 3 || preserved != 3 || omitted != 3 {
		t.Fatalf("请求审计重复或丢失: %d %d %d %d %d", count, requests, failed, preserved, omitted)
	}
	if strings.Contains(raw, "secret-") || strings.Contains(raw, "203.0.113.99") || strings.Contains(raw, "forged-request") || !strings.Contains(raw, "127.0.0.1") {
		t.Fatalf("审计信息错误: %s", raw)
	}
	if _, err = s.pool.Exec(t.Context(), `UPDATE users SET name='新名称', email='new@example.com' WHERE id=$1`, actor.ID); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		query        string
		total, items int
	}{
		{"page_size=2", 9, 2}, {"page=999&page_size=2", 9, 0}, {"result=failed", 3, 3},
		{"actor=" + url.QueryEscape("审计管理员"), 9, 9}, {"actor=new@example.com", 0, 0}, {"actor=%25", 0, 0},
		{"ip=127.0.0.1", 9, 9}, {"category=model", 9, 9}, {"params=" + url.QueryEscape("测试模型"), 6, 6}, {"params=secret-input", 0, 0},
		{"since=2000-01-01T00:00:00Z&until=2001-01-01T00:00:00Z", 0, 0},
	} {
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest("GET", "/audits?"+tc.query, nil))
		var out struct {
			Total int
			Items []map[string]any
		}
		if err = json.Unmarshal(w.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
		if w.Code != 200 || out.Total != tc.total || len(out.Items) != tc.items || w.Header().Get("Cache-Control") != "private, no-store" {
			t.Fatalf("查询 %s: %d %s", tc.query, w.Code, w.Body)
		}
	}
	if err := s.pool.QueryRow(t.Context(), `SELECT count(*) FROM audits`).Scan(&count); err != nil || count != 9 {
		t.Fatalf("查询不应生成审计: %d %v", count, err)
	}
}

func TestCanceledRequest(t *testing.T) {
	s, actor := fixture(t)
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	router := chi.NewRouter()
	router.Use(s.Middleware(func(*http.Request) Actor { return actor }))
	router.Put("/settings/{key}", func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		cancel()
		w.WriteHeader(204)
	})
	r := httptest.NewRequest("PUT", "/settings/authentication", strings.NewReader(`{"value":{"enabled":true}}`)).WithContext(ctx)
	r.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(httptest.NewRecorder(), r)
	var category, section, result string
	err := s.pool.QueryRow(t.Context(), `SELECT category, request_params->>'settings_section', result FROM audits`).Scan(&category, &section, &result)
	if err != nil || category != "settings" || section != "authentication" || result != "success" {
		t.Fatalf("请求取消导致审计丢失或设置域缺失: %s %s %s %v", category, section, result, err)
	}
}
