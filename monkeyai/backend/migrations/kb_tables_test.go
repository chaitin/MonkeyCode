package migrations

import (
	"os"
	"strings"
	"testing"
)

func TestKbMigrationContainsFinalSchema(t *testing.T) {
	up, err := os.ReadFile("000039_create_kb_tables.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := strings.ToLower(string(up))
	for _, table := range []string{
		"create table kb (",
		"create table kb_documents (",
		"create table kb_chunks (",
		"create table kb_learning_jobs (",
	} {
		if !strings.Contains(sql, table) {
			t.Fatalf("迁移缺少表定义 %s", table)
		}
	}
	for _, fragment := range []string{
		"create extension if not exists vector",
		"fusion_config jsonb",
		"embedding_model_id uuid",
		"document_revision integer",
		"embedding_dimension integer",
		"search_tokens text",
		"search_tsv tsvector",
		"create unique index kb_chunks_document_index_key",
		"on kb_chunks (kb_id, document_id, chunk_index)",
		"using gin (search_tsv)",
		"resource_type in ('model', 'skill', 'rule', 'connector', 'expert', 'kb')",
		"'learn', 'relearn', 'rebuild_parse', 'rebuild_lexical', 'rebuild_vector',",
		"'rebuild_model'",
		"kb_learning_jobs_document_revision_check",
		"kb_learning_jobs_embedding_dimension_check",
		"create index kb_learning_jobs_document_active_idx",
		"create index kb_learning_jobs_embedding_model_idx",
		"insert into migrations (name) values ('000039_create_kb_tables')",
	} {
		if !strings.Contains(sql, fragment) {
			t.Fatalf("迁移缺少最终结构 %q", fragment)
		}
	}
	if strings.Contains(sql, "deleted_at") {
		t.Fatal("合并后的 KB 表不应保留软删除字段")
	}
	if strings.Contains(sql, " references ") {
		t.Fatal("KB 表不应使用数据库外键，关系由业务层维护")
	}
	for _, removed := range []string{"index_strategy", "search_mode", "enable_vector", "disable_vector"} {
		if strings.Contains(sql, removed) {
			t.Fatalf("知识库不再持久化 %q，向量能力应由 embedding 模型推导", removed)
		}
	}
}

func TestKbDownMigrationDropsAllKbTables(t *testing.T) {
	down, err := os.ReadFile("000039_create_kb_tables.down.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := strings.ToLower(string(down))
	jobs := strings.Index(sql, "drop table if exists kb_learning_jobs")
	chunks := strings.Index(sql, "drop table if exists kb_chunks")
	documents := strings.Index(sql, "drop table if exists kb_documents")
	kb := strings.Index(sql, "drop table if exists kb;")
	if jobs < 0 || chunks < 0 || documents < 0 || kb < 0 || !(jobs < chunks && chunks < documents && documents < kb) {
		t.Fatalf("down 迁移删除顺序无效: %s", down)
	}
	for _, cleanup := range []string{
		"delete from resource_tags where resource_type = 'kb'",
		"delete from resource_access_grants where resource_type = 'kb'",
		"delete from migrations where name = '000039_create_kb_tables'",
	} {
		if !strings.Contains(sql, cleanup) {
			t.Fatalf("down 迁移缺少清理 %q", cleanup)
		}
	}
	if !strings.Contains(sql, "resource_type in ('model', 'skill', 'rule', 'connector', 'expert')") {
		t.Fatal("down 迁移未恢复不含 kb 的资源类型约束")
	}
}
