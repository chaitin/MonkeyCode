package resourceimport

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/expert"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/mcp"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/rule"
	"github.com/go-chi/chi/v5"
)

func TestImportedResourcesEnabled(t *testing.T) {
	f := newImportTest(t)
	apply := func(data []byte) {
		t.Helper()
		preview := f.post(data, nil, http.StatusOK)
		f.post(data, &preview, http.StatusOK)
	}
	apply(taggedFixture(t, 30, []string{"初始标签"}))
	current, err := bindings(t.Context(), f.pool, "monkeyai-respub")
	if err != nil {
		t.Fatal(err)
	}
	store := resource.NewStore(f.pool)
	router := chi.NewRouter()
	router.Use(identity.NewService(f.pool, nil, "").RequireAdmin)
	expert.NewService(store).RegisterAdmin(router)
	mcp.NewService(store, "").RegisterAdmin(router)
	rule.NewService(store).Register(router)
	store.RegisterAdmin(router)
	call := func(method, target, etag string, input any, want int) resource.Object {
		t.Helper()
		body, err := json.Marshal(input)
		if err != nil {
			t.Fatal(err)
		}
		request := httptest.NewRequest(method, target, bytes.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("If-Match", etag)
		request.AddCookie(f.cookie)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != want {
			t.Fatalf("%s %s: %d %s, want %d", method, target, response.Code, response.Body.String(), want)
		}
		var out resource.Object
		if want == http.StatusOK {
			if err := json.Unmarshal(response.Body.Bytes(), &out); err != nil {
				t.Fatal(err)
			}
		}
		return out
	}
	etag := func(o resource.Object) string { return fmt.Sprintf(`"%d"`, o.Int("revision")) }
	type target struct{ kind, table, path, id string }
	var targets []target
	for _, item := range []struct{ kind, table string }{{"expert", "experts"}, {"connector", "connectors"}, {"rule", "rules"}} {
		id := current["demo-"+item.kind].ID
		if id == "" {
			t.Fatalf("missing imported %s", item.kind)
		}
		targets = append(targets, target{item.kind, item.table, "/" + item.table + "/" + id, id})
		f.exec(fmt.Sprintf(`UPDATE %s SET admin_overrides='{"name":true}'::jsonb WHERE id=$1`, item.table), id)
	}
	read := func(item target) resource.Object { return call(http.MethodGet, item.path, "", nil, http.StatusOK) }
	snapshot := func(item target) string {
		t.Helper()
		var result string
		err := f.pool.QueryRow(t.Context(), fmt.Sprintf(`SELECT jsonb_build_array(
			to_jsonb(r)-'enabled'-'revision'-'updated_at'-'admin_overrides',
			(SELECT jsonb_agg(to_jsonb(g) ORDER BY id) FROM resource_access_grants g WHERE resource_type=$1 AND resource_id=r.id),
			(SELECT jsonb_agg(to_jsonb(g) ORDER BY tag_id) FROM resource_tags g WHERE resource_type=$1 AND resource_id=r.id),
			(SELECT to_jsonb(b) FROM resource_import_bindings b WHERE resource_type=$1 AND resource_id=r.id))::text FROM %s r WHERE id=$2`, item.table), item.kind, item.id).Scan(&result)
		if err != nil {
			t.Fatal(err)
		}
		return result
	}
	for _, item := range targets {
		before, original := read(item), snapshot(item)
		disabled := call(http.MethodPatch, item.path+"/enabled", etag(before), resource.Object{"enabled": false}, http.StatusOK)
		if disabled.Bool("enabled") || disabled.Int("revision") != before.Int("revision")+1 || snapshot(item) != original {
			t.Fatalf("%s toggle changed content, configuration, tags, grants or binding: %+v", item.kind, disabled)
		}
		var overrides map[string]bool
		if err := f.pool.QueryRow(t.Context(), fmt.Sprintf("SELECT admin_overrides FROM %s WHERE id=$1", item.table), item.id).Scan(&overrides); err != nil || !overrides["name"] || !overrides["enabled"] {
			t.Fatalf("%s lost manual overrides: %+v %v", item.kind, overrides, err)
		}
		call(http.MethodPatch, item.path+"/enabled", etag(before), resource.Object{"enabled": true}, http.StatusPreconditionFailed)
		call(http.MethodPatch, item.path+"/enabled", "", resource.Object{"enabled": true}, http.StatusPreconditionFailed)
		call(http.MethodPatch, item.path+"/enabled", etag(disabled), resource.Object{"enabled": "true"}, http.StatusBadRequest)
		call(http.MethodDelete, item.path, etag(disabled), nil, http.StatusConflict)
		if after := read(item); after.Bool("enabled") || after.Int("revision") != disabled.Int("revision") || snapshot(item) != original {
			t.Fatalf("invalid %s mutation changed resource", item.kind)
		}
	}
	assertState := func(enabled, retired bool) {
		t.Helper()
		for _, item := range targets {
			if after := read(item); after.Bool("enabled") != enabled || after.Bool("retired") != retired {
				t.Fatalf("%s state: %+v, want enabled=%t retired=%t", item.kind, after, enabled, retired)
			}
		}
	}
	toggleAll := func(enabled bool) {
		for _, item := range targets {
			call(http.MethodPatch, item.path+"/enabled", etag(read(item)), resource.Object{"enabled": enabled}, http.StatusOK)
		}
	}
	retire := func(version int64) []byte {
		return packageFixture(t, func(m *Manifest, _ map[string][]byte) {
			m.Version = version
			m.ReleaseID = fmt.Sprintf("7321da1e-bf59-41a1-9ae9-%012d", version)
			m.AgentResources = AgentResources{}
		})
	}
	apply(taggedFixture(t, 31, []string{"更新标签"}))
	assertState(false, false)
	toggleAll(true)
	apply(taggedFixture(t, 32, []string{"再次更新标签"}))
	assertState(true, false)
	apply(retire(33))
	assertState(false, true)
	toggleAll(true)
	apply(taggedFixture(t, 34, []string{"恢复标签"}))
	assertState(true, false)
	toggleAll(false)
	apply(retire(35))
	apply(taggedFixture(t, 36, []string{"再次恢复标签"}))
	assertState(false, false)

	t.Run("local rule tags preserve content and required grants", func(t *testing.T) {
		created := call(http.MethodPost, "/rules", "", resource.Object{
			"name": "local rule", "description": "canonical description", "content": "original content",
			"grants": []resource.Object{{"user_id": f.actor, "usage_requirement": "required"}},
		}, http.StatusOK)
		path := "/rules/" + created.String("id")
		tag := resource.ID()
		f.exec("INSERT INTO tags(id,name,created_by_user_id) VALUES($1,'batch tag',$2)", tag, f.actor)
		update := func(o resource.Object, tags []string, want int) resource.Object {
			return call(http.MethodPut, path, etag(o), resource.Object{"name": o.String("name"), "description": o.String("description"), "content": o.String("content"), "tag_ids": tags}, want)
		}
		updated := update(created, []string{tag, tag}, http.StatusOK)
		var links int
		if err := f.pool.QueryRow(t.Context(), "SELECT count(*) FROM resource_tags WHERE resource_type='rule' AND resource_id=$1", created.String("id")).Scan(&links); err != nil || links != 1 {
			t.Fatalf("rule tags not saved once: %d %v", links, err)
		}
		if updated.String("content") != "original content" || updated.String("description") != "canonical description" || !updated.Bool("enabled") {
			t.Fatalf("tag update changed rule settings: %+v", updated)
		}
		if tags, ok := updated["tags"].([]any); !ok || len(tags) != 1 {
			t.Fatalf("rule tags missing in response: %+v", updated)
		}
		var required bool
		if err := f.pool.QueryRow(t.Context(), "SELECT usage_requirement='required' FROM resource_access_grants WHERE resource_type='rule' AND resource_id=$1 AND user_id=$2", created.String("id"), f.actor).Scan(&required); err != nil || !required {
			t.Fatalf("tag update lost required authorization: %t %v", required, err)
		}
		update(updated, []string{resource.ID()}, http.StatusBadRequest)
		after := call(http.MethodGet, path, "", nil, http.StatusOK)
		if after.Int("revision") != updated.Int("revision") || len(after["tags"].([]any)) != 1 {
			t.Fatalf("invalid tag update did not roll back: %+v", after)
		}
		cleared := update(after, []string{}, http.StatusOK)
		if len(cleared["tags"].([]any)) != 0 {
			t.Fatalf("empty tag update did not clear tags: %+v", cleared)
		}
	})
}
