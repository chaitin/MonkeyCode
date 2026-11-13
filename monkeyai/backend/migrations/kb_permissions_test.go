package migrations

import (
	"context"
	"crypto/rand"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

func TestKbPermissionsMigrationPreservesData(t *testing.T) {
	dsn := os.Getenv("MONKEYAI_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("设置 MONKEYAI_TEST_DATABASE_URL 验证权限迁移及回滚")
	}
	ctx := t.Context()
	root, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	schema := "kb_permissions_" + strings.ToLower(rand.Text())
	quoted := pgx.Identifier{schema}.Sanitize()
	if _, err = root.Exec(ctx, "CREATE SCHEMA "+quoted); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := root.Exec(context.Background(), "DROP SCHEMA "+quoted+" CASCADE"); err != nil {
			t.Error(err)
		}
		_ = root.Close(context.Background())
	})
	cfg, err := pgx.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.RuntimeParams["search_path"] = schema
	conn, err := pgx.ConnectConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close(context.Background()) })
	exec := func(query string) {
		t.Helper()
		if _, err := conn.Exec(ctx, query); err != nil {
			t.Fatal(err)
		}
	}
	apply := func(path string) {
		t.Helper()
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		exec(string(data))
	}
	paths, err := filepath.Glob("*.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range paths {
		if path >= "000040" {
			break
		}
		apply(path)
	}
	exec(`INSERT INTO users(id,name,email) VALUES('10000000-0000-4000-8000-000000000001','owner','owner@example.com');
 INSERT INTO knowledge_bases(id,name,owner_user_id,created_by_user_id,revision) VALUES('20000000-0000-4000-8000-000000000001','keep','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',7);
 INSERT INTO knowledge_base_documents(id,kb_id,title,content,revision,created_by_user_id) VALUES('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','title','preserve this body',3,'10000000-0000-4000-8000-000000000001');
 INSERT INTO knowledge_base_chunks(kb_id,document_id,chunk_index,content) VALUES('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',0,'preserve chunk');
 INSERT INTO knowledge_base_learning_jobs(kb_id,document_id,operation) VALUES('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','learn');
 INSERT INTO resource_access_grants(resource_type,resource_id,user_id,access_level,granted_by_user_id) VALUES('kb','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','read_write','10000000-0000-4000-8000-000000000001');`)
	snapshot := func() map[string]string {
		t.Helper()
		result := map[string]string{}
		for _, table := range []string{"knowledge_bases", "knowledge_base_documents", "knowledge_base_chunks", "knowledge_base_learning_jobs", "resource_access_grants"} {
			var body string
			if err := conn.QueryRow(ctx, "SELECT coalesce(jsonb_agg(to_jsonb(r) - 'updated_by_user_id' - 'content_updated_at' ORDER BY id),'[]'::jsonb)::text FROM "+pgx.Identifier{table}.Sanitize()+" r").Scan(&body); err != nil {
				t.Fatal(err)
			}
			result[table] = body
		}
		return result
	}
	before := snapshot()
	check := func() {
		t.Helper()
		for table, value := range snapshot() {
			if value != before[table] {
				t.Fatalf("%s 原始业务数据改变", table)
			}
		}
	}
	apply("000040_kb_permissions.up.sql")
	check()
	var nulls bool
	if err := conn.QueryRow(ctx, `SELECT (SELECT bool_and(updated_by_user_id IS NULL) FROM resource_access_grants) AND (SELECT bool_and(updated_by_user_id IS NULL AND content_updated_at IS NULL) FROM knowledge_base_documents)`).Scan(&nulls); err != nil || !nulls {
		t.Fatalf("应保留未知元数据为 NULL: %v %v", nulls, err)
	}
	exec(`UPDATE resource_access_grants SET updated_by_user_id='10000000-0000-4000-8000-000000000001'; UPDATE knowledge_base_documents SET updated_by_user_id='10000000-0000-4000-8000-000000000001',content_updated_at=now()`)
	apply("000040_kb_permissions.down.sql")
	check()
	var count int
	if err := conn.QueryRow(ctx, `SELECT count(*) FROM information_schema.columns WHERE table_schema=$1 AND table_name IN ('knowledge_base_documents','resource_access_grants') AND column_name IN ('updated_by_user_id','content_updated_at')`, schema).Scan(&count); err != nil || count != 0 {
		t.Fatalf("down 未删除新增字段: %d %v", count, err)
	}
	apply("000040_kb_permissions.up.sql")
	check()
	if err := conn.QueryRow(ctx, `SELECT (SELECT bool_and(updated_by_user_id IS NULL) FROM resource_access_grants) AND (SELECT bool_and(updated_by_user_id IS NULL AND content_updated_at IS NULL) FROM knowledge_base_documents)`).Scan(&nulls); err != nil || !nulls {
		t.Fatalf("重新 up 应恢复空字段: %v %v", nulls, err)
	}
}
