package main

import (
	"strings"
	"testing"
)

func TestSchemaStatements(t *testing.T) {
	input := `-- 结构定义
CREATE TABLE examples (name text DEFAULT 'a;''b');
/* 外层 /* 内层 */ 注释 */ ALTER TABLE examples ADD COLUMN active boolean DEFAULT true;
CREATE TEMP TABLE legacy AS SELECT '忽略;临时表';
DO $migration$ BEGIN PERFORM '忽略;数据搬迁'; END $migration$;
INSERT INTO examples(name) VALUES ('数据');
CREATE UNLOGGED TABLE temporary_results (name text DEFAULT E'a\';b');
DROP TABLE temporary_results;
`
	statements, err := split(input)
	if err != nil {
		t.Fatal(err)
	}
	var schema []string
	for _, statement := range statements {
		if ddl.MatchString(statement) {
			schema = append(schema, statement)
		}
	}
	if len(statements) != 7 || len(schema) != 4 || !strings.Contains(schema[0], "'a;''b'") {
		t.Fatalf("结构提取错误: %#v", statements)
	}
}

func TestRejectIncompleteSQL(t *testing.T) {
	for _, input := range []string{"CREATE TABLE missing(id text)", "SELECT 'unclosed;", "DO $$BEGIN;", "/* unclosed"} {
		if _, err := split(input); err == nil {
			t.Errorf("应拒绝未闭合 SQL: %q", input)
		}
	}
}
