package kb

import (
	"errors"
	"net/http"
	"strconv"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

func TestAgentKBRoutes(t *testing.T) {
	router := chi.NewRouter()
	NewService(resource.NewStore(nil), nil).RegisterAgent(router)

	routes := map[string]bool{}
	if err := chi.Walk(router, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		routes[method+" "+route] = true
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	for _, route := range []string{
		"GET /kb",
		"GET /kb/tags",
		"POST /kb",
		"POST /kb/search",
		"GET /kb/{id}",
		"PUT /kb/{id}",
		"DELETE /kb/{id}",
		"GET /kb/{id}/documents",
		"POST /kb/{id}/documents",
		"GET /kb/{id}/documents/{documentId}",
		"PUT /kb/{id}/documents/{documentId}",
		"DELETE /kb/{id}/documents/{documentId}",
	} {
		if !routes[route] {
			t.Fatalf("缺少路由 %s", route)
		}
	}
}

func TestListAccessibleCatalogFilters(t *testing.T) {
	pool, admin := kbTestPool(t)
	ctx := t.Context()
	service := NewService(resource.NewStore(pool), nil)

	userA, userB := resource.ID(), resource.ID()
	for _, user := range []struct {
		id    string
		email string
	}{
		{id: userA, email: "kb-catalog-a@example.com"},
		{id: userB, email: "kb-catalog-b@example.com"},
	} {
		if _, err := pool.Exec(ctx, `INSERT INTO users(id,name,email,role) VALUES($1,'知识库目录用户',$2,'user')`, user.id, user.email); err != nil {
			t.Fatal(err)
		}
	}

	systemKB, mineKB, sharedKB, privateKB := resource.ID(), resource.ID(), resource.ID(), resource.ID()
	for _, kb := range []struct {
		id, name, owner, ownership string
	}{
		{systemKB, "团队知识库", admin, "system"},
		{mineKB, "我创建的知识库", userA, "user"},
		{sharedKB, "他人分享的知识库", userB, "user"},
		{privateKB, "未分享的知识库", userB, "user"},
	} {
		if _, err := pool.Exec(ctx, `INSERT INTO knowledge_bases(id,name,owner_user_id,created_by_user_id,ownership_type) VALUES($1,$2,$3,$3,$4)`, kb.id, kb.name, kb.owner, kb.ownership); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := pool.Exec(ctx, `INSERT INTO resource_access_grants(resource_type,resource_id,user_id,access_level,granted_by_user_id) VALUES('kb',$1,$2,'read_only',$3)`, systemKB, userA, admin); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO resource_access_grants(resource_type,resource_id,user_id,access_level,granted_by_user_id) VALUES('kb',$1,$2,'read_only',$3)`, sharedKB, userA, userB); err != nil {
		t.Fatal(err)
	}

	for _, tc := range []struct {
		name   string
		filter resource.CatalogFilter
		want   []string
	}{
		{name: "all", filter: resource.CatalogFilter{Owner: "all"}, want: []string{systemKB, mineKB, sharedKB}},
		{name: "team", filter: resource.CatalogFilter{Owner: "team"}, want: []string{systemKB}},
		{name: "mine", filter: resource.CatalogFilter{Owner: "mine"}, want: []string{mineKB}},
		{name: "shared", filter: resource.CatalogFilter{Owner: "shared"}, want: []string{sharedKB}},
		{name: "query", filter: resource.CatalogFilter{Owner: "all", Query: "分享"}, want: []string{sharedKB}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			items, err := service.listAccessible(ctx, userA, tc.filter)
			if err != nil {
				t.Fatal(err)
			}
			got := make([]string, 0, len(items))
			for _, item := range items {
				got = append(got, item.String("id"))
			}
			if len(got) != len(tc.want) {
				t.Fatalf("得到 %v，期望 %v", got, tc.want)
			}
			want := map[string]bool{}
			for _, id := range tc.want {
				want[id] = true
			}
			for _, id := range got {
				if !want[id] {
					t.Fatalf("得到 %v，期望 %v", got, tc.want)
				}
			}
		})
	}
}

func TestUserKBRESTOperations(t *testing.T) {
	pool, admin := kbTestPool(t)
	ctx := t.Context()
	service := NewService(resource.NewStore(pool), nil)

	userA, userB := resource.ID(), resource.ID()
	for _, user := range []struct {
		id    string
		email string
	}{
		{id: userA, email: "kb-agent-a@example.com"},
		{id: userB, email: "kb-agent-b@example.com"},
	} {
		if _, err := pool.Exec(ctx, `INSERT INTO users(id,name,email,role) VALUES($1,'知识库用户',$2,'user')`, user.id, user.email); err != nil {
			t.Fatal(err)
		}
	}

	created, err := service.CreateUserKB(ctx, userA, resource.Object{"name": "个人知识库", "description": "初始描述"})
	if err != nil {
		t.Fatalf("创建个人知识库失败: %v", err)
	}
	kbID := created.String("id")
	if kbID == "" || created.String("ownership_type") != "user" || !created.Bool("enabled") {
		t.Fatalf("创建结果不正确: %v", created)
	}
	revision := strconv.FormatInt(objectInt64(created["revision"]), 10)

	if _, err := service.UpdateUserKB(ctx, userB, kbID, `"`+revision+`"`, resource.Object{"name": "越权更新"}); !errors.Is(err, resource.NotFound) {
		t.Fatalf("非所有者更新知识库应返回 NotFound，实际: %v", err)
	}
	_, err = service.UpdateUserKB(ctx, userA, kbID, "", resource.Object{"name": "缺少版本"})
	var failure *resource.Error
	if !errors.As(err, &failure) || failure.Status != 428 {
		t.Fatalf("缺少 If-Match 应返回 428，实际: %v", err)
	}
	if _, err := service.UpdateUserKB(ctx, userA, kbID, `"999"`, resource.Object{"name": "版本冲突"}); !errors.Is(err, resource.Conflict) {
		t.Fatalf("错误版本应返回 RevisionConflict，实际: %v", err)
	}
	updated, err := service.UpdateUserKB(ctx, userA, kbID, `"`+revision+`"`, resource.Object{"name": "更新后的知识库", "description": "更新描述"})
	if err != nil {
		t.Fatalf("所有者更新知识库失败: %v", err)
	}
	if updated.String("name") != "更新后的知识库" || objectInt64(updated["revision"]) != objectInt64(created["revision"])+1 {
		t.Fatalf("更新结果不正确: %v", updated)
	}
	revision = strconv.FormatInt(objectInt64(updated["revision"]), 10)

	systemKB := resource.ID()
	if _, err := pool.Exec(ctx, `INSERT INTO knowledge_bases(id,name,owner_user_id,created_by_user_id,ownership_type) VALUES($1,'系统知识库',$2,$2,'system')`, systemKB, admin); err != nil {
		t.Fatal(err)
	}
	if _, err := service.UpdateUserKB(ctx, userA, systemKB, `"1"`, resource.Object{"name": "越权系统知识库"}); !errors.Is(err, resource.NotFound) {
		t.Fatalf("Agent 不允许更新系统知识库，实际: %v", err)
	}
	if err := service.DeleteUserKB(ctx, userA, systemKB, `"1"`); !errors.Is(err, resource.NotFound) {
		t.Fatalf("Agent 不允许删除系统知识库，实际: %v", err)
	}

	document, err := service.CreateUserDocument(ctx, userA, DocumentInput{KbID: kbID, Title: "文档", Content: "正文"})
	if err != nil {
		t.Fatalf("创建文档失败: %v", err)
	}
	documentID := document.String("id")
	if _, err := service.GetAccessibleDocumentInKB(ctx, userA, resource.ID(), documentID); !errors.Is(err, resource.NotFound) {
		t.Fatalf("文档路径与所属知识库不一致时应返回 NotFound，实际: %v", err)
	}
	if _, err := service.GetAccessibleDocumentInKB(ctx, userA, kbID, documentID); err != nil {
		t.Fatalf("所有者读取文档失败: %v", err)
	}
	if _, err := service.UpdateUserDocument(ctx, userB, documentID, DocumentInput{Title: "越权"}); !errors.Is(err, resource.NotFound) {
		t.Fatalf("非所有者更新文档应返回 NotFound，实际: %v", err)
	}

	if _, err := pool.Exec(ctx, `INSERT INTO resource_access_grants(resource_type,resource_id,user_id,access_level,granted_by_user_id) VALUES('kb',$1,$2,'read_only',$3)`, kbID, userB, userA); err != nil {
		t.Fatal(err)
	}
	if _, err := service.GetAccessibleDocumentInKB(ctx, userB, kbID, documentID); err != nil {
		t.Fatalf("只读分享用户读取文档失败: %v", err)
	}
	if _, err := service.UpdateUserDocument(ctx, userB, documentID, DocumentInput{Title: "只读越权"}); resource.AsError(err).Status != http.StatusForbidden {
		t.Fatalf("只读分享用户更新文档应返回 Forbidden，实际: %v", err)
	}
	if err := service.DeleteUserDocument(ctx, userB, documentID); resource.AsError(err).Status != http.StatusForbidden {
		t.Fatalf("只读分享用户删除文档应返回 Forbidden，实际: %v", err)
	}

	tagID := resource.ID()
	if _, err := pool.Exec(ctx, `INSERT INTO tags(id,name,created_by_user_id) VALUES($1,'知识库标签',$2)`, tagID, userA); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO resource_tags(resource_type,resource_id,tag_id,assigned_by_user_id) VALUES('kb',$1,$2,$3)`, kbID, tagID, userA); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO knowledge_base_chunks(kb_id,document_id,chunk_index,content) VALUES($1,$2,0,'分片')`, kbID, documentID); err != nil {
		t.Fatal(err)
	}

	if err := service.DeleteUserKB(ctx, userA, kbID, ""); err == nil {
		t.Fatal("删除知识库缺少 If-Match 应失败")
	}
	if err := service.DeleteUserKB(ctx, userA, kbID, `"999"`); !errors.Is(err, resource.Conflict) {
		t.Fatalf("错误版本删除应返回 RevisionConflict，实际: %v", err)
	}
	if err := service.DeleteUserKB(ctx, userA, kbID, `"`+revision+`"`); err != nil {
		t.Fatalf("所有者删除知识库失败: %v", err)
	}

	for name, query := range map[string]string{
		"kb":                           `SELECT count(*) FROM knowledge_bases WHERE id=$1`,
		"knowledge_base_documents":     `SELECT count(*) FROM knowledge_base_documents WHERE kb_id=$1`,
		"knowledge_base_chunks":        `SELECT count(*) FROM knowledge_base_chunks WHERE kb_id=$1`,
		"knowledge_base_learning_jobs": `SELECT count(*) FROM knowledge_base_learning_jobs WHERE kb_id=$1`,
		"resource_access_grants":       `SELECT count(*) FROM resource_access_grants WHERE resource_type='kb' AND resource_id=$1`,
		"resource_tags":                `SELECT count(*) FROM resource_tags WHERE resource_type='kb' AND resource_id=$1`,
	} {
		var count int
		if err := pool.QueryRow(ctx, query, kbID).Scan(&count); err != nil {
			t.Fatalf("统计 %s: %v", name, err)
		}
		if count != 0 {
			t.Fatalf("删除后 %s 仍有 %d 条记录", name, count)
		}
	}
}
