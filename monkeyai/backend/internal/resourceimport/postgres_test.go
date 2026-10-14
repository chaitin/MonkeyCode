package resourceimport

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type importStorage map[string][]byte

func (s importStorage) Put(_ context.Context, key string, data []byte, _ string) error {
	s[key] = slices.Clone(data)
	return nil
}
func (s importStorage) Get(_ context.Context, key string) (io.ReadCloser, error) {
	return io.NopCloser(bytes.NewReader(s[key])), nil
}
func (s importStorage) Delete(_ context.Context, key string) error {
	delete(s, key)
	return nil
}
func (s importStorage) Ping(context.Context) error { return nil }

type importTest struct {
	t       *testing.T
	pool    *pgxpool.Pool
	handler http.Handler
	actor   string
	cookie  *http.Cookie
}

func newImportTest(t *testing.T) *importTest {
	t.Helper()
	dsn := os.Getenv("MONKEYAI_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("设置 MONKEYAI_TEST_DATABASE_URL 运行资源包标签数据库测试")
	}
	ctx := t.Context()
	root, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(root.Close)
	schema := "test_import_" + strings.ReplaceAll(resource.ID(), "-", "")
	if _, err := root.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := root.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE"); err != nil {
			t.Error(err)
		}
	})
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
	fixture := &importTest{t: t, pool: pool, actor: resource.ID()}
	paths, err := filepath.Glob("../../migrations/*.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		fixture.exec(string(data))
	}
	fixture.exec(`INSERT INTO users(id,name,email,role) VALUES($1,'管理员','import@example.com','admin')`, fixture.actor)
	fixture.cookie = &http.Cookie{Name: "monkeyai_session", Value: resource.ID()}
	hash := sha256.Sum256([]byte(fixture.cookie.Value))
	fixture.exec(`INSERT INTO browser_sessions(token_hash,user_id,authentication_method,expires_at) VALUES($1,$2,'password',now()+interval '1 hour')`, hex.EncodeToString(hash[:]), fixture.actor)
	router := chi.NewRouter()
	router.Use(identity.NewService(pool, nil, "").RequireAdmin)
	NewService(pool, importStorage{}).RegisterAdmin(router)
	fixture.handler = router
	return fixture
}

func (f *importTest) exec(query string, args ...any) {
	f.t.Helper()
	if _, err := f.pool.Exec(f.t.Context(), query, args...); err != nil {
		f.t.Fatal(err)
	}
}

func (f *importTest) post(data []byte, previous *Preview, wantStatus int) Preview {
	f.t.Helper()
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	file, err := form.CreateFormFile("package", "release.zip")
	if err != nil {
		f.t.Fatal(err)
	}
	if _, err := file.Write(data); err != nil {
		f.t.Fatal(err)
	}
	fields := map[string]string{"options": `{"confirm_final":true,"accept_normalization":true}`}
	path := "/resource-imports/preview"
	if previous != nil {
		path = "/resource-imports"
		fields["package_sha256"], fields["plan_digest"] = previous.PackageSHA256, previous.PlanDigest
	}
	for name, value := range fields {
		if err := form.WriteField(name, value); err != nil {
			f.t.Fatal(err)
		}
	}
	if err := form.Close(); err != nil {
		f.t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, path, &body)
	request.Header.Set("Content-Type", form.FormDataContentType())
	request.AddCookie(f.cookie)
	response := httptest.NewRecorder()
	f.handler.ServeHTTP(response, request)
	if response.Code != wantStatus {
		f.t.Fatalf("%s: %d %s", path, response.Code, response.Body.String())
	}
	var preview Preview
	if wantStatus == http.StatusOK {
		if err := json.Unmarshal(response.Body.Bytes(), &preview); err != nil {
			f.t.Fatal(err)
		}
	}
	return preview
}

