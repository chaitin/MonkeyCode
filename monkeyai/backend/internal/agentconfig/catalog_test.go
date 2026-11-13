package agentconfig

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/mcp"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/jackc/pgx/v5/pgxpool"
)

func catalogDatabase(t testing.TB) (*Resources, string, string) {
	t.Helper()
	dsn := os.Getenv("MONKEYAI_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("设置 MONKEYAI_TEST_DATABASE_URL 运行资源目录数据库测试")
	}
	ctx := context.Background()
	root, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	schema := "test_catalog_" + strings.ReplaceAll(resource.ID(), "-", "")
	if _, err := root.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		root.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, err := root.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE")
		if err != nil {
			t.Error(err)
		}
		root.Close()
	})
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	cfg.ConnConfig.Tracer = new(catalogTrace)
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	paths, err := filepath.Glob("../../migrations/*.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range paths {
		up, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, string(up)); err != nil {
			t.Fatalf("%s: %v", path, err)
		}
	}
	user, other := resource.ID(), resource.ID()
	for _, id := range []string{user, other} {
		if _, err := pool.Exec(ctx, "INSERT INTO users(id,name,email) VALUES($1,$2,$3)", id, id, id); err != nil {
			t.Fatal(err)
		}
	}
	store := resource.NewStore(pool)
	return NewResources(store, mcp.NewService(store, "http://localhost:8080"), nil), user, other
}

func catalogExec(t testing.TB, r *Resources, query string, args ...any) {
	t.Helper()
	if _, err := r.store.Pool.Exec(context.Background(), query, args...); err != nil {
		t.Fatal(err)
	}
}

func seedCatalog(t testing.TB, r *Resources, user, other string) {
	t.Helper()
	parent, child := resource.ID(), resource.ID()
	catalogExec(t, r, "INSERT INTO groups(id,name) VALUES($1,'parent')", parent)
	catalogExec(t, r, "INSERT INTO groups(id,name,parent_id) VALUES($1,'child',$2)", child, parent)
	catalogExec(t, r, "INSERT INTO group_users(group_id,user_id,assigned_by_user_id) VALUES($1,$2,$2)", child, user)
	for _, kind := range []string{"rules", "skills", "experts", "connectors"} {
		for i := range 9 {
			id := fmt.Sprintf("10000000-0000-0000-0000-%012d", i+1)
			owner, ownership := other, "user"
			if i < 2 || i == 7 || i == 8 {
				owner = user
			}
			if i == 4 || i == 5 {
				ownership = "system"
			}
			columns, values := "", ""
			switch kind {
			case "rules":
				columns, values = ",content", ",'rule content'"
			case "skills":
				columns, values = ",package_file_name,package_s3_key,package_size_bytes,package_sha256", ",'skill.zip','skill.zip',1,'sha256'"
			case "experts":
				columns, values = ",prompt,created_by_user_id", ",'prompt',$2"
			case "connectors":
				columns, values = ",url,authorization_mode", ",'https://example.com/mcp','none'"
			}
			catalogExec(t, r, "INSERT INTO "+kind+"(id,owner_user_id,ownership_type,name,description,name_i18n,description_i18n,admin_overrides"+columns+") VALUES($1,$2,$3,$4,'description','{\"zh\":\"翻译名称\",\"invalid\":7}','{\"zh\":\"翻译描述\"}',jsonb_build_object('unused',repeat('x',8192))"+values+")", id, owner, ownership, fmt.Sprintf("name_%d%%", i))
			if i == 2 || i == 4 || i == 6 {
				catalogExec(t, r, "INSERT INTO resource_access_grants(resource_type,resource_id,user_id,access_level,granted_by_user_id) VALUES($1,$2,$3,'read_only',$3)", strings.TrimSuffix(kind, "s"), id, user)
			}
			if i == 3 {
				catalogExec(t, r, "INSERT INTO resource_access_grants(resource_type,resource_id,group_id,access_level,granted_by_user_id) VALUES($1,$2,$3,'read_only',$4)", strings.TrimSuffix(kind, "s"), id, parent, user)
			}
			if i == 7 {
				catalogExec(t, r, "UPDATE "+kind+" SET enabled=false WHERE id=$1", id)
			}
			if i == 8 {
				catalogExec(t, r, "UPDATE "+kind+" SET deleted_at=now() WHERE id=$1", id)
			}
		}
	}
	for i := range 2 {
		tag := fmt.Sprintf("20000000-0000-0000-0000-%012d", i+1)
		catalogExec(t, r, "INSERT INTO tags(id,name,created_by_user_id) VALUES($1,$2,$3)", tag, fmt.Sprintf("tag%d", i), user)
		for _, kind := range []string{"skill", "expert", "connector"} {
			for _, n := range []int{1, 2 + i} {
				id := fmt.Sprintf("10000000-0000-0000-0000-%012d", n)
				catalogExec(t, r, "INSERT INTO resource_tags(resource_type,resource_id,tag_id,assigned_by_user_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", kind, id, tag, user)
			}
		}
	}
}

