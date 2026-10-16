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
			'skill.zip', 'skills/test.zip', 1, repeat('a', 64));`); err != nil {
		t.Fatal(err)
	}
	output := run("up")
	last := -1
	for _, migration := range []string{
		"15/u billing_remove_credit_freeze", "16/u outbound_proxy_add", "17/u resource_import",
		"18/u resource_origin", "19/u session_turn_content_add", "20/u model_call_first_token_duration",
		"21/u video_output_metadata_optional", "22/u video_poll_retry_limit", "23/u video_seedance_provider", "24/u remote_runtime", "25/u remote_runtime_access_version",
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
	run("down", "1")
	run("up")
	if output := run("up"); !strings.Contains(output, "no change") {
		t.Fatalf("重复 up 应无变更: %s", output)
	}
}
