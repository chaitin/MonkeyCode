package migrations

import (
	"os"
	"testing"

	"github.com/jackc/pgx/v5"
)

func checkRuntimeUpgradeReplay(t *testing.T, conn *pgx.Conn) {
	t.Helper()
	if _, err := conn.Exec(t.Context(), `UPDATE environment_runtimes SET runtime_version='26.1105.1';
INSERT INTO environment_operations(environment_id,user_id,generation,desired,kind,target_version,request_key,request_hash)
SELECT id,user_id,2,'stopped','runtime_upgrade','26.1105.2','runtime-migration-test','hash' FROM environments;`); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		applyEnvironmentMigration(t, conn, "000040_cloud_environments.up.sql")
	}
	var current, target, kind string
	if err := conn.QueryRow(t.Context(), `SELECT r.runtime_version,o.target_version,o.kind FROM environments e JOIN environment_runtimes r ON r.environment_id=e.id JOIN environment_operations o ON o.environment_id=e.id WHERE o.request_key='runtime-migration-test'`).Scan(&current, &target, &kind); err != nil || current != "26.1105.1" || target != "26.1105.2" || kind != "runtime_upgrade" {
		t.Fatal("重复升级改变了runtime版本或操作", current, target, kind, err)
	}
	raw, err := os.ReadFile("000040_cloud_environments.down.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Exec(t.Context(), string(raw)); err == nil {
		t.Fatal("允许在runtime更新待完成时回滚")
	}
	if _, err := conn.Exec(t.Context(), "ROLLBACK"); err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Exec(t.Context(), "UPDATE environment_operations SET status='failed' WHERE request_key='runtime-migration-test'"); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		applyEnvironmentMigration(t, conn, "000040_cloud_environments.up.sql")
	}
	if _, err := conn.Exec(t.Context(), "DELETE FROM environment_operations WHERE request_key='runtime-migration-test'"); err != nil {
		t.Fatal(err)
	}
}