func TestCatalogPageMatchesVisibleList(t *testing.T) {
	r, user, other := catalogDatabase(t)
	seedCatalog(t, r, user, other)
	ctx := context.Background()
	for _, remote := range []bool{false, true} {
		if remote {
			catalogExec(t, r, "INSERT INTO settings(key,value,updated_by_user_id) VALUES('billing','{\"charging_mode\":\"remote\"}',$1)", user)
		}
		for _, kind := range []string{"rules", "skills", "experts", "connectors"} {
			for _, owner := range []string{"all", "team", "mine", "shared"} {
				for _, search := range []string{"", "翻译名称", "翻译描述", "%", "_", "not found"} {
					filter := resource.CatalogFilter{Owner: owner, Query: search}
					for _, tags := range [][]string{nil, {"20000000-0000-0000-0000-000000000001", "20000000-0000-0000-0000-000000000002"}, {"invalid"}} {
						want, err := r.list(ctx, r.store.Pool, user, kind, filter, nil)
						if err != nil {
							t.Fatal(err)
						}
						want = resource.FilterTags(want, tags)
						for _, page := range []int{1, 2, 10} {
							selected, err := r.page(ctx, r.store.Pool, user, kind, filter, tags, page, 2)
							if err != nil {
								t.Fatal(err)
							}
							if selected.TotalCount != int64(len(want)) {
								t.Fatalf("%s remote=%v owner=%s q=%q tags=%v: total=%d want=%d", kind, remote, owner, search, tags, selected.TotalCount, len(want))
							}
							ids := []string{}
							for _, item := range resource.PageSlice(want, page, 2) {
								ids = append(ids, item.String("id"))
							}
							if !slices.Equal(selected.ResourceIds, ids) {
								t.Fatalf("%s page=%d: ids=%v want=%v", kind, page, selected.ResourceIds, ids)
							}
							got, err := r.list(ctx, r.store.Pool, user, kind, filter, selected.ResourceIds)
							if err != nil {
								t.Fatal(err)
							}
							gotJSON, _ := json.Marshal(got)
							wantJSON, _ := json.Marshal(resource.PageSlice(want, page, 2))
							if string(gotJSON) != string(wantJSON) {
								t.Fatalf("%s page=%d: got=%s want=%s", kind, page, gotJSON, wantJSON)
							}
						}
					}
				}
			}
		}
	}
}

func TestKnowledgeBaseConnectorPagination(t *testing.T) {
	r, user, other := catalogDatabase(t)
	seedCatalog(t, r, user, other)
	for _, tc := range []struct {
		owner, query string
		tags         []string
		want         int64
	}{
		{owner: "all", query: "knowledge base", want: 1},
		{owner: "mine", query: "知识库", want: 1},
		{owner: "team", query: "知识库"},
		{owner: "shared", query: "知识库"},
		{owner: "all", query: "知识库", tags: []string{"20000000-0000-0000-0000-000000000001"}},
	} {
		filter := resource.CatalogFilter{Owner: tc.owner, Query: tc.query}
		for page := 1; page <= 2; page++ {
			selected, err := r.page(t.Context(), r.store.Pool, user, "connectors", filter, tc.tags, page, 1)
			if err != nil {
				t.Fatal(err)
			}
			if selected.TotalCount != tc.want {
				t.Fatalf("filter=%+v tags=%v: total=%d want=%d", filter, tc.tags, selected.TotalCount, tc.want)
			}
			items, err := r.list(t.Context(), r.store.Pool, user, "connectors", filter, selected.ResourceIds)
			if err != nil {
				t.Fatal(err)
			}
			want := 0
			if page == 1 {
				want = int(tc.want)
			}
			if len(items) != want || want == 1 && items[0].String("id") != knowledgeBaseConnectorID {
				t.Fatalf("filter=%+v page=%d: items=%v", filter, page, items)
			}
		}
	}
}

func TestSelectedCatalogLoadsExpertDependencies(t *testing.T) {
	r, user, other := catalogDatabase(t)
	seedCatalog(t, r, user, other)
	ctx := context.Background()
	expert := "10000000-0000-0000-0000-000000000001"
	linked := "10000000-0000-0000-0000-000000000002"
	catalogExec(t, r, "INSERT INTO expert_rules(expert_id,rule_id) VALUES($1,$2)", expert, linked)
	catalogExec(t, r, "INSERT INTO expert_skills(expert_id,skill_id) VALUES($1,$2)", expert, linked)
	catalogExec(t, r, "INSERT INTO expert_connectors(expert_id,connector_id) VALUES($1,$2)", expert, linked)
	full, err := r.load(ctx, r.store.Pool, user, "experts")
	if err != nil {
		t.Fatal(err)
	}
	selected, err := r.loadSelected(ctx, r.store.Pool, user, "experts", []string{expert})
	if err != nil {
		t.Fatal(err)
	}
	if len(selected.experts) != 1 || len(selected.rules) != 1 || len(selected.skills) != 1 || len(selected.connectors) != 1 {
		t.Fatalf("加载了本页依赖之外的资源: %+v", selected)
	}
	want, err := r.manifest(ctx, r.store.Pool, full, expert, user)
	if err != nil {
		t.Fatal(err)
	}
	got, err := r.manifest(ctx, r.store.Pool, selected, expert, user)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("分页改变了 manifest: got=%v want=%v", got, want)
	}
}

func TestCatalogDependencyFailureIsolation(t *testing.T) {
	r, user, _ := catalogDatabase(t)
	catalogExec(t, r, "ALTER TABLE connectors RENAME TO unavailable_connectors")
	catalogExec(t, r, "ALTER TABLE expert_skills RENAME TO unavailable_expert_skills")
	ctx := context.Background()
	for _, kind := range []string{"rules", "skills"} {
		if _, err := r.page(ctx, r.store.Pool, user, kind, resource.CatalogFilter{}, nil, 1, 20); err != nil {
			t.Fatalf("%s 依赖了无关目录: %v", kind, err)
		}
		if _, err := r.list(ctx, r.store.Pool, user, kind, resource.CatalogFilter{}, []string{}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := r.list(ctx, r.store.Pool, user, "experts", resource.CatalogFilter{}, []string{}); err == nil {
		t.Fatal("专家关联目录失败时不应返回伪造的空列表")
	}
}
