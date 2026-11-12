package kb

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func kbTestPool(t *testing.T) (*pgxpool.Pool, string) {
	t.Helper()
	dsn := os.Getenv("MONKEYAI_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("设置 MONKEYAI_TEST_DATABASE_URL 运行知识库数据库测试")
	}
	ctx := t.Context()
	root, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(root.Close)
	schema := "test_kb_" + strings.ReplaceAll(resource.ID(), "-", "")
	if _, err = root.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
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
	paths, err := filepath.Glob("../../migrations/*.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = pool.Exec(ctx, string(data)); err != nil {
			t.Fatalf("执行迁移 %s: %v", filepath.Base(path), err)
		}
	}
	actor := resource.ID()
	if _, err = pool.Exec(ctx, `INSERT INTO users(id,name,email,role) VALUES($1,'知识库管理员','kb-delete@example.com','admin')`, actor); err != nil {
		t.Fatal(err)
	}
	return pool, actor
}

func TestCancelKbLearningJobsWithoutDocument(t *testing.T) {
	pool, actor := kbTestPool(t)
	ctx := t.Context()
	kbID, documentID := resource.ID(), resource.ID()
	if _, err := pool.Exec(ctx, `INSERT INTO knowledge_bases(id,name,owner_user_id,created_by_user_id) VALUES($1,'任务取消测试',$2,$2)`, kbID, actor); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO knowledge_base_documents(id,kb_id,title,content,created_by_user_id) VALUES($1,$2,'文档','内容',$3)`, documentID, kbID, actor); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO knowledge_base_learning_jobs(kb_id,document_id,operation,status) VALUES($1,NULL,'rebuild_lexical','pending')`, kbID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO knowledge_base_learning_jobs(kb_id,document_id,operation,status) VALUES($1,$2,'relearn','pending')`, kbID, documentID); err != nil {
		t.Fatal(err)
	}

	service := NewService(resource.NewStore(pool), nil)
	if _, err := service.RebuildIndex(ctx, kbID, OperationRebuildLexical, "", ""); err != nil {
		t.Fatalf("知识库级取消失败: %v", err)
	}
	var canceled, pending int
	if err := pool.QueryRow(ctx, `SELECT count(*) FILTER (WHERE status='canceled'), count(*) FILTER (WHERE status='pending') FROM knowledge_base_learning_jobs WHERE kb_id=$1`, kbID).Scan(&canceled, &pending); err != nil {
		t.Fatal(err)
	}
	if canceled != 2 || pending != 2 {
		t.Fatalf("任务状态 = canceled:%d pending:%d，预期 canceled:2 pending:2", canceled, pending)
	}
}

func TestRegisterAdminDeleteRemovesKbRelations(t *testing.T) {
	pool, actor := kbTestPool(t)
	ctx := t.Context()
	service := NewService(resource.NewStore(pool), nil)
	router := chi.NewRouter()
	router.Use(identity.NewService(pool, nil, "http://localhost").RequireBrowser)
	service.RegisterAdmin(router)

	session := "kb-delete-admin-session"
	digest := sha256.Sum256([]byte(session))
	if _, err := pool.Exec(ctx, `INSERT INTO browser_sessions(token_hash,user_id,authentication_method,expires_at) VALUES($1,$2,'password',now()+interval '1 hour')`, hex.EncodeToString(digest[:]), actor); err != nil {
		t.Fatal(err)
	}

	kbID, documentID, tagID := resource.ID(), resource.ID(), resource.ID()
	otherKbID, otherDocumentID := resource.ID(), resource.ID()
	seed := func(kb, document string, ownership string) {
		t.Helper()
		if _, err := pool.Exec(ctx, `INSERT INTO knowledge_bases(id,name,owner_user_id,created_by_user_id,ownership_type) VALUES($1,$2,$3,$3,$4)`, kb, "删除测试 "+kb[:8], actor, ownership); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, `INSERT INTO knowledge_base_documents(id,kb_id,title,content,created_by_user_id) VALUES($1,$2,'文档','内容',$3)`, document, kb, actor); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, `INSERT INTO knowledge_base_chunks(kb_id,document_id,chunk_index,content) VALUES($1,$2,0,'分片')`, kb, document); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, `INSERT INTO knowledge_base_learning_jobs(kb_id,document_id,operation,status) VALUES($1,NULL,'rebuild_lexical','pending')`, kb); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, `INSERT INTO resource_access_grants(resource_type,resource_id,all_users,access_level,granted_by_user_id) VALUES('kb',$1,true,'read_only',$2)`, kb, actor); err != nil {
			t.Fatal(err)
		}
	}
	seed(kbID, documentID, "system")
	seed(otherKbID, otherDocumentID, "system")
	if _, err := pool.Exec(ctx, `INSERT INTO tags(id,name,created_by_user_id) VALUES($1,'知识库标签',$2)`, tagID, actor); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{kbID, otherKbID} {
		if _, err := pool.Exec(ctx, `INSERT INTO resource_tags(resource_type,resource_id,tag_id,assigned_by_user_id) VALUES('kb',$1,$2,$3)`, id, tagID, actor); err != nil {
			t.Fatal(err)
		}
	}

	call := func(id, match string, want int) {
		t.Helper()
		request := httptest.NewRequest(http.MethodDelete, "/kb/"+id, nil)
		request.AddCookie(&http.Cookie{Name: "monkeyai_session", Value: session})
		if match != "" {
			request.Header.Set("If-Match", match)
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != want {
			t.Fatalf("DELETE /kb/%s: status=%d want=%d body=%s", id, response.Code, want, response.Body.String())
		}
	}
	call(kbID, `"999"`, http.StatusPreconditionFailed)
	call(kbID, `"1"`, http.StatusNoContent)

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
	for name, query := range map[string]string{
		"kb":                           `SELECT count(*) FROM knowledge_bases WHERE id=$1`,
		"knowledge_base_documents":     `SELECT count(*) FROM knowledge_base_documents WHERE kb_id=$1`,
		"knowledge_base_chunks":        `SELECT count(*) FROM knowledge_base_chunks WHERE kb_id=$1`,
		"knowledge_base_learning_jobs": `SELECT count(*) FROM knowledge_base_learning_jobs WHERE kb_id=$1`,
	} {
		var count int
		if err := pool.QueryRow(ctx, query, otherKbID).Scan(&count); err != nil {
			t.Fatalf("统计其他知识库 %s: %v", name, err)
		}
		if count != 1 {
			t.Fatalf("其他知识库 %s 记录数=%d，预期 1", name, count)
		}
	}
}
