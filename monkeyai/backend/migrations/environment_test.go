package migrations

import (
	"maps"
	"os"
	"testing"

	"github.com/jackc/pgx/v5"
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
	ctx := t.Context()
	snapshot := func() map[string]string {
		t.Helper()
		out := map[string]string{}
		for _, table := range []string{"hosts", "host_environment_configs", "host_upgrades", "environment_quotas", "environments", "environment_runtimes", "environment_operations", "environment_billing_periods", "resource_access_grants"} {
			var data string
			if err := conn.QueryRow(ctx, "SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb)::text FROM "+pgx.Identifier{table}.Sanitize()+" r").Scan(&data); err != nil {
				t.Fatal(err)
			}
			out[table] = data
		}
		return out
	}
	before := snapshot()
	for range 2 {
		applyEnvironmentMigration(t, conn, "000040_cloud_environments.up.sql")
		if !maps.Equal(before, snapshot()) {
			t.Fatal("重放改变宿主、设置、环境、身份或操作")
		}
	}
	for _, table := range []string{"engine_hosts", "environment_control", "environment_presets", "environment_hosts", "environment_scheduling", "environment_runtime", "engine_upgrades"} {
		var exists bool
		if err := conn.QueryRow(ctx, "SELECT to_regclass($1) IS NOT NULL", table).Scan(&exists); err != nil || exists {
			t.Fatal("保留了多余表", table, err)
		}
	}
}
