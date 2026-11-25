package agentconfig

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/expert"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/kb"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

func TestExpertKnowledgeLifecycle(t *testing.T) {
	r, member, owner := catalogDatabase(t)
	ctx := t.Context()
	catalog := catalogHandler(t, r, member, owner)
	service := expert.NewService(r.store)
	books := kb.NewService(r.store, nil)
	router := chi.NewRouter()
	router.Use(identity.NewService(r.store.Pool, nil, "http://localhost").RequireAgent)
	service.RegisterAgent(router)
	r.store.RegisterSharing(router, map[string]resource.Shareable{"expert": service.CRUD, "kb": books.CRUD})
	request := func(method, path, actor, match string, body any, status int) resource.Object {
		t.Helper()
		data, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest(method, path, bytes.NewReader(data))
		req.Header.Set("Authorization", "Bearer "+actor)
		req.Header.Set("If-Match", match)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != status {
			t.Fatalf("%s %s: %d %s", method, path, w.Code, w.Body.String())
		}
		var out resource.Object
		if w.Body.Len() > 0 {
			if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
				t.Fatal(err)
			}
		}
		return out
	}
	support := request("GET", "/experts/knowledge-support", owner, "", nil, 200)
	if !support.Bool("available") || support.Int("version") != 1 {
		t.Fatal(support)
	}
	request("GET", "/experts/knowledge-support", "", "", nil, 401)
	own, foreign, third := resource.ID(), resource.ID(), resource.ID()
	catalogExec(t, r, "INSERT INTO users(id,name,email) VALUES($1,'第三方','third@example.test')", third)
	for id, uid := range map[string]string{own: owner, foreign: third} {
		catalogExec(t, r, "INSERT INTO knowledge_bases(id,name,ownership_type,owner_user_id,created_by_user_id) VALUES($1,$2,'user',$3,$3)", id, "库-"+id, uid)
	}
	input := resource.Object{"name": "专家", "prompt": "资料问答", "knowledge_base_ids": []string{own, foreign}}
	request("POST", "/experts", owner, "", input, 400)
	shareBook := resource.ShareInput{Resources: []resource.ShareResource{{Type: "kb", ID: foreign}}, UserIDs: []string{owner}, AccessLevel: "read_write"}
	if err := r.store.Share(ctx, third, shareBook, false, map[string]resource.Shareable{"kb": books.CRUD}); err != nil {
		t.Fatal(err)
	}
	e := request("POST", "/experts", owner, "", input, 201)
	path := "/experts/" + e.String("id")
	rev := func(o resource.Object) string { return fmt.Sprintf(`"%v"`, o["revision"]) }
	update := func(ids any, match string, status int) resource.Object {
		return request("PUT", path, owner, match, resource.Object{"name": "专家", "knowledge_base_ids": ids}, status)
	}
	for _, bad := range []any{nil, "not-an-array", []string{own, strings.ToUpper(own)}, []string{"invalid"}, make([]string, 51)} {
		update(bad, rev(e), 400)
	}
	e = request("PUT", path, owner, rev(e), resource.Object{"name": "新名称"}, 200)
	if len(resource.Strings(e["knowledge_base_ids"])) != 2 {
		t.Fatal(e)
	}
	group := resource.ID()
	catalogExec(t, r, "INSERT INTO groups(id,name) VALUES($1,'接收组')", group)
	catalogExec(t, r, "INSERT INTO group_users(group_id,user_id,assigned_by_user_id) VALUES($1,$2,$3)", group, member, owner)
	share := resource.ShareInput{Resources: []resource.ShareResource{{Type: "expert", ID: e.String("id")}}, GroupIDs: []string{group}}
	result := request("POST", "/resources/shares", owner, "", share, 200)
	skipped := result["unshared_knowledge_bases"].([]any)
	if len(skipped) != 1 {
		t.Fatal(result)
	}
	item := skipped[0].(map[string]any)
	if item["id"] != foreign || item["reason"] != "cannot_manage_visibility" || item["name"] != "库-"+foreign {
		t.Fatal(result)
	}
	var etag string
	manifest := func(missing bool, want ...string) {
		t.Helper()
		w := catalogRead(t, catalog, member, path+"/manifest", etag)
		if w.Code != 200 {
			t.Fatalf("权限变化后使用了旧清单: %d", w.Code)
		}
		etag = w.Header().Get("ETag")
		var out resource.Object
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
		slices.Sort(want)
		if !out.Bool("available") || strings.Contains(w.Body.String(), "knowledge_access_missing") != missing || !slices.Equal(resource.Strings(out["knowledge_base_ids"]), want) {
			t.Fatal(w.Body.String())
		}
	}
	manifest(true, own)
	list := catalogRead(t, catalog, member, "/experts", "")
	if !strings.Contains(list.Body.String(), "knowledge_access_missing") || strings.Contains(list.Body.String(), foreign) {
		t.Fatal(list.Body.String())
	}
	access, err := books.GetAccessible(ctx, own, member)
	if err != nil {
		t.Fatal(err)
	}
	perm := access["permissions"].(kb.Permissions)
	if !perm.CanRead || perm.CanWriteContent || perm.CanManagePermissions {
		t.Fatal(perm)
	}
	if _, err := books.GetAccessible(ctx, foreign, member); err == nil {
		t.Fatal("专家转授了他人的知识库")
	}
	shareBook.UserIDs = []string{member}
	if err := r.store.Share(ctx, third, shareBook, false, map[string]resource.Shareable{"kb": books.CRUD}); err != nil {
		t.Fatal(err)
	}
	manifest(false, own, foreign)
	request("DELETE", "/resources/shares", owner, "", share, 204)
	if _, err := books.GetAccessible(ctx, own, member); err == nil {
		t.Fatal("继承访问权限未撤销")
	}
	access, err = books.GetAccessible(ctx, foreign, member)
	if err != nil || !access["permissions"].(kb.Permissions).CanWriteContent {
		t.Fatal(access, err)
	}
	e = request("GET", path, owner, "", nil, 200)
	e = update([]string{}, rev(e), 200)
	if len(resource.Strings(e["knowledge_base_ids"])) != 0 {
		t.Fatal(e)
	}
	request("POST", "/resources/shares", owner, "", share, 204)
}
