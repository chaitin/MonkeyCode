package migrations

import (
	"errors"
	"maps"
	"os"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func applyEnvironmentMigration(t *testing.T, conn *pgx.Conn, path string) {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Exec(t.Context(), string(raw)); err != nil {
		t.Fatalf("执行 %s: %v", path, err)
	}
}

func checkEnvironmentReplay(t *testing.T, conn *pgx.Conn) {
	t.Helper()
	exec := func(sql string) {
		t.Helper()
		if _, err := conn.Exec(t.Context(), sql); err != nil {
			t.Fatal(err)
		}
	}
	snapshot := func() map[string]string {
		t.Helper()
		out := make(map[string]string)
		for _, table := range []string{"engine_hosts", "environment_control", "environment_presets", "environment_hosts", "environment_quotas", "environments", "environment_operations", "environment_runtime"} {
			var data string
			if err := conn.QueryRow(t.Context(), "SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb)::text FROM "+pgx.Identifier{table}.Sanitize()+" r").Scan(&data); err != nil {
				t.Fatal(err)
			}
			out[table] = data
		}
		return out
	}
	apply := func(name string) {
		t.Helper()
		applyEnvironmentMigration(t, conn, name)
	}
	exec(`INSERT INTO environment_hosts(host_id,cpu_millis,memory_bytes,storage_bytes,max_environments)
SELECT id,2000,2147483648,0,10 FROM engine_hosts;
INSERT INTO environment_quotas(user_id,max_environments,max_running,cpu_millis,memory_bytes,storage_bytes)
SELECT id,10,5,2000,2147483648,0 FROM users;
UPDATE environment_presets SET storage_bytes=0;`)
	before := snapshot()
	for range 2 {
		apply("000038_cloud_environments.up.sql")
		apply("000039_environment_directory_storage.up.sql")
		if !maps.Equal(before, snapshot()) {
			t.Fatal("重复升级改变了已有宿主、预设、环境或执行身份")
		}
	}
	_, err := conn.Exec(t.Context(), "UPDATE environment_presets SET storage_bytes=-1")
	if pg, ok := errors.AsType[*pgconn.PgError](err); !ok || pg.Code != "23514" {
		t.Fatalf("重复升级后存储非负约束失效: %v", err)
	}
	raw, err := os.ReadFile("000039_environment_directory_storage.down.sql")
	if err != nil {
		t.Fatal(err)
	}
	_, err = conn.Exec(t.Context(), string(raw))
	if pg, ok := errors.AsType[*pgconn.PgError](err); !ok || pg.Code != "23514" {
		t.Fatalf("存在零容量预设时应拒绝回滚: %v", err)
	}
	exec("ROLLBACK")
	if !maps.Equal(before, snapshot()) {
		t.Fatal("回滚失败改变了已有环境数据")
	}
	exec("UPDATE environment_presets SET storage_bytes=1024")
	before = snapshot()
	for range 2 {
		apply("000039_environment_directory_storage.down.sql")
		if !maps.Equal(before, snapshot()) {
			t.Fatal("重复回滚普通目录迁移改变了数据")
		}
	}
	_, err = conn.Exec(t.Context(), "UPDATE environment_presets SET storage_bytes=0")
	if pg, ok := errors.AsType[*pgconn.PgError](err); !ok || pg.Code != "23514" {
		t.Fatalf("回滚后未恢复正数容量约束: %v", err)
	}
	apply("000038_cloud_environments.up.sql")
	apply("000039_environment_directory_storage.up.sql")
	if !maps.Equal(before, snapshot()) {
		t.Fatal("重新升级改变了已有环境数据")
	}
}