func taggedFixture(t *testing.T, version int64, tags []string) []byte {
	t.Helper()
	return packageFixture(t, func(m *Manifest, files map[string][]byte) {
		m.Version, m.ReleaseID = version, fmt.Sprintf("6321da1e-bf59-41a1-9ae9-%012d", version)
		m.AgentResources.Skills[0].Tags = tags
		files["agent/rules/demo.json"] = []byte(`{"slug":"demo-rule","name":"Demo rule","content":"Rule content"}`)
		files["agent/connectors/demo.json"] = []byte(`{"slug":"demo-connector","name":"Demo connector","config":{"transport":"http","url":"https://example.com/mcp","timeout_ms":60000,"auth":{"mode":"none"},"header_schema":[]}}`)
		expert, err := makeZIP(map[string][]byte{
			"expert.json":      []byte(`{"slug":"demo-expert","name":"Demo expert","prompt_path":"agents/expert.md","depends_on":{}}`),
			"agents/expert.md": []byte("Expert prompt"),
		})
		if err != nil {
			t.Fatal(err)
		}
		files["agent/experts/demo.zip"] = expert
		m.AgentResources.Rules = []Entry{{Type: "rule", Slug: "demo-rule", Name: "Demo rule", Tags: tags, Path: "agent/rules/demo.json", SHA256: digest(files["agent/rules/demo.json"])}}
		m.AgentResources.Connectors = []Entry{{Type: "connector", Slug: "demo-connector", Name: "Demo connector", Tags: tags, Path: "agent/connectors/demo.json", SHA256: digest(files["agent/connectors/demo.json"])}}
		m.AgentResources.Experts = []Entry{{Type: "expert", Slug: "demo-expert", Name: "Demo expert", Tags: tags, Path: "agent/experts/demo.zip", SHA256: digest(expert)}}
	})
}

