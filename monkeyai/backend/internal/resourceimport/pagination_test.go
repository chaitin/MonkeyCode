package resourceimport

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestHistoryPageSizes(t *testing.T) {
	dsn := os.Getenv("MONKEYAI_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("设置 MONKEYAI_TEST_DATABASE_URL 运行导入记录分页测试")
	}
	ctx := t.Context()
	root, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	schema := "import_pages_" + strings.ReplaceAll(resource.ID(), "-", "")
	if _, err := root.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		root.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = root.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE"); root.Close() })
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	files, err := filepath.Glob("../../migrations/*.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range files {
		data, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		exec(string(data))
	}
	user := resource.ID()
	exec(`INSERT INTO users(id,name,email) VALUES($1,'分页测试','import-pages@example.com')`, user)
	exec(`INSERT INTO resource_imports(id,publisher,release_id,version,manifest_sha256,actor_user_id,status,created_at)
		SELECT ('00000000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid,'pagination',gen_random_uuid(),i,
		'sha256:' || repeat('a',64),$1,'succeeded',$2 FROM generate_series(1,505) i`, user,
		time.Date(2026, 10, 10, 12, 34, 56, 123456000, time.UTC))
	router := chi.NewRouter()
	NewService(pool, nil).RegisterAdmin(router)
	get := func(t *testing.T, query url.Values, status int) (items []resource.Object, cursor string) {
		t.Helper()
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest("GET", "/resource-imports?"+query.Encode(), nil))
		if w.Code != status {
			t.Fatalf("状态码错误: got=%d want=%d", w.Code, status)
		}
		if status != 200 {
			return nil, ""
		}
		var out struct {
			Items  []resource.Object `json:"items"`
			Cursor string            `json:"next_cursor"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
		return out.Items, out.Cursor
	}
	for _, requested := range []string{"", "20", "50", "100", "200", "500"} {
		t.Run("limit_"+requested, func(t *testing.T) {
			size := 20
			if requested != "" {
				_, _ = fmt.Sscan(requested, &size)
			}
			query := url.Values{}
			if requested != "" {
				query.Set("limit", requested)
			}
			for offset := 0; offset < 505; offset += size {
				items, cursor := get(t, query, 200)
				if len(items) != min(size, 505-offset) {
					t.Fatalf("size=%d offset=%d count=%d", size, offset, len(items))
				}
				for index, item := range items {
					want := fmt.Sprintf("00000000-0000-4000-8000-%012d", 505-offset-index)
					if item.String("id") != want {
						t.Fatalf("同时间记录分页重复或丢失: got=%s want=%s", item.String("id"), want)
					}
				}
				if (cursor != "") != (offset+size < 505) {
					t.Fatalf("分页游标错误: offset=%d cursor=%q", offset, cursor)
				}
				query.Set("cursor", cursor)
			}
		})
	}
	for _, invalid := range []string{"0", "501", "bad", "-1"} {
		get(t, url.Values{"limit": {invalid}}, 400)
	}
	get(t, url.Values{"limit": {"500"}, "cursor": {"invalid"}}, 400)
	exec("DELETE FROM resource_imports")
	items, cursor := get(t, url.Values{"limit": {"500"}}, 200)
	if len(items) != 0 || cursor != "" {
		t.Fatal("空列表分页错误")
	}
}
