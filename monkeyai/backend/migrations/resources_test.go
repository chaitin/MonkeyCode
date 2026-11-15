package migrations

import (
	"os"
	"testing"

	"github.com/jackc/pgx/v5"
)

func checkResourceDefaultsReplay(t *testing.T, conn *pgx.Conn) {
	t.Helper()
	ctx := t.Context()
	if _, err := conn.Exec(ctx, `UPDATE host_environment_configs SET user_max_environments=7,resource='{"cpu_millis":1500,"memory_bytes":1073741824,"host_tasks":512,"temporary_bytes":67108864}'`); err != nil {
		t.Fatal(err)
	}
	var snapshot string
	if err := conn.QueryRow(ctx, "SELECT spec::text FROM environments LIMIT 1").Scan(&snapshot); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		applyEnvironmentMigration(t, conn, "000040_cloud_environments.up.sql")
	}
	var cpu, revision int64
	var keys int
	if err := conn.QueryRow(ctx, "SELECT user_max_environments,(resource->>'cpu_millis')::bigint,(SELECT count(*) FROM jsonb_object_keys(resource)) FROM host_environment_configs").Scan(&revision, &cpu, &keys); err != nil || revision != 7 || cpu != 1500 || keys != 4 {
		t.Fatal("重放改变默认资源", revision, cpu, keys, err)
	}
	var after string
	if err := conn.QueryRow(ctx, "SELECT spec::text FROM environments LIMIT 1").Scan(&after); err != nil || after != snapshot {
		t.Fatal("重放改变环境快照", after, err)
	}
	down, err := os.ReadFile("000040_cloud_environments.down.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Exec(ctx, string(down)); err == nil {
		t.Fatal("存在未删除环境时允许回滚")
	}
	if _, err := conn.Exec(ctx, "ROLLBACK"); err != nil {
		t.Fatal(err)
	}
	if err := conn.QueryRow(ctx, "SELECT spec::text FROM environments LIMIT 1").Scan(&after); err != nil || after != snapshot {
		t.Fatal("回滚失败改变已有环境", after, err)
	}
}
