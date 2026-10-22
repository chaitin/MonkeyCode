package feedback

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestAdminListUserAvatars(t *testing.T) {
	dsn := os.Getenv("MONKEYAI_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("设置 MONKEYAI_TEST_DATABASE_URL 运行反馈数据库测试")
	}
	ctx := t.Context()
	root, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	schema := "feedback_test_" + strings.ReplaceAll(resource.ID(), "-", "")
	if _, err := root.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		root.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = root.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE")
		root.Close()
	})
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
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
	paths, err := filepath.Glob("../../migrations/*.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		exec(string(data))
	}
	user, other := resource.ID(), resource.ID()
	s := NewService(pool, newMemoryStorage())
	for _, id := range []string{user, other} {
		exec(`INSERT INTO users(id,name,email) VALUES($1,'反馈用户',$2)`, id, id+"@example.com")
		if _, _, err := s.Submit(ctx, id, Request{Category: "bug", Content: "头像测试", Platform: "web"}); err != nil {
			t.Fatal(err)
		}
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
			exec(`UPDATE users SET avatar_url=$2 WHERE id=$1`, user, tc.stored)
			seen := make(map[string]bool)
			for _, page := range []string{"1", "2"} {
				w := httptest.NewRecorder()
				router.ServeHTTP(w, httptest.NewRequest("GET", "/feedback?page_size=1&page="+page, nil))
				var out struct {
					Total int              `json:"total"`
					Items []map[string]any `json:"items"`
				}
				if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
					t.Fatal(err)
				}
				if w.Code != 200 || out.Total != 2 || len(out.Items) != 1 {
					t.Fatalf("分页错误: %d %s", w.Code, w.Body)
				}
				item := out.Items[0]
				owner := item["user_id"].(string)
				if seen[owner] {
					t.Fatalf("反馈分页重复: %v", item)
				}
				seen[owner] = true
				want := tc.want
				if owner == other {
					want = nil
				}
				if item["user_avatar_url"] != want || item["user_name"] != "反馈用户" {
					t.Fatalf("头像或用户信息错误: %v，头像期望 %v", item, want)
				}
			}
		})
	}
	t.Run("large_pages", func(t *testing.T) {
		exec(`INSERT INTO feedbacks(user_id,category,content,platform,state,request_hash)
			SELECT $1,'feature','分页测试','web','new','hash' FROM generate_series(1,505)`, user)
		for _, size := range []int{200, 500} {
			seen := make(map[string]bool)
			for page, offset := 1, 0; offset < 505; page, offset = page+1, offset+size {
				w := httptest.NewRecorder()
				router.ServeHTTP(w, httptest.NewRequest("GET", fmt.Sprintf("/feedback?category=feature&page_size=%d&page=%d", size, page), nil))
				var out struct {
					Items []Feedback `json:"items"`
					Total int        `json:"total"`
					Size  int        `json:"page_size"`
				}
				if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
					t.Fatal(err)
				}
				if w.Code != 200 || out.Total != 505 || out.Size != size || len(out.Items) != min(size, 505-offset) {
					t.Fatalf("反馈大分页错误: %d %s", w.Code, w.Body)
				}
				for _, item := range out.Items {
					if seen[item.ID] {
						t.Fatalf("分页重复: %s", item.ID)
					}
					seen[item.ID] = true
				}
			}
			if len(seen) != 505 {
				t.Fatalf("分页丢失记录: %d", len(seen))
			}
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest("GET", "/feedback?page_size=501", nil))
		if w.Code != 400 {
			t.Fatalf("应拒绝超出上限: %d", w.Code)
		}
	})
}
