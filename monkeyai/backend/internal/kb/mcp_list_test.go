package kb

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"

	"github.com/go-chi/chi/v5"
)

func TestMCPKBListInput(t *testing.T) {
	defaultFilter, page, size, tags, err := mcpKBListInput(map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if defaultFilter.Owner != "all" || defaultFilter.Query != "" || page != 1 || size != documentDefaultPageSize || len(tags) != 0 {
		t.Fatalf("默认参数不正确: filter=%+v page=%d size=%d tags=%v", defaultFilter, page, size, tags)
	}

	filter, page, size, tags, err := mcpKBListInput(map[string]any{
		"q":         " Team ",
		"owner":     "team",
		"tag_id":    "tag-a, tag-b",
		"tag_ids":   []any{"tag-b", "tag-c"},
		"page":      json.Number("2"),
		"page_size": json.Number("10"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if filter.Owner != "team" || filter.Query != "team" || page != 2 || size != 10 {
		t.Fatalf("列表参数不正确: filter=%+v page=%d size=%d", filter, page, size)
	}
	if strings.Join(tags, ",") != "tag-a,tag-b,tag-c" {
		t.Fatalf("标签解析不正确: %v", tags)
	}

	for _, arguments := range []map[string]any{
		{"owner": "unknown"},
		{"page": json.Number("0")},
		{"page_size": json.Number("101")},
		{"tag_ids": "tag-a"},
	} {
		if _, _, _, _, err := mcpKBListInput(arguments); err == nil {
			t.Fatalf("应拒绝参数: %#v", arguments)
		}
	}
}

func TestMCPKBListToolSchema(t *testing.T) {
	for _, tool := range MCPTools() {
		if tool.String("name") != "kb_list" {
			continue
		}
		properties := tool["inputSchema"].(resource.Object)["properties"].(resource.Object)
		for _, key := range []string{"q", "owner", "tag_id", "tag_ids", "page", "page_size"} {
			if _, ok := properties[key]; !ok {
				t.Fatalf("kb_list 缺少参数 %s", key)
			}
		}
		return
	}
	t.Fatal("缺少 kb_list 工具")
}

func TestMCPKBListResponseMatchesREST(t *testing.T) {
	pool, _ := kbTestPool(t)
	ctx := t.Context()
	service := NewService(resource.NewStore(pool), nil)

	userA, userB := resource.ID(), resource.ID()
	for _, user := range []struct {
		id    string
		email string
	}{
		{id: userA, email: "kb-mcp-list-a@example.com"},
		{id: userB, email: "kb-mcp-list-b@example.com"},
	} {
		if _, err := pool.Exec(ctx, `INSERT INTO users(id,name,email,role) VALUES($1,'知识库列表用户',$2,'user')`, user.id, user.email); err != nil {
			t.Fatal(err)
		}
	}

	zulu, alpha, shared := resource.ID(), resource.ID(), resource.ID()
	for _, item := range []struct {
		id, name, owner string
	}{
		{zulu, "Zulu", userA},
		{alpha, "Alpha", userA},
		{shared, "Shared", userB},
	} {
		if _, err := pool.Exec(ctx, `INSERT INTO knowledge_bases(id,name,owner_user_id,created_by_user_id,ownership_type) VALUES($1,$2,$3,$3,'user')`, item.id, item.name, item.owner); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := pool.Exec(ctx, `INSERT INTO resource_access_grants(resource_type,resource_id,user_id,access_level,granted_by_user_id) VALUES('kb',$1,$2,'read_only',$3)`, shared, userA, userB); err != nil {
		t.Fatal(err)
	}

	call := func(arguments string) resource.Object {
		t.Helper()
		result, err := service.callMCPTool(ctx, userA, json.RawMessage(`{"name":"kb_list","arguments":`+arguments+`}`))
		if err != nil {
			t.Fatal(err)
		}
		return result["structuredContent"].(resource.Object)
	}

	first := call(`{"owner":"mine","page":1,"page_size":1}`)
	if _, ok := first["items"]; ok {
		t.Fatal("kb_list 不应再返回 items")
	}
	if first["total_count"] != 2 || first["page"] != 1 || first["page_size"] != 1 {
		t.Fatalf("分页字段不正确: %v", first)
	}
	if version, _ := first["version"].(string); !strings.HasPrefix(version, "sha256:") {
		t.Fatalf("version 不正确: %v", first["version"])
	}
	items := first["knowledge_bases"].([]resource.Object)
	if len(items) != 1 || items[0].String("name") != "Alpha" {
		t.Fatalf("第一页应按名称排序: %v", items)
	}
	if owner, ok := items[0]["user"].(resource.User); !ok || owner.ID != userA {
		t.Fatalf("列表项缺少所有者: %v", items[0]["user"])
	}

	second := call(`{"owner":"mine","page":2,"page_size":1}`)
	items = second["knowledge_bases"].([]resource.Object)
	if len(items) != 1 || items[0].String("name") != "Zulu" {
		t.Fatalf("第二页应按名称排序: %v", items)
	}

	sharedPage := call(`{"owner":"shared"}`)
	items = sharedPage["knowledge_bases"].([]resource.Object)
	if len(items) != 1 || items[0].String("name") != "Shared" {
		t.Fatalf("共享知识库列表不正确: %v", items)
	}
	if owner, ok := items[0]["user"].(resource.User); !ok || owner.ID != userB {
		t.Fatalf("共享知识库应返回所有者: %v", items[0]["user"])
	}

	router := chi.NewRouter()
	router.Use(identity.NewService(pool, nil, "http://localhost").RequireBrowser)
	service.RegisterAgent(router)
	session := "kb-mcp-list-session"
	digest := sha256.Sum256([]byte(session))
	if _, err := pool.Exec(ctx, `INSERT INTO browser_sessions(token_hash,user_id,authentication_method,expires_at) VALUES($1,$2,'password',now()+interval '1 hour')`, hex.EncodeToString(digest[:]), userA); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, "/kb?owner=mine&page=1&page_size=1", nil)
	request.AddCookie(&http.Cookie{Name: "monkeyai_session", Value: session})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("REST 知识库列表状态码 = %d, body=%s", response.Code, response.Body.String())
	}
	var rest map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &rest); err != nil {
		t.Fatal(err)
	}
	mcpJSON, err := json.Marshal(first)
	if err != nil {
		t.Fatal(err)
	}
	var mcp map[string]any
	if err := json.Unmarshal(mcpJSON, &mcp); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(rest, mcp) {
		t.Fatalf("MCP kb_list 与 REST 响应不一致\nrest=%v\nmcp=%v", rest, mcp)
	}
}
