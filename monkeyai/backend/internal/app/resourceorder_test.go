package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/expert"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/mcp"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/rule"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/skill"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestResourceOriginPagination(t *testing.T) {
	dsn := os.Getenv("MONKEYAI_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("设置 MONKEYAI_TEST_DATABASE_URL 运行资源来源排序集成测试")
	}
	ctx := t.Context()
	root, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(root.Close)
	schema := "test_resource_order_" + strings.ReplaceAll(resource.ID(), "-", "")
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
	exec := func(t *testing.T, query string, args ...any) {
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
		exec(t, string(data))
	}
	owner, importID := resource.ID(), resource.ID()
	exec(t, `INSERT INTO users(id,name,email,role) VALUES($1,'排序测试管理员','resource-order@example.com','admin')`, owner)
	digest := "sha256:" + strings.Repeat("0", 64)
	exec(t, `INSERT INTO resource_imports(id,publisher,release_id,version,manifest_sha256,actor_user_id,status) VALUES($1,'order-test',$2,1,$3,$4,'succeeded')`, importID, resource.ID(), digest, owner)
	id := func(n int) string { return fmt.Sprintf("00000000-0000-4000-8000-%012d", n) }
	ids := func(numbers ...int) []string {
		out := make([]string, len(numbers))
		for i, n := range numbers {
			out[i] = id(n)
		}
		return out
	}
	store := resource.NewStore(pool)
	for _, kind := range []string{"skill", "expert", "connector", "rule"} {
		t.Run(kind, func(t *testing.T) {
			router := chi.NewRouter()
			table := kind + "s"
			switch kind {
			case "skill":
				skill.NewService(store, nil).CRUD.Register(router)
			case "expert":
				expert.NewService(store).CRUD.Register(router)
			case "connector":
				mcp.NewService(store, "https://example.com").Connectors.Register(router)
			case "rule":
				rule.NewService(store).Register(router)
			}
			for _, n := range []int{10, 15, 20, 30, 40, 50, 60, 70, 80} {
				ownership, origin := "system", "local"
				if n == 20 || n == 50 {
					ownership = "user"
				}
				if n == 10 || n == 40 || n == 70 || n == 80 {
					origin = "package"
				}
				name, description := fmt.Sprintf("needle %s %d", kind, n), "needle description"
				if n == 15 {
					name, description = "其他资源", "普通说明"
				}
				var query string
				switch kind {
				case "skill":
					query = `INSERT INTO skills(id,owner_user_id,ownership_type,origin,name,description,package_file_name,package_s3_key,package_size_bytes,package_sha256) VALUES($1,$2,$3,$4,$5,$6,'test.zip','test',0,'test')`
				case "expert":
					query = `INSERT INTO experts(id,owner_user_id,ownership_type,origin,name,description,prompt,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$6,$2)`
				case "connector":
					query = `INSERT INTO connectors(id,owner_user_id,ownership_type,origin,name,description,url,authorization_mode) VALUES($1,$2,$3,$4,$5,$6,'https://example.com/mcp','none')`
				case "rule":
					query = `INSERT INTO rules(id,owner_user_id,ownership_type,origin,name,description,content) VALUES($1,$2,$3,$4,$5,$6,$6)`
				}
				exec(t, query, id(n), owner, ownership, origin, name, description)
				if origin == "package" {
					exec(t, `INSERT INTO resource_import_bindings(publisher,slug,resource_type,resource_id,source_sha256,applied_sha256,last_import_id) VALUES('order-test',$1,$2,$3,$4,$4,$5)`, fmt.Sprintf("%s-%d", kind, n), kind, id(n), digest, importID)
				}
				if n == 70 {
					exec(t, `UPDATE resource_import_bindings SET retired_at=now(),retired_import_id=$1 WHERE resource_type=$2 AND resource_id=$3`, importID, kind, id(n))
				}
			}
			exec(t, "UPDATE "+table+" SET deleted_at=now() WHERE id=$1", id(80))
			type page struct {
				Items      []resource.Object `json:"items"`
				NextCursor string            `json:"next_cursor"`
			}
			get := func(t *testing.T, query url.Values) page {
				t.Helper()
				response := httptest.NewRecorder()
				router.ServeHTTP(response, httptest.NewRequest("GET", "/"+table+"?"+query.Encode(), nil))
				if response.Code != 200 {
					t.Fatalf("%s: %d %s", query.Encode(), response.Code, response.Body.String())
				}
				var out page
				if err := json.Unmarshal(response.Body.Bytes(), &out); err != nil {
					t.Fatal(err)
				}
				return out
			}
			for _, tc := range []struct {
				name, ownership, search string
				want                    []string
			}{
				{"全部来源", "", "", ids(15, 20, 30, 50, 60, 10, 40, 70)},
				{"混合来源搜索", "", "needle", ids(20, 30, 50, 60, 10, 40, 70)},
				{"系统资源", "system", "needle", ids(30, 60, 10, 40, 70)},
				{"用户资源", "user", "needle", ids(20, 50)},
				{"无匹配", "", "不存在", nil},
			} {
				for _, limit := range []int{1, 2, 3} {
					t.Run(tc.name+"/limit="+strconv.Itoa(limit), func(t *testing.T) {
						query := url.Values{"ownership_type": {tc.ownership}, "q": {tc.search}, "limit": {strconv.Itoa(limit)}}
						var got []string
						for hops := 0; ; hops++ {
							if hops > len(tc.want) {
								t.Fatal("分页未终止")
							}
							out := get(t, query)
							remaining := len(tc.want) - len(got)
							if len(out.Items) != min(limit, remaining) {
								t.Fatalf("分页数量错误: got %d, remaining %d", len(out.Items), remaining)
							}
							for _, item := range out.Items {
								got = append(got, item.String("id"))
							}
							if out.NextCursor == "" {
								break
							}
							if len(out.Items) != limit || out.NextCursor != got[len(got)-1] {
								t.Fatalf("分页游标错误: %+v", out)
							}
							query.Set("cursor", out.NextCursor)
						}
						if !slices.Equal(got, tc.want) {
							t.Fatalf("来源分组和 ID 顺序错误: got %v, want %v", got, tc.want)
						}
					})
				}
			}
			t.Run("游标资源软删除后继续翻页", func(t *testing.T) {
				query := url.Values{"ownership_type": {"system"}, "q": {"needle"}, "limit": {"3"}}
				first := get(t, query)
				if first.NextCursor != id(10) {
					t.Fatalf("应以资源包项作为翻页边界: %+v", first)
				}
				exec(t, "UPDATE "+table+" SET deleted_at=now() WHERE id=$1", id(10))
				query.Set("cursor", first.NextCursor)
				last := get(t, query)
				var got []string
				for _, item := range last.Items {
					got = append(got, item.String("id"))
				}
				if !slices.Equal(got, ids(40, 70)) || last.NextCursor != "" {
					t.Fatalf("删除游标资源后分页错误: %+v", last)
				}
			})
		})
	}
}
