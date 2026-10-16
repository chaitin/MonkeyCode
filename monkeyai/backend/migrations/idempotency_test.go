package migrations

import (
	"context"
	"crypto/rand"
	"errors"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func TestRuntimeMigrationsIdempotent(t *testing.T) {
	dsn := os.Getenv("MONKEYAI_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("设置 MONKEYAI_TEST_DATABASE_URL 验证迁移 SQL 重复执行")
	}
	root, err := pgx.Connect(t.Context(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	schema := "migration_repeat_" + strings.ToLower(rand.Text())
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
	cfg, err := pgx.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.RuntimeParams["search_path"] = schema
	conn, err := pgx.ConnectConfig(t.Context(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close(context.Background()) })
	exec := func(sql string) {
		t.Helper()
		if _, err := conn.Exec(t.Context(), sql); err != nil {
			t.Fatal(err)
		}
	}
	apply := func(path string) {
		t.Helper()
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := conn.Exec(t.Context(), string(data)); err != nil {
			t.Fatalf("执行 %s: %v", path, err)
		}
	}
	snapshot := func() map[string]string {
		t.Helper()
		out := make(map[string]string)
		for _, table := range []string{"oauth_tokens", "oauth_grants", "oauth_authorization_requests", "oauth_authorization_codes", "oauth_login_states", "oauth_device_requests", "endpoints", "device_client_connections", "sessions", "api_keys"} {
			var exists bool
			if err := conn.QueryRow(t.Context(), "SELECT to_regclass($1) IS NOT NULL", table).Scan(&exists); err != nil {
				t.Fatal(err)
			}
			if !exists {
				continue
			}
			var data string
			if err := conn.QueryRow(t.Context(), "SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]'::jsonb)::text FROM "+pgx.Identifier{table}.Sanitize()+" r").Scan(&data); err != nil {
				t.Fatal(err)
			}
			out[table] = data
		}
		return out
	}
	unchanged := func(before map[string]string) {
		t.Helper()
		after := snapshot()
		if !maps.Equal(before, after) {
			for table, data := range before {
				if after[table] != data {
					t.Errorf("重复迁移改变了 %s 的数据或结构", table)
				}
			}
			t.Fatal("重复迁移状态不一致")
		}
	}
	up, err := filepath.Glob("*.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	var runtimeUp []string
	for _, path := range up {
		if path < "000024_" {
			apply(path)
		} else {
			runtimeUp = append(runtimeUp, path)
		}
	}
	if len(runtimeUp) != 2 {
		t.Fatalf("远程执行迁移数量错误: %d", len(runtimeUp))
	}
	exec(`INSERT INTO users(id,name,email) VALUES('00000000-0000-0000-0000-000000000001','幂等测试','repeat@example.com');
INSERT INTO oauth_tokens(id,user_id,client_id,access_token_hash,refresh_token_hash,access_expires_at,refresh_expires_at,revoked_at) VALUES
('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','monkeyai-desktop','legacy-access','legacy-refresh',now()+interval '1 hour',now()+interval '1 day',NULL),
('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','monkeyai-desktop','revoked-access','revoked-refresh',now()+interval '1 hour',now()+interval '1 day',now()-interval '1 hour');`)
	for _, path := range runtimeUp {
		apply(path)
		before := snapshot()
		apply(path)
		unchanged(before)
	}
	exec(`INSERT INTO oauth_grants(id,user_id,client_id,scopes,purpose,machine_id,key_id,revocation_version,expires_at,revoked_at,revoke_reason) VALUES
('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001','monkeyai-desktop','{device:bind,session:read}','user','00000000-0000-0000-0000-000000000010','device-key',9,now()+interval '1 day',now()-interval '1 hour','user_logout'),
('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000001','monkeyai-runtime','{device:bind,device:publish,session:report}','runtime','00000000-0000-0000-0000-000000000010','device-key',7,now()+interval '1 day',NULL,NULL);
UPDATE oauth_grants SET requested_machine_id=machine_id,requested_key_id=key_id,restore_approved=true WHERE purpose='runtime';
INSERT INTO oauth_tokens(id,user_id,client_id,grant_id,parent_id,rotated_at,access_token_hash,refresh_token_hash,access_expires_at,refresh_expires_at,revoked_at) VALUES
('00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000001','monkeyai-desktop','00000000-0000-0000-0000-000000000004',NULL,now(),'modern-root','modern-refresh',now()+interval '1 hour',now()+interval '1 day',NULL),
('00000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000001','monkeyai-desktop','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000006',NULL,'modern-child','child-refresh',now()+interval '1 hour',now()+interval '1 day',now()-interval '30 minutes'),
('00000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000001','monkeyai-runtime','00000000-0000-0000-0000-000000000005',NULL,NULL,'runtime-access','runtime-refresh',now()+interval '1 hour',now()+interval '1 day',NULL);
INSERT INTO endpoints(user_id,machine_id,device_name,platform,os_version,arch,client_version,protocol_version,execution_public_key,key_id,deployment_mode,remote_access_state,active_grant_id,registration_version,grant_version,lease_epoch)
VALUES('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000010','独立设备','linux','test','amd64','test',1,decode(repeat('ab',32),'hex'),'device-key','standalone','enabled','00000000-0000-0000-0000-000000000005',3,4,5);
INSERT INTO sessions(owner_user_id,title,session_type,client_type,client_name,device_id,started_at,last_active_at,host_verified,host_revision,last_live_report_at,live_boot_id,live_lease_epoch)
VALUES('00000000-0000-0000-0000-000000000001','保留标题','conversation','desktop','设备','00000000-0000-0000-0000-000000000010',now(),now(),true,3,now(),'00000000-0000-0000-0000-000000000011',5);
INSERT INTO device_client_connections(user_id,machine_id,client_grant_id,grant_version,scopes,protocol,ticket_hash,expires_at)
VALUES('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000004',4,'{session:read}','{}','ticket-hash',now()+interval '1 hour');
INSERT INTO oauth_device_requests(id,client_id,device_code_hash,user_code_hash,machine_id,execution_public_key,key_id,display_name,platform,arch,requested_scopes,expires_at)
VALUES('00000000-0000-0000-0000-000000000012','monkeyai-runtime','device-hash','user-hash','00000000-0000-0000-0000-000000000010',decode(repeat('ab',32),'hex'),'device-key','独立设备','linux','amd64','{device:bind}',now()+interval '10 minutes');
INSERT INTO oauth_login_states(state_hash,connection_id,purpose,device_request_id,expires_at)
VALUES('device-state','test','device','00000000-0000-0000-0000-000000000012',now()+interval '10 minutes');
INSERT INTO api_keys(id,user_id,name,key_prefix,key_hash,scopes,expires_at,machine_id,runtime_grant_id,revoked_at) VALUES
('00000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000001','执行密钥','test','runtime-key','{model:invoke}',now()+interval '1 day','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000005',NULL),
('00000000-0000-0000-0000-000000000014','00000000-0000-0000-0000-000000000001','已撤销执行密钥','test','revoked-key','{model:invoke}',now()+interval '1 day','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000005',now()-interval '1 hour'),
('00000000-0000-0000-0000-000000000015','00000000-0000-0000-0000-000000000001','普通密钥','test','desktop-key','{model:invoke}',now()+interval '1 day',NULL,NULL,NULL);`)
	before := snapshot()
	for _, path := range runtimeUp {
		apply(path)
	}
	unchanged(before)
	for _, check := range []struct{ sql, code string }{
		{`UPDATE endpoints SET key_id=NULL`, "23514"},
		{`UPDATE oauth_grants SET requested_key_id=NULL WHERE purpose='runtime'`, "23514"},
		{`UPDATE api_keys SET runtime_grant_id=NULL WHERE machine_id IS NOT NULL`, "23514"},
		{`UPDATE oauth_login_states SET device_request_id=NULL WHERE purpose='device'`, "23514"},
		{`UPDATE oauth_tokens SET grant_id='00000000-0000-0000-0000-000000000099' WHERE id='00000000-0000-0000-0000-000000000006'`, "23503"},
	} {
		_, err := conn.Exec(t.Context(), check.sql)
		pg, ok := errors.AsType[*pgconn.PgError](err)
		if !ok || pg.Code != check.code {
			t.Fatalf("重复升级后约束未生效: %v", err)
		}
	}
	exec(`INSERT INTO oauth_tokens(user_id,client_id,access_token_hash,refresh_token_hash,access_expires_at,refresh_expires_at)
VALUES('00000000-0000-0000-0000-000000000001','monkeyai-desktop','trigger-access','trigger-refresh',now()+interval '1 hour',now()+interval '1 day');`)
	var compatible bool
	if err := conn.QueryRow(t.Context(), `SELECT g.id<>t.id AND cardinality(g.scopes)=0 FROM oauth_tokens t JOIN oauth_grants g ON g.id=t.grant_id WHERE t.access_token_hash='trigger-access'`).Scan(&compatible); err != nil || !compatible {
		t.Fatalf("重复升级后旧写入触发器失效或扩权: %v", err)
	}
	const knownRevocationsSQL = `SELECT jsonb_build_array(
(SELECT revoked_at FROM oauth_tokens WHERE id='00000000-0000-0000-0000-000000000003'),
(SELECT revoked_at FROM oauth_tokens WHERE id='00000000-0000-0000-0000-000000000007'),
(SELECT revoked_at FROM api_keys WHERE id='00000000-0000-0000-0000-000000000014'))::text`
	var knownRevocations string
	if err := conn.QueryRow(t.Context(), knownRevocationsSQL).Scan(&knownRevocations); err != nil {
		t.Fatal(err)
	}
	down := slices.Clone(runtimeUp)
	slices.Reverse(down)
	for i, path := range down {
		down[i] = strings.Replace(path, ".up.sql", ".down.sql", 1)
		apply(down[i])
		before := snapshot()
		apply(down[i])
		unchanged(before)
	}
	before = snapshot()
	for _, path := range down {
		apply(path)
	}
	unchanged(before)
	assertRevocations := func() {
		t.Helper()
		var valid bool
		err := conn.QueryRow(t.Context(), `SELECT
(SELECT count(*)=3 FROM oauth_tokens WHERE id IN ('00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000008') AND revoked_at IS NOT NULL)
AND (SELECT revoked_at IS NULL FROM oauth_tokens WHERE id='00000000-0000-0000-0000-000000000002')
AND (SELECT revoked_at IS NOT NULL FROM oauth_tokens WHERE id='00000000-0000-0000-0000-000000000003')
AND (SELECT count(*)=2 FROM api_keys WHERE id IN ('00000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000014') AND revoked_at IS NOT NULL)
AND (SELECT revoked_at IS NULL FROM api_keys WHERE id='00000000-0000-0000-0000-000000000015')`).Scan(&valid)
		if err != nil || !valid {
			t.Fatalf("回滚或重新升级改变了撤销/兼容状态: %v", err)
		}
		var known string
		if err := conn.QueryRow(t.Context(), knownRevocationsSQL).Scan(&known); err != nil || known != knownRevocations {
			t.Fatalf("已有撤销时间被改写: %v", err)
		}
	}
	assertRevocations()
	for _, path := range runtimeUp {
		apply(path)
	}
	assertRevocations()
}
