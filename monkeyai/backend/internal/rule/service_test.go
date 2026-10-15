package rule

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestRuleSearchAndPagination(t *testing.T) {
	dsn := os.Getenv("MONKEYAI_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("设置 MONKEYAI_TEST_DATABASE_URL 运行规则搜索集成测试")
	}
	ctx := t.Context()
	root, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(root.Close)
	schema := "test_rules_" + strings.ReplaceAll(resource.ID(), "-", "")
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
	owner := resource.ID()
	exec(`INSERT INTO users(id,name,email,role) VALUES($1,'规则管理员','rules@example.com','admin')`, owner)
	id := func(n int) string { return fmt.Sprintf("00000000-0000-4000-8000-%012d", n) }
	insert := func(n int, ownership, name, content string) {
		t.Helper()
		exec(`INSERT INTO rules(id,owner_user_id,ownership_type,name,content) VALUES($1,$2,$3,$4,$5)`, id(n), owner, ownership, fmt.Sprintf("%s %d", name, n), content)
	}
	var systemIDs, userIDs, allSystemIDs []string
	for i := 1; i <= 100; i++ {
		name, content := "其他规则", "普通正文"
		if i%2 == 0 {
			systemIDs = append(systemIDs, id(i))
			if i%4 == 0 {
				content = "第一行\n第二行\n隐藏的 NeedLeAlpha 描述"
			} else {
				name = "NeedleAlpha 名称"
			}
		}
		insert(i, "system", name, content)
		allSystemIDs = append(allSystemIDs, id(i))
	}
	for i := 201; i <= 203; i++ {
		insert(i, "user", "个人规则", "needlealpha 描述")
		userIDs = append(userIDs, id(i))
	}
	insert(300, "system", "needlealpha 已删除", "needlealpha")
	exec(`UPDATE rules SET deleted_at=now() WHERE id=$1`, id(300))
	insert(400, "system", "literal%name", `underscore_value and path\file`)
	insert(401, "system", "literalXname", "underscoreXvalue and path/file")
	insert(402, "system", "部署规范", "第一行\n第二行\n隐藏内容中的权限校验")
	insert(403, "system", "名称和描述重复命中", "名称和描述重复命中")
	allSystemIDs = append(allSystemIDs, id(400), id(401), id(402), id(403))

	router := chi.NewRouter()
	NewService(resource.NewStore(pool)).Register(router)
	type page struct {
		Items      []resource.Object `json:"items"`
		NextCursor string            `json:"next_cursor"`
	}
	get := func(t *testing.T, query url.Values) page {
		t.Helper()
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest("GET", "/rules?"+query.Encode(), nil))
		if response.Code != 200 {
			t.Fatalf("规则列表 %s: %d %s", query.Encode(), response.Code, response.Body.String())
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
		{"系统名称和完整描述", "system", "needlealpha", systemIDs},
		{"忽略大小写", "system", "NEEDLEALPHA", systemIDs},
		{"用户规则", "user", "needlealpha", userIDs},
		{"省略类型", "", "needlealpha", append(slices.Clone(systemIDs), userIDs...)},
		{"空搜索", "system", "", allSystemIDs},
		{"中文名称", "system", "部署", []string{id(402)}},
		{"中文描述", "system", "权限校验", []string{id(402)}},
		{"百分号按字面匹配", "system", "literal%name", []string{id(400)}},
		{"下划线按字面匹配", "system", "underscore_value", []string{id(400)}},
		{"反斜杠按字面匹配", "system", `path\file`, []string{id(400)}},
		{"名称和内容重复命中不重复返回", "system", "重复命中", []string{id(403)}},
		{"无匹配", "user", "不存在的规则", nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			query := url.Values{"ownership_type": {tc.ownership}, "q": {tc.search}, "limit": {"48"}}
			var got []string
			seen := map[string]bool{}
			for count := 0; ; count++ {
				if count >= 5 {
					t.Fatal("规则分页未终止")
				}
				out := get(t, query)
				remaining := len(tc.want) - len(got)
				if len(out.Items) != min(48, remaining) {
					t.Fatalf("应先筛选后分页: 当前页 %d 条，剩余预期 %d 条", len(out.Items), remaining)
				}
				for _, item := range out.Items {
					key := item.String("id")
					if seen[key] {
						t.Fatalf("分页重复规则: %s", key)
					}
					seen[key] = true
					got = append(got, key)
					if tc.ownership != "" && item.String("ownership_type") != tc.ownership {
						t.Fatalf("混入其他类型规则: %v", item)
					}
				}
				if out.NextCursor == "" {
					break
				}
				if len(out.Items) != 48 || out.NextCursor != got[len(got)-1] {
					t.Fatalf("分页边界错误: %+v", out)
				}
				query.Set("cursor", out.NextCursor)
			}
			if !slices.Equal(got, tc.want) {
				t.Fatalf("规则搜索结果错误: got %v, want %v", got, tc.want)
			}
		})
	}
}
