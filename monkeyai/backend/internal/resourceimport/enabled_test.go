package resourceimport

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/skill"
	"github.com/go-chi/chi/v5"
)

func TestImportedSkillEnabled(t *testing.T) {
	f := newImportTest(t)
	apply := func(data []byte) {
		t.Helper()
		preview := f.post(data, nil, http.StatusOK)
		f.post(data, &preview, http.StatusOK)
	}
	apply(taggedFixture(t, 16, []string{"初始标签"}))
	current, err := bindings(t.Context(), f.pool, "monkeyai-respub")
	if err != nil {
		t.Fatal(err)
	}
	id := current["demo-skill"].ID
	if id == "" {
		t.Fatalf("缺少导入技能: %+v", current)
	}
	f.exec(`UPDATE skills SET admin_overrides='{"name":true}'::jsonb WHERE id=$1`, id)
	store := resource.NewStore(f.pool)
	router := chi.NewRouter()
	router.Use(identity.NewService(f.pool, nil, "").RequireAdmin)
	skill.NewService(store, nil).RegisterAdmin(router)
	call := func(method, target, match string, input any, want int) resource.Object {
		t.Helper()
		body, err := json.Marshal(input)
		if err != nil {
			t.Fatal(err)
		}
		request := httptest.NewRequest(method, target, bytes.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		if match != "" {
			request.Header.Set("If-Match", match)
		}
		request.AddCookie(f.cookie)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != want {
			t.Fatalf("%s %s: %d %s，预期 %d", method, target, response.Code, response.Body.String(), want)
		}
		var out resource.Object
		if want == http.StatusOK {
			if err := json.Unmarshal(response.Body.Bytes(), &out); err != nil {
				t.Fatal(err)
			}
			if etag := response.Header().Get("ETag"); etag != fmt.Sprintf(`"%d"`, out.Int("revision")) {
				t.Fatalf("ETag 与版本不一致: %s %+v", etag, out)
			}
		}
		return out
	}
	path := "/skills/" + id
	read := func() resource.Object { return call(http.MethodGet, path, "", nil, http.StatusOK) }
	etag := func(object resource.Object) string { return fmt.Sprintf(`"%d"`, object.Int("revision")) }
	snapshot := func() string {
		t.Helper()
		var data string
		if err := f.pool.QueryRow(t.Context(), `SELECT jsonb_build_array(
			to_jsonb(s)-'enabled'-'revision'-'updated_at'-'admin_overrides',
			(SELECT jsonb_agg(to_jsonb(g) ORDER BY id) FROM resource_access_grants g WHERE resource_type='skill' AND resource_id=s.id),
			(SELECT jsonb_agg(to_jsonb(g) ORDER BY tag_id) FROM resource_tags g WHERE resource_type='skill' AND resource_id=s.id),
			(SELECT to_jsonb(b) FROM resource_import_bindings b WHERE resource_type='skill' AND resource_id=s.id))::text FROM skills s WHERE id=$1`, id).Scan(&data); err != nil {
			t.Fatal(err)
		}
		return data
	}
	before := read()
	original := snapshot()
	disabled := call(http.MethodPatch, path+"/enabled", etag(before), resource.Object{"enabled": false}, http.StatusOK)
	if disabled.Bool("enabled") || disabled.Int("revision") != before.Int("revision")+1 || snapshot() != original {
		t.Fatalf("停用改变了内容、标签、授权或绑定: %+v", disabled)
	}
	var overrides map[string]bool
	if err := f.pool.QueryRow(t.Context(), "SELECT admin_overrides FROM skills WHERE id=$1", id).Scan(&overrides); err != nil || !overrides["enabled"] || !overrides["name"] {
		t.Fatalf("未保留已有覆盖或记录手动启停: %+v %v", overrides, err)
	}
	call(http.MethodPatch, path+"/enabled", etag(before), resource.Object{"enabled": true}, http.StatusPreconditionFailed)
	call(http.MethodPatch, path+"/enabled", "", resource.Object{"enabled": true}, http.StatusPreconditionFailed)
	call(http.MethodPatch, path+"/enabled", etag(disabled), resource.Object{"enabled": "true"}, http.StatusBadRequest)
	if after := read(); after.Bool("enabled") || after.Int("revision") != disabled.Int("revision") || snapshot() != original {
		t.Fatalf("无效请求改变了技能: %+v", after)
	}
	for _, field := range []string{"content", "tag_ids"} {
		call(http.MethodPut, path, etag(disabled), resource.Object{field: []string{}}, http.StatusBadRequest)
	}
	call(http.MethodDelete, path, etag(disabled), nil, http.StatusConflict)
	if after := read(); after.Int("revision") != disabled.Int("revision") || snapshot() != original {
		t.Fatalf("启停放开了其他受限修改: %+v", after)
	}
	apply(taggedFixture(t, 17, []string{"更新标签"}))
	if read().Bool("enabled") {
		t.Fatal("资源包更新覆盖了手动停用状态")
	}
	before = read()
	enabled := call(http.MethodPatch, path+"/enabled", etag(before), resource.Object{"enabled": true}, http.StatusOK)
	if !enabled.Bool("enabled") || enabled.Int("revision") != before.Int("revision")+1 {
		t.Fatalf("资源包技能无法重新启用: %+v", enabled)
	}
	apply(taggedFixture(t, 18, []string{"再次更新标签"}))
	if !read().Bool("enabled") {
		t.Fatal("资源包更新未保留手动启用状态")
	}
	retire := func(version int64) []byte {
		return packageFixture(t, func(m *Manifest, _ map[string][]byte) {
			m.Version = version
			m.ReleaseID = fmt.Sprintf("6321da1e-bf59-41a1-9ae9-%012d", version)
			m.AgentResources = AgentResources{}
		})
	}
	apply(retire(19))
	before = read()
	if before.Bool("enabled") || !before.Bool("retired") {
		t.Fatalf("退役未停用技能: %+v", before)
	}
	call(http.MethodPatch, path+"/enabled", etag(before), resource.Object{"enabled": true}, http.StatusOK)
	apply(taggedFixture(t, 20, []string{"恢复标签"}))
	if after := read(); !after.Bool("enabled") || after.Bool("retired") {
		t.Fatalf("手动启用的技能无法正常恢复导入: %+v", after)
	}
	before = read()
	call(http.MethodPatch, path+"/enabled", etag(before), resource.Object{"enabled": false}, http.StatusOK)
	apply(retire(21))
	apply(taggedFixture(t, 22, []string{"再次恢复标签"}))
	if after := read(); after.Bool("enabled") || after.Bool("retired") {
		t.Fatalf("手动停用的技能在恢复导入后被自动启用: %+v", after)
	}

	for _, ownership := range []string{"system", "user"} {
		localID := resource.ID()
		f.exec(`INSERT INTO skills(id,owner_user_id,ownership_type,name,description,package_file_name,package_s3_key,package_size_bytes,package_sha256)
			VALUES($1,$2,$3,'local','description','local.zip','local.zip',0,'hash')`, localID, f.actor, ownership)
		localPath := "/skills/" + localID
		old := call(http.MethodGet, localPath, "", nil, http.StatusOK)
		want := http.StatusOK
		if ownership == "user" {
			want = http.StatusBadRequest
		}
		call(http.MethodPatch, localPath+"/enabled", etag(old), resource.Object{"enabled": false}, want)
		var changed bool
		if err := f.pool.QueryRow(t.Context(), "SELECT admin_overrides ? 'enabled' FROM skills WHERE id=$1", localID).Scan(&changed); err != nil || changed {
			t.Fatalf("本地或个人技能不应记录导入覆盖: %v %v", changed, err)
		}
	}
}