func TestImportTags(t *testing.T) {
	f := newImportTest(t)
	existing := resource.ID()
	f.exec(`INSERT INTO tags(id,name,created_by_user_id) VALUES($1,'work',$2)`, existing, f.actor)
	f.exec(`INSERT INTO tags(name,created_by_user_id,deleted_at) VALUES('百智办公',$1,now())`, f.actor)
	apply := func(version int64, tags []string, action string) {
		t.Helper()
		data := taggedFixture(t, version, tags)
		preview := f.post(data, nil, http.StatusOK)
		if len(preview.Changes) != 4 {
			t.Fatalf("四类资源未完整预览: %+v", preview)
		}
		for _, change := range preview.Changes {
			if change.Action != action {
				t.Fatalf("v%d %s: %s，预期 %s", version, change.Slug, change.Action, action)
			}
		}
		f.post(data, &preview, http.StatusOK)
	}
	apply(16, []string{"百智办公", "WORK", "work"}, "create")
	current, err := bindings(t.Context(), f.pool, "monkeyai-respub")
	if err != nil {
		t.Fatal(err)
	}
	assertTags := func(want []string) {
		t.Helper()
		for _, item := range current {
			tags, err := resource.Tags(t.Context(), f.pool, item.Type, item.ID)
			if err != nil {
				t.Fatal(err)
			}
			names := []string{}
			for _, tag := range tags {
				names = append(names, tag.String("name"))
				if tag.String("name") == "work" && tag.String("id") != existing {
					t.Fatal("同名标签未复用原 ID")
				}
			}
			if !slices.Equal(names, want) {
				t.Fatalf("%s 标签: %v，预期 %v", item.Type, names, want)
			}
		}
	}
	assertTags([]string{"work", "百智办公"})
	var count int
	if err := f.pool.QueryRow(t.Context(), `SELECT count(*) FROM tags WHERE deleted_at IS NULL`).Scan(&count); err != nil || count != 2 {
		t.Fatalf("不同资源应复用标签: %d %v", count, err)
	}
	grants := map[string]string{}
	for _, item := range current {
		grants[item.ID] = resource.ID()
		f.exec(`INSERT INTO resource_access_grants(id,resource_type,resource_id,user_id,access_level,granted_by_user_id) VALUES($1,$2,$3,$4,'read_only',$4)`, grants[item.ID], item.Type, item.ID, f.actor)
	}
	apply(17, []string{"work", "百智办公", "WORK"}, "skip")
	apply(18, []string{"替换标签"}, "update")
	assertTags([]string{"替换标签"})
	apply(19, []string{}, "update")
	assertTags([]string{})
	apply(20, []string{"保留标签"}, "update")
	apply(21, nil, "update")
	assertTags([]string{"保留标签"})
	apply(22, nil, "skip")
	data := taggedFixture(t, 22, nil)
	preview := f.post(data, nil, http.StatusOK)
	if !preview.AlreadyImported {
		t.Fatal("重复导入应返回已导入状态")
	}
	f.post(data, &preview, http.StatusOK)

	f.exec(`CREATE FUNCTION reject_expert_tag() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.resource_type='expert' THEN RAISE EXCEPTION 'test tag failure'; END IF; RETURN NEW; END $$;
CREATE TRIGGER reject_expert_tag BEFORE INSERT ON resource_tags FOR EACH ROW EXECUTE FUNCTION reject_expert_tag()`)
	data = taggedFixture(t, 23, []string{"应回滚的新标签"})
	preview = f.post(data, nil, http.StatusOK)
	f.post(data, &preview, http.StatusInternalServerError)
	assertTags([]string{"保留标签"})
	if err := f.pool.QueryRow(t.Context(), `SELECT count(*) FROM tags WHERE name='应回滚的新标签'`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("失败导入留下了新标签: %d %v", count, err)
	}
	if err := f.pool.QueryRow(t.Context(), `SELECT count(*) FROM resource_imports WHERE version=23`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("失败导入留下了成功批次: %d %v", count, err)
	}
	updated, err := bindings(t.Context(), f.pool, "monkeyai-respub")
	if err != nil {
		t.Fatal(err)
	}
	for slug, item := range updated {
		if item.ID != current[slug].ID {
			t.Fatalf("标签更新更换了资源 ID: %s", slug)
		}
		if err := f.pool.QueryRow(t.Context(), `SELECT count(*) FROM resource_access_grants WHERE id=$1 AND resource_type=$2 AND resource_id=$3 AND user_id=$4`, grants[item.ID], item.Type, item.ID, f.actor).Scan(&count); err != nil || count != 1 {
			t.Fatalf("标签导入改变了原授权: %s %d %v", item.Type, count, err)
		}
	}
}

func TestTaggedReleaseImport(t *testing.T) {
	path := os.Getenv("MONKEYAI_TAGGED_RELEASE_FIXTURE")
	if path == "" {
		t.Skip("设置 MONKEYAI_TAGGED_RELEASE_FIXTURE 运行真实标签发布包导入测试")
	}
	f := newImportTest(t)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	preview := f.post(data, nil, http.StatusOK)
	f.post(data, &preview, http.StatusOK)
	current, err := bindings(t.Context(), f.pool, preview.Publisher)
	if err != nil {
		t.Fatal(err)
	}
	if len(current) != len(preview.Changes) || len(current) == 0 {
		t.Fatal("实际包导入的资源数量不符")
	}
	for _, change := range preview.Changes {
		item := current[change.Slug]
		tags, err := resource.Tags(t.Context(), f.pool, item.Type, item.ID)
		if err != nil {
			t.Fatal(err)
		}
		if len(tags) != len(change.Tags) || len(tags) == 0 {
			t.Fatalf("%s 的标签未生效: %v", change.Slug, tags)
		}
		for _, tag := range tags {
			if !slices.Contains(change.Tags, tag.String("name")) {
				t.Fatalf("%s 标签不符: %v", change.Slug, tags)
			}
		}
	}
	t.Logf("实际发布包 v%d 的 %d 个资源均已导入标签", preview.Version, len(current))
}
