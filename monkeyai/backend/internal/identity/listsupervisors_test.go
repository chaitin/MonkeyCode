package identity

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/memberscope"
	"github.com/go-chi/chi/v5"
)

func TestAdminListUserSupervisedGroups(t *testing.T) {
	pool := emailDatabase(t)
	ctx := t.Context()
	service := newTestService(pool, nil, "http://localhost")
	manager, err := service.insertUser(ctx, "主管", "lead@example.test", "user", "")
	if err != nil {
		t.Fatal(err)
	}
	admin, err := service.insertUser(ctx, "管理员", "admin@example.test", "admin", "")
	if err != nil {
		t.Fatal(err)
	}
	var want []supervisedGroup
	for _, c := range []struct {
		name                         string
		supervisor, removed, deleted bool
	}{
		{"B", true, false, false}, {"A", true, false, false},
		{"普通成员", false, false, false}, {"已离组", true, true, false}, {"已删除分组", true, false, true},
	} {
		var id string
		if err := pool.QueryRow(ctx, `INSERT INTO groups(name, deleted_at) VALUES ($1,CASE WHEN $2 THEN now() END) RETURNING id`, c.name, c.deleted).Scan(&id); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, `INSERT INTO group_users(group_id, user_id, assigned_by_user_id, is_supervisor, removed_at) VALUES($1,$2,$3,$4,CASE WHEN $5 THEN now() END)`, id, manager.ID, admin.ID, c.supervisor, c.removed); err != nil {
			t.Fatal(err)
		}
		if c.supervisor && !c.removed && !c.deleted {
			want = append(want, supervisedGroup{ID: id, Name: c.name})
		}
	}
	slices.Reverse(want)
	router := chi.NewRouter()
	service.RegisterAdmin(router)
	service.RegisterMemberReads(memberscope.AdminOnly(router.Get))
	service.RegisterSharedAdminReads(router.Get)
	res := httptest.NewRecorder()
	router.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/users", nil))
	var body struct{ Users []adminListUser }
	if res.Code != http.StatusOK {
		t.Fatalf("成员列表请求失败: %d %s", res.Code, res.Body.String())
	}
	if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Users) != 2 {
		t.Fatalf("成员数量不符: %v", body.Users)
	}
	for _, u := range body.Users {
		detail := httptest.NewRecorder()
		router.ServeHTTP(detail, httptest.NewRequest(http.MethodGet, "/users/"+u.ID, nil))
		var got adminListUser
		if detail.Code != http.StatusOK || json.Unmarshal(detail.Body.Bytes(), &got) != nil ||
			got.ID != u.ID || got.Role != u.Role || got.SupervisedGroups == nil || !slices.Equal(got.SupervisedGroups, u.SupervisedGroups) {
			t.Fatalf("成员详情与列表不一致: %d %s，列表成员: %+v", detail.Code, detail.Body.String(), u)
		}
		if u.ID == manager.ID {
			if u.Role != "user" || !slices.Equal(u.SupervisedGroups, want) {
				t.Fatalf("主管组范围有误: %+v", u)
			}
		} else if u.ID != admin.ID || u.SupervisedGroups == nil || len(u.SupervisedGroups) != 0 {
			t.Fatalf("未任主管的管理员应返回空数组: %+v", u)
		}
	}
}
