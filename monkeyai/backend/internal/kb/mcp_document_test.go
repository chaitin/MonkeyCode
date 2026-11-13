package kb

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestUserDocumentMCPAccess(t *testing.T) {
	pool, admin := kbTestPool(t)
	ctx := t.Context()
	service := NewService(resource.NewStore(pool), nil)

	userA, userB := resource.ID(), resource.ID()
	for _, user := range []struct {
		id    string
		email string
	}{
		{id: userA, email: "kb-doc-a@example.com"},
		{id: userB, email: "kb-doc-b@example.com"},
	} {
		if _, err := pool.Exec(ctx, `INSERT INTO users(id,name,email,role) VALUES($1,'知识库用户',$2,'user')`, user.id, user.email); err != nil {
			t.Fatal(err)
		}
	}

	kbID := resource.ID()
	if _, err := pool.Exec(ctx, `INSERT INTO knowledge_bases(id,name,owner_user_id,created_by_user_id,ownership_type) VALUES($1,'A 的知识库',$2,$2,'user')`, kbID, userA); err != nil {
		t.Fatal(err)
	}

	document, err := service.CreateUserDocument(ctx, userA, DocumentInput{KbID: kbID, Title: "原始文档", Content: "原始正文"})
	if err != nil {
		t.Fatalf("知识库所有者创建文档失败: %v", err)
	}
	documentID := document.String("id")
	// 即使文档存在且当前用户有权限，错误的知识库也不能读取或修改它。
	for _, name := range []string{"kb_get_document", "kb_update_document", "kb_delete_document"} {
		params, err := json.Marshal(map[string]any{
			"name":      name,
			"arguments": map[string]any{"kb_id": resource.ID(), "document_id": documentID, "title": "错误更新"},
		})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := service.callMCPTool(ctx, userA, params); !errors.Is(err, resource.NotFound) {
			t.Fatalf("%s 使用不匹配的 kb_id 应返回 NotFound: %v", name, err)
		}
	}

	if document.String("kb_id") != kbID || document.String("status") != "pending" {
		t.Fatalf("创建文档结果不正确: %v", document)
	}

	if _, err := service.CreateUserDocument(ctx, userB, DocumentInput{KbID: kbID, Title: "越权文档", Content: "越权正文"}); !errors.Is(err, resource.NotFound) {
		t.Fatalf("非所有者创建文档应返回 NotFound，实际: %v", err)
	}
	if _, err := service.GetAccessibleDocument(ctx, userB, documentID); !errors.Is(err, resource.NotFound) {
		t.Fatalf("非授权用户读取文档应返回 NotFound，实际: %v", err)
	}
	if _, err := service.ListAccessibleDocuments(ctx, userB, kbID, DocumentListFilter{}); !errors.Is(err, resource.NotFound) {
		t.Fatalf("非授权用户列出文档应返回 NotFound，实际: %v", err)
	}
	if _, err := service.UpdateUserDocument(ctx, userB, documentID, DocumentInput{Title: "越权更新"}); !errors.Is(err, resource.NotFound) {
		t.Fatalf("非所有者更新文档应返回 NotFound，实际: %v", err)
	}
	if err := service.DeleteUserDocument(ctx, userB, documentID); !errors.Is(err, resource.NotFound) {
		t.Fatalf("非所有者删除文档应返回 NotFound，实际: %v", err)
	}

	systemKB, systemDocument := resource.ID(), resource.ID()
	if _, err := pool.Exec(ctx, `INSERT INTO knowledge_bases(id,name,owner_user_id,created_by_user_id,ownership_type) VALUES($1,'系统知识库',$2,$2,'system')`, systemKB, admin); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO knowledge_base_documents(id,kb_id,title,content,created_by_user_id) VALUES($1,$2,'系统文档','系统正文',$3)`, systemDocument, systemKB, admin); err != nil {
		t.Fatal(err)
	}
	if _, err := service.GetAccessibleDocument(ctx, userA, systemDocument); !errors.Is(err, resource.NotFound) {
		t.Fatalf("未授权系统知识库文档应返回 NotFound，实际: %v", err)
	}
	if _, err := service.ListAccessibleDocuments(ctx, userA, systemKB, DocumentListFilter{}); !errors.Is(err, resource.NotFound) {
		t.Fatalf("未授权系统知识库文档列表应返回 NotFound，实际: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO resource_access_grants(resource_type,resource_id,user_id,access_level,granted_by_user_id) VALUES('kb',$1,$2,'read_only',$3)`, systemKB, userA, admin); err != nil {
		t.Fatal(err)
	}
	if item, err := service.GetAccessibleDocument(ctx, userA, systemDocument); err != nil || item.String("id") != systemDocument {
		t.Fatalf("有权限用户应可读取系统知识库文档: %v, %v", item, err)
	}
	if page, err := service.ListAccessibleDocuments(ctx, userA, systemKB, DocumentListFilter{}); err != nil || len(page.Items) != 1 || page.Items[0].String("id") != systemDocument {
		t.Fatalf("有权限用户应可列出系统知识库文档: %v, %v", page, err)
	}
	if _, err := service.GetAccessibleDocument(ctx, userB, systemDocument); !errors.Is(err, resource.NotFound) {
		t.Fatalf("无权限用户读取系统知识库文档应返回 NotFound，实际: %v", err)
	}
	if _, err := service.CreateUserDocument(ctx, userA, DocumentInput{KbID: systemKB, Title: "越权", Content: "越权"}); !errors.Is(err, resource.NotFound) {
		t.Fatalf("系统知识库创建文档应返回 NotFound，实际: %v", err)
	}
	if _, err := service.UpdateUserDocument(ctx, userA, systemDocument, DocumentInput{Title: "越权"}); !errors.Is(err, resource.NotFound) {
		t.Fatalf("更新系统知识库文档应返回 NotFound，实际: %v", err)
	}
	if err := service.DeleteUserDocument(ctx, userA, systemDocument); !errors.Is(err, resource.NotFound) {
		t.Fatalf("删除系统知识库文档应返回 NotFound，实际: %v", err)
	}

	if _, err := pool.Exec(ctx, `INSERT INTO resource_access_grants(resource_type,resource_id,user_id,access_level,granted_by_user_id) VALUES('kb',$1,$2,'read_only',$3)`, kbID, userB, userA); err != nil {
		t.Fatal(err)
	}
	if item, err := service.GetAccessibleDocument(ctx, userB, documentID); err != nil || item.String("id") != documentID {
		t.Fatalf("只读分享用户应可读取文档: %v, %v", item, err)
	}
	if page, err := service.ListAccessibleDocuments(ctx, userB, kbID, DocumentListFilter{}); err != nil || len(page.Items) != 1 || page.Items[0].String("id") != documentID {
		t.Fatalf("只读分享用户应可列出文档: %v, %v", page, err)
	}
	if _, err := service.UpdateUserDocument(ctx, userB, documentID, DocumentInput{Title: "只读越权"}); !errors.Is(err, resource.NotFound) {
		t.Fatalf("只读分享用户更新文档应返回 NotFound，实际: %v", err)
	}
	if err := service.DeleteUserDocument(ctx, userB, documentID); !errors.Is(err, resource.NotFound) {
		t.Fatalf("只读分享用户删除文档应返回 NotFound，实际: %v", err)
	}

	updated, err := service.UpdateUserDocument(ctx, userA, documentID, DocumentInput{Title: "更新文档", Content: "更新正文"})
	if err != nil {
		t.Fatalf("知识库所有者更新文档失败: %v", err)
	}
	if updated.String("title") != "更新文档" || updated.String("content") != "更新正文" || updated.String("status") != "pending" {
		t.Fatalf("更新文档结果不正确: %v", updated)
	}

	if _, err := pool.Exec(ctx, `INSERT INTO knowledge_base_chunks(kb_id,document_id,chunk_index,content) VALUES($1,$2,0,'分片')`, kbID, documentID); err != nil {
		t.Fatal(err)
	}
	if err := service.DeleteUserDocument(ctx, userA, documentID); err != nil {
		t.Fatalf("知识库所有者删除文档失败: %v", err)
	}
	var documents, chunks int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM knowledge_base_documents WHERE id=$1`, documentID).Scan(&documents); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM knowledge_base_chunks WHERE document_id=$1`, documentID).Scan(&chunks); err != nil {
		t.Fatal(err)
	}
	if documents != 0 || chunks != 0 {
		t.Fatalf("删除后 documents=%d chunks=%d，预期均为 0", documents, chunks)
	}
}
