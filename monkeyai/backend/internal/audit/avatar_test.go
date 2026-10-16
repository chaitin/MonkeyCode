package audit

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
)

func TestPageActorAvatar(t *testing.T) {
	s, actor := fixture(t)
	const otherID = "22222222-2222-4222-8222-222222222222"
	ctx := t.Context()
	if _, err := s.pool.Exec(ctx, `INSERT INTO users(id,name,email) VALUES($1,'无头像用户','no-avatar@example.com')`, otherID); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{actor.ID, otherID} {
		if err := Write(ctx, s.pool, Event{ActorID: id, Action: "save", Category: "model"}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.pool.Exec(ctx, `INSERT INTO audits(actor_type,actor_name,action,category,result,occurred_at)
		VALUES('system','系统','save','model','success',$1)`, time.Now().Add(-time.Hour)); err != nil {
		t.Fatal(err)
	}
	router := chi.NewRouter()
	s.RegisterAdmin(router)
	readPage := func(query string, total, size int) []map[string]any {
		t.Helper()
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest("GET", "/audits?"+query, nil))
		var out struct {
			Total int              `json:"total"`
			Items []map[string]any `json:"items"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
		if w.Code != 200 || out.Total != total || len(out.Items) != size {
			t.Fatalf("查询 %s: %d %s", query, w.Code, w.Body)
		}
		for _, item := range out.Items {
			if _, ok := item["actor_avatar_url"]; !ok {
				t.Fatalf("操作记录缺少头像字段: %v", item)
			}
		}
		return out.Items
	}
	for _, tc := range []struct {
		name   string
		stored any
		want   any
	}{
		{"url", "https://example.com/avatar.webp", "https://example.com/avatar.webp"},
		{"changed", "https://example.com/new-avatar.webp", "https://example.com/new-avatar.webp"},
		{"trimmed", "  https://example.com/avatar.webp  ", "https://example.com/avatar.webp"},
		{"empty", "", nil},
		{"blank", "   ", nil},
		{"null", nil, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := s.pool.Exec(ctx, `UPDATE users SET avatar_url=$2,name='当前名称',email='current@example.com' WHERE id=$1`, actor.ID, tc.stored); err != nil {
				t.Fatal(err)
			}
			seen := make(map[any]bool)
			for _, query := range []string{"page=1&page_size=1", "page=2&page_size=1", "page=3&page_size=1"} {
				item := readPage(query, 3, 1)[0]
				if seen[item["id"]] {
					t.Fatalf("分页出现重复记录: %v", item)
				}
				seen[item["id"]] = true
				if item["actor_user_id"] == actor.ID {
					if item["actor_avatar_url"] != tc.want || item["actor_name"] != actor.Name || item["actor_email"] != actor.Email {
						t.Fatalf("头像或历史快照错误: %v，头像期望 %v", item, tc.want)
					}
				} else if item["actor_avatar_url"] != nil {
					t.Fatalf("无头像用户和系统记录应返回 null: %v", item)
				}
			}
			readPage("page=4&page_size=1", 3, 0)
		})
	}
	if _, err := s.pool.Exec(ctx, `DELETE FROM users WHERE id=$1`, actor.ID); err != nil {
		t.Fatal(err)
	}
	for _, item := range readPage("page_size=50", 3, 3) {
		if item["actor_name"] == actor.Name && (item["actor_user_id"] != nil || item["actor_avatar_url"] != nil || item["actor_email"] != actor.Email) {
			t.Fatalf("删除用户后应保留历史记录并返回空头像: %v", item)
		}
	}
}
