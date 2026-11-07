package migrations

import (
	"context"
	"crypto/rand"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

func TestUpgradeFrom14(t *testing.T) {
	dsn := os.Getenv("MONKEYAI_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("设置 MONKEYAI_TEST_DATABASE_URL 并安装 migrate 运行迁移升级测试")
	}
	command, err := exec.LookPath("migrate")
	if err != nil {
		t.Fatal(err)
	}
	root, err := pgx.Connect(t.Context(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	schema := "migration_test_" + strings.ToLower(rand.Text())
	quoted := pgx.Identifier{schema}.Sanitize()
	t.Cleanup(func() {
		if _, err := root.Exec(context.Background(), "DROP SCHEMA "+quoted+" CASCADE"); err != nil {
			t.Errorf("清理测试 schema: %v", err)
		}
		_ = root.Close(context.Background())
	})
	if _, err := root.Exec(t.Context(), "CREATE SCHEMA "+quoted); err != nil {
		t.Fatal(err)
	}
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := u.Query()
	query.Set("search_path", schema)
	u.RawQuery = query.Encode()
	conn, err := pgx.Connect(t.Context(), u.String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close(context.Background()) })
	run := func(args ...string) string {
		t.Helper()
		cmd := exec.CommandContext(t.Context(), command, append([]string{"-path", ".", "-database", u.String()}, args...)...)
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("migrate %v: %v\n%s", args, err, output)
		}
		return string(output)
	}
	run("goto", "14")
	if _, err := conn.Exec(t.Context(), `
		INSERT INTO users (id, name, email)
		VALUES ('00000000-0000-0000-0000-000000000001', '迁移测试', 'migration@example.com');
		INSERT INTO credit_accounts (user_id, balance, frozen, period_start_at, period_end_at, last_refreshed_at)
		VALUES ('00000000-0000-0000-0000-000000000001', 100, 12, now(), now() + interval '1 day', now());
		INSERT INTO skills (ownership_type, owner_user_id, name, description,
			package_file_name, package_s3_key, package_size_bytes, package_sha256)
		VALUES ('system', '00000000-0000-0000-0000-000000000001', '已有资源', '保留描述',
			'skill.zip', 'skills/test.zip', 1, repeat('a', 64));
		INSERT INTO sessions (owner_user_id, title, session_type, client_type, client_name, started_at)
		VALUES ('00000000-0000-0000-0000-000000000001', '已有会话', 'conversation', 'desktop', 'desktop', now());`); err != nil {
		t.Fatal(err)
	}
	output := run("up")
	last := -1
	for _, migration := range []string{
		"15/u billing_remove_credit_freeze", "16/u outbound_proxy_add", "17/u resource_import",
		"18/u resource_origin", "19/u session_turn_content_add", "20/u model_call_first_token_duration",
		"21/u video_output_metadata_optional", "22/u video_poll_retry_limit", "23/u video_seedance_provider", "24/u remote_runtime", "25/u remote_runtime_access_version",
		"26/u endpoint_platform_text", "31/u session_client_runtime_add",
		"35/u billing_activity_lock_retry", "36/u user_profile_add", "37/u oauth_pairing", "38/u cloud_environments", "39/u environment_directory_storage",
	} {
		index := strings.Index(output, migration)
		if index <= last {
			t.Fatalf("迁移未按顺序执行 %s: %s", migration, output)
		}
		last = index
	}
	var version int
	var dirty bool
	if err := conn.QueryRow(t.Context(), "SELECT version, dirty FROM schema_migrations").Scan(&version, &dirty); err != nil {
		t.Fatal(err)
	}
	paths, err := filepath.Glob("*.up.sql")
	if err != nil || len(paths) == 0 {
		t.Fatal("迁移文件缺失")
	}
	latest, err := strconv.Atoi(strings.Split(filepath.Base(paths[len(paths)-1]), "_")[0])
	if err != nil {
		t.Fatal(err)
	}
	if version != latest || dirty {
		t.Fatalf("迁移状态错误: version=%d, dirty=%v", version, dirty)
	}
	var balance, frozen, description, origin, nameI18n string
	err = conn.QueryRow(t.Context(), `SELECT a.balance::text, a.frozen::text, s.description, s.origin, s.name_i18n::text
		FROM credit_accounts a JOIN skills s ON s.owner_user_id = a.user_id`).
		Scan(&balance, &frozen, &description, &origin, &nameI18n)
	if err != nil || balance != "100.000000" || frozen != "0.000000" ||
		description != "保留描述" || origin != "local" || nameI18n != "{}" {
		t.Fatalf("业务数据或新增字段默认值错误: %q %q %q %q %q %v", balance, frozen, description, origin, nameI18n, err)
	}
	var valid bool
	err = conn.QueryRow(t.Context(), `SELECT
		to_regclass('oauth_device_requests') IS NOT NULL AND to_regclass('device_client_connections') IS NOT NULL
		AND to_regclass('oauth_grants') IS NOT NULL
		AND to_regclass('oauth_pairing_requests') IS NOT NULL
		AND to_regclass('resource_imports') IS NOT NULL AND to_regclass('resource_import_bindings') IS NOT NULL
		AND (SELECT count(*) = 4 FROM information_schema.columns WHERE table_schema = current_schema()
			AND table_name IN ('skills', 'rules', 'connectors', 'experts') AND column_name = 'origin')
		AND (SELECT count(*) = 2 FROM information_schema.columns WHERE table_schema = current_schema()
			AND table_name IN ('models', 'connectors') AND column_name = 'proxy_id')
		AND (SELECT count(*) = 4 FROM information_schema.columns WHERE table_schema = current_schema()
			AND table_name = 'session_turns' AND column_name IN ('input_text', 'input_text_truncated', 'title', 'title_source'))`).Scan(&valid)
	if err != nil || !valid {
		t.Fatalf("升级后的结构不完整: %v", err)
	}
	if _, err := conn.Exec(t.Context(), "UPDATE sessions SET client_type='runtime'"); err != nil {
		t.Fatalf("升级后应支持 runtime 会话: %v", err)
	}
	down, err := os.ReadFile("000031_session_client_runtime_add.down.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Exec(t.Context(), string(down)); err == nil || !strings.Contains(err.Error(), "sessions_client_type_check") {
		t.Fatalf("存在 runtime 会话时应拒绝回滚: %v", err)
	}
	var clientType, title string
	if err := conn.QueryRow(t.Context(), "SELECT client_type,title FROM sessions").Scan(&clientType, &title); err != nil || clientType != "runtime" || title != "已有会话" {
		t.Fatalf("回滚失败不应改写已有会话: type=%s title=%s err=%v", clientType, title, err)
	}
	if _, err := conn.Exec(t.Context(), "UPDATE sessions SET client_type='desktop'"); err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Exec(t.Context(), `
		INSERT INTO engine_hosts(id,name,architecture,version,enrollment_hash,enrollment_expires_at)
		VALUES('00000000-0000-0000-0000-000000000002','宿主','amd64','v1','enrollment',now()+interval '1 hour');
		INSERT INTO environment_presets(id,name,architecture,configuration,cpu_millis,memory_bytes,storage_bytes)
		VALUES('00000000-0000-0000-0000-000000000003','预设','amd64','{}',1000,1073741824,1073741824);
		INSERT INTO environments(id,user_id,host_id,preset_id,name,generation,instance_id,desired,spec,cpu_millis,memory_bytes,storage_bytes,request_key,request_hash)
		VALUES('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001',
		'00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','环境',1,
		'00000000-0000-0000-0000-000000000005','stopped','{}',1000,1073741824,1073741824,'create','hash');
		INSERT INTO environment_runtime(environment_id,machine_id,public_key,instance_id,generation,request_id)
		VALUES('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000006',
		decode(repeat('ab',32),'hex'),'00000000-0000-0000-0000-000000000005',1,'00000000-0000-0000-0000-000000000007');
		INSERT INTO environment_operations(environment_id,generation,desired,request_key,request_hash)
		VALUES('00000000-0000-0000-0000-000000000004',1,'stopped','stop','hash');`); err != nil {
		t.Fatal(err)
	}
	checkEnvironmentReplay(t, conn)
	run("goto", "37")
	if err := conn.QueryRow(t.Context(), "SELECT version, dirty FROM schema_migrations").Scan(&version, &dirty); err != nil || version != 37 || dirty {
		t.Fatalf("云环境应一次回滚到 37: version=%d dirty=%v err=%v", version, dirty, err)
	}
	for _, table := range []string{"engine_hosts", "environment_control", "environment_presets", "environment_hosts", "environment_quotas", "environments", "environment_operations", "environment_runtime"} {
		var absent bool
		if err := conn.QueryRow(t.Context(), "SELECT to_regclass($1) IS NULL", table).Scan(&absent); err != nil || !absent {
			t.Fatalf("云环境回滚残留 %s: %v", table, err)
		}
	}
	for range 2 {
		applyEnvironmentMigration(t, conn, "000039_environment_directory_storage.down.sql")
		applyEnvironmentMigration(t, conn, "000038_cloud_environments.down.sql")
	}
	run("goto", "36")
	var removed bool
	if err := conn.QueryRow(t.Context(), "SELECT to_regclass('oauth_pairing_requests') IS NULL").Scan(&removed); err != nil || !removed {
		t.Fatalf("配对迁移回滚未删除新表: %v", err)
	}
	run("up")
	var restored bool
	if err := conn.QueryRow(t.Context(), "SELECT to_regclass('oauth_pairing_requests') IS NOT NULL").Scan(&restored); err != nil || !restored {
		t.Fatalf("配对迁移重新升级未恢复新表: %v", err)
	}
	if err := conn.QueryRow(t.Context(), "SELECT version, dirty FROM schema_migrations").Scan(&version, &dirty); err != nil || version != latest || dirty {
		t.Fatalf("云环境应升级到最新版本: version=%d dirty=%v err=%v", version, dirty, err)
	}
	if _, err := conn.Exec(t.Context(), "UPDATE sessions SET client_type='runtime'"); err != nil {
		t.Fatalf("重新升级后应支持 runtime 会话: %v", err)
	}
	if output := run("up"); !strings.Contains(output, "no change") {
		t.Fatalf("重复 up 应无变更: %s", output)
	}
}
