package model

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

func TestModelSearchAndPagination(t *testing.T) {
	dsn := os.Getenv("MONKEYAI_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("设置 MONKEYAI_TEST_DATABASE_URL 运行模型搜索集成测试")
	}
	ctx := t.Context()
	root, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(root.Close)
	schema := "test_model_pages_" + strings.ReplaceAll(resource.ID(), "-", "")
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
	exec(`INSERT INTO users(id,name,email,role) VALUES($1,'模型管理员','model-pages@example.com','admin')`, owner)
	id := func(n int) string { return fmt.Sprintf("00000000-0000-4000-8000-%012d", n) }
	insert := func(n int, ownership, name, content string) {
		t.Helper()
		exec(`INSERT INTO models(id,owner_user_id,ownership_type,display_name,base_url,model_id,protocol,api_key,advanced_config) VALUES($1,$2,$3,$4,$5,'model-'||($1::uuid)::text,'openai_responses','test-secret','{}')`, id(n), owner, ownership, fmt.Sprintf("%s %d", name, n), "https://example.com/"+strings.ReplaceAll(content, "\n", "/"))
	}
	var systemIDs, userIDs, allSystemIDs []string
	for i := 1; i <= 100; i++ {
		name, content := "其他模型", "普通正文"
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
		insert(i, "user", "个人模型", "needlealpha 描述")
		userIDs = append(userIDs, id(i))
	}
	insert(300, "system", "needlealpha 已删除", "needlealpha")
	exec(`UPDATE models SET deleted_at=now() WHERE id=$1`, id(300))
	insert(400, "system", "literal%name", `underscore_value and path\file`)
	insert(401, "system", "literalXname", "underscoreXvalue and path/file")
	insert(402, "system", "部署规范", "第一行\n第二行\n隐藏内容中的权限校验")
	insert(403, "system", "名称和描述重复命中", "名称和描述重复命中")
	allSystemIDs = append(allSystemIDs, id(400), id(401), id(402), id(403))

	router := chi.NewRouter()
	NewService(NewPostgres(pool)).RegisterAdmin(router)
	type page struct {
		Items      []resource.Object `json:"models"`
		NextCursor string            `json:"next_cursor"`
	}
	get := func(t *testing.T, query url.Values) page {
		t.Helper()
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest("GET", "/models?"+query.Encode(), nil))
		if response.Code != 200 {
			t.Fatalf("模型列表 %s: %d %s", query.Encode(), response.Code, response.Body.String())
		}
		if strings.Contains(response.Body.String(), "test-secret") {
			t.Fatal("列表泄露模型密钥")
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
		{"用户模型", "user", "needlealpha", userIDs},
		{"省略类型", "", "needlealpha", append(slices.Clone(systemIDs), userIDs...)},
		{"空搜索", "system", "", allSystemIDs},
		{"中文名称", "system", "部署", []string{id(402)}},
		{"中文描述", "system", "权限校验", []string{id(402)}},
		{"百分号按字面匹配", "system", "literal%name", []string{id(400)}},
		{"下划线按字面匹配", "system", "underscore_value", []string{id(400)}},
		{"反斜杠按字面匹配", "system", `path\file`, []string{id(400)}},
		{"名称和内容重复命中不重复返回", "system", "重复命中", []string{id(403)}},
		{"无匹配", "user", "不存在的模型", nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			query := url.Values{"ownership_type": {tc.ownership}, "q": {tc.search}, "limit": {"48"}}
			var got []string
			seen := map[string]bool{}
			for count := 0; ; count++ {
				if count >= 5 {
					t.Fatal("模型分页未终止")
				}
				out := get(t, query)
				remaining := len(tc.want) - len(got)
				if len(out.Items) != min(48, remaining) {
					t.Fatalf("应先筛选后分页: 当前页 %d 条，剩余预期 %d 条", len(out.Items), remaining)
				}
				for _, item := range out.Items {
					key := item.String("id")
					if seen[key] {
						t.Fatalf("分页重复模型: %s", key)
					}
					seen[key] = true
					got = append(got, key)
					if tc.ownership != "" && item.String("ownership_type") != tc.ownership {
						t.Fatalf("混入其他类型模型: %v", item)
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
				t.Fatalf("模型搜索结果错误: got %v, want %v", got, tc.want)
			}
		})
	}
	unpaged := get(t, url.Values{"ownership_type": {"system"}})
	if len(unpaged.Items) != len(allSystemIDs) || unpaged.NextCursor != "" {
		t.Fatalf("未分页调用应保留完整列表: %+v", unpaged)
	}
	for _, query := range []string{"limit=0", "limit=501", "limit=bad", "ownership_type=invalid&limit=48"} {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest("GET", "/models?"+query, nil))
		if response.Code != 400 {
			t.Fatalf("无效分页条件 %s: %d", query, response.Code)
		}
	}
	insert(405, "system", "普通显示名", "ordinary")
	exec(`UPDATE models SET model_id='unique-upstream-identifier' WHERE id=$1`, id(405))
	out := get(t, url.Values{"ownership_type": {"system"}, "q": {"UPSTREAM-IDENTIFIER"}, "limit": {"48"}})
	if len(out.Items) != 1 || out.Items[0].String("id") != id(405) {
		t.Fatalf("应按模型 ID 搜索: %+v", out)
	}
	for i := 5001; i <= 5505; i++ {
		insert(i, "system", "large-page-only", "分页测试")
	}
	for _, limit := range []int{200, 500} {
		query := url.Values{"ownership_type": {"system"}, "q": {"large-page-only"}, "limit": {fmt.Sprint(limit)}}
		for offset := 0; offset < 505; offset += limit {
			out := get(t, query)
			if len(out.Items) != min(limit, 505-offset) {
				t.Fatalf("limit=%d offset=%d: 返回 %d 条", limit, offset, len(out.Items))
			}
			for index, item := range out.Items {
				if item.String("id") != id(5001+offset+index) {
					t.Fatalf("模型分页顺序或记录错误: %v", item)
				}
			}
			if (out.NextCursor != "") != (offset+limit < 505) {
				t.Fatalf("模型分页游标错误: %q", out.NextCursor)
			}
			query.Set("cursor", out.NextCursor)
		}
	}
}
