package identity

import (
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

func TestResetAdminPassword(t *testing.T) {
	pool := emailDatabase(t)
	for _, tc := range []struct {
		name    string
		role    string
		status  string
		deleted bool
		wantErr bool
	}{
		{name: "admin", role: "admin", status: "active"},
		{name: "disabled", role: "admin", status: "disabled"},
		{name: "regular", role: "user", status: "active", wantErr: true},
		{name: "deleted", role: "admin", status: "active", deleted: true, wantErr: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			email := tc.name + "@example.com"
			var id string
			if err := pool.QueryRow(t.Context(), `INSERT INTO users(name,email,role,status,password_hash,deleted_at)
				VALUES('重置测试',$1,$2,$3,'original-hash',CASE WHEN $4 THEN now() END) RETURNING id`,
				email, tc.role, tc.status, tc.deleted).Scan(&id); err != nil {
				t.Fatal(err)
			}
			password, err := ResetAdminPassword(t.Context(), pool, " "+strings.ToUpper(email)+" ")
			if tc.wantErr {
				if !errors.Is(err, pgx.ErrNoRows) || password != "" {
					t.Fatalf("不应重置该账号: password=%t err=%v", password != "", err)
				}
			} else if err != nil {
				t.Fatal(err)
			}
			var hash, role, status string
			if err := pool.QueryRow(t.Context(), `SELECT password_hash,role,status FROM users WHERE id=$1`, id).Scan(&hash, &role, &status); err != nil {
				t.Fatal(err)
			}
			if role != tc.role || status != tc.status {
				t.Fatal("重置改变了账号角色或启停状态")
			}
			if tc.wantErr {
				if hash != "original-hash" {
					t.Fatal("重置失败仍修改了密码")
				}
			} else if len(password) != 16 || !verifyPassword(password, hash) {
				t.Fatal("新密码无法通过现有密码校验")
			}
		})
	}
	if password, err := ResetAdminPassword(t.Context(), pool, "missing@example.com"); !errors.Is(err, pgx.ErrNoRows) || password != "" {
		t.Fatalf("不存在的管理员重置结果: %v", err)
	}
}

func TestResetAdminPasswordRevokesAccess(t *testing.T) {
	pool := emailDatabase(t)
	ctx := t.Context()
	var id string
	if err := pool.QueryRow(ctx, `INSERT INTO users(name,email,role) VALUES('管理员','admin@baizhi.cloud','admin') RETURNING id`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	for _, query := range []string{
		`INSERT INTO browser_sessions(token_hash,user_id,authentication_method,expires_at) VALUES('session',$1,'password',now()+interval '1 hour')`,
		`WITH g AS (INSERT INTO oauth_grants(user_id,client_id,expires_at) VALUES($1,'monkeyai-desktop',now()+interval '1 day') RETURNING id)
		 INSERT INTO oauth_tokens(user_id,client_id,access_token_hash,refresh_token_hash,access_expires_at,refresh_expires_at,grant_id)
		 SELECT $1,'monkeyai-desktop','access','refresh',now()+interval '1 hour',now()+interval '1 day',id FROM g`,
		`WITH r AS (INSERT INTO oauth_authorization_requests(client_id,redirect_uri,state,code_challenge,code_challenge_method,expires_at)
		 VALUES('monkeyai-desktop','http://localhost','state','challenge','S256',now()+interval '1 hour') RETURNING id)
		 INSERT INTO oauth_authorization_codes(code_hash,authorization_request_id,user_id,client_id,redirect_uri,code_challenge,expires_at)
		 SELECT 'code',id,$1,'monkeyai-desktop','http://localhost','challenge',now()+interval '1 hour' FROM r`,
	} {
		if _, err := pool.Exec(ctx, query, id); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := pool.Exec(ctx, `INSERT INTO email_codes(email,purpose,code_hash,expires_at) VALUES
		('admin@baizhi.cloud','login','login-code',now()+interval '1 hour'),
		('admin@baizhi.cloud','reset','reset-code',now()+interval '1 hour'),
		('other@example.com','reset','other-code',now()+interval '1 hour')`); err != nil {
		t.Fatal(err)
	}
	if _, err := ResetAdminPassword(ctx, pool, "admin@baizhi.cloud"); err != nil {
		t.Fatal(err)
	}
	for _, query := range []string{
		`SELECT count(*) FROM browser_sessions WHERE user_id=$1 AND revoked_at IS NULL`,
		`SELECT count(*) FROM oauth_grants WHERE user_id=$1 AND revoked_at IS NULL`,
		`SELECT count(*) FROM oauth_tokens WHERE user_id=$1 AND revoked_at IS NULL`,
		`SELECT count(*) FROM oauth_authorization_codes WHERE user_id=$1 AND redeemed_at IS NULL`,
		`SELECT count(*) FROM email_codes WHERE email=(SELECT email FROM users WHERE id=$1)`,
	} {
		var count int
		if err := pool.QueryRow(ctx, query, id).Scan(&count); err != nil || count != 0 {
			t.Fatalf("旧凭据仍有效: count=%d err=%v", count, err)
		}
	}
	var remaining int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM email_codes WHERE email='other@example.com'`).Scan(&remaining); err != nil || remaining != 1 {
		t.Fatalf("影响了其他账号: count=%d err=%v", remaining, err)
	}
}

func TestResetAdminPasswordRollback(t *testing.T) {
	pool := emailDatabase(t)
	ctx := t.Context()
	if _, err := pool.Exec(ctx, `
		INSERT INTO users(name,email,role,password_hash) VALUES('管理员','admin@baizhi.cloud','admin','original-hash');
		INSERT INTO browser_sessions(token_hash,user_id,authentication_method,expires_at)
		 SELECT 'session',id,'password',now()+interval '1 hour' FROM users;
		CREATE FUNCTION reject_session_revocation() RETURNS trigger LANGUAGE plpgsql AS $$
		 BEGIN RAISE EXCEPTION 'test revocation failure'; END $$;
		CREATE TRIGGER reject_session_revocation BEFORE UPDATE ON browser_sessions
		 FOR EACH ROW EXECUTE FUNCTION reject_session_revocation();
	`); err != nil {
		t.Fatal(err)
	}
	password, err := ResetAdminPassword(ctx, pool, "admin@baizhi.cloud")
	if err == nil || password != "" {
		t.Fatal("凭据撤销失败后不应提交或返回密码")
	}
	var hash string
	if err := pool.QueryRow(ctx, `SELECT password_hash FROM users WHERE email='admin@baizhi.cloud'`).Scan(&hash); err != nil || hash != "original-hash" {
		t.Fatalf("事务未回滚密码: err=%v", err)
	}
}
