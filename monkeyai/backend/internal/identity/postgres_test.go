package identity

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type authenticationStub struct {
	value json.RawMessage
}

func (s authenticationStub) GetValue(context.Context, string) (json.RawMessage, error) {
	return s.value, nil
}

func TestOAuthUserRegistration(t *testing.T) {
	dsn := os.Getenv("MONKEYAI_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("设置 MONKEYAI_TEST_DATABASE_URL 运行 OAuth 用户注册集成测试")
	}
	ctx := t.Context()
	root, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(root.Close)
	suffix, err := randomToken(12)
	if err != nil {
		t.Fatal(err)
	}
	schema := pgx.Identifier{"test_identity_" + suffix}.Sanitize()
	if _, err := root.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := root.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE"); err != nil {
			t.Error(err)
		}
	})
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	migration, err := os.ReadFile(filepath.Join("..", "..", "migrations", "000001_initial_create_schema.up.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, string(migration)); err != nil {
		t.Fatal(err)
	}

	for _, test := range []struct {
		name     string
		settings string
		want     error
	}{
		{name: "enabled", settings: `{"registration_enabled":true}`},
		{name: "disabled", settings: `{"registration_enabled":false}`, want: ErrRegistrationDisabled},
		{name: "unset", settings: `{}`, want: ErrRegistrationDisabled},
	} {
		t.Run(test.name, func(t *testing.T) {
			service := NewService(pool, authenticationStub{value: json.RawMessage(test.settings)}, "http://localhost", "http://localhost")
			profile := upstreamProfile{Provider: "oidc", Issuer: "https://issuer.example.com", Subject: test.name, Email: test.name + "@example.com", Name: test.name}
			user, err := service.upsertIdentity(ctx, profile, false)
			if !errors.Is(err, test.want) {
				t.Fatalf("注册结果 = %v, want %v", err, test.want)
			}
			var users, identities int
			if err := pool.QueryRow(ctx, `SELECT count(*) FROM users WHERE email = $1`, profile.Email).Scan(&users); err != nil {
				t.Fatal(err)
			}
			if err := pool.QueryRow(ctx, `SELECT count(*) FROM user_identities WHERE provider_subject = $1`, profile.Subject).Scan(&identities); err != nil {
				t.Fatal(err)
			}
			if test.want != nil {
				if users != 0 || identities != 0 {
					t.Fatalf("拒绝注册后留下用户或身份: users=%d identities=%d", users, identities)
				}
				return
			}
			if users != 1 || identities != 1 || user.Role != "user" || user.Status != "active" {
				t.Fatalf("自动创建用户或绑定身份失败: users=%d identities=%d role=%s status=%s", users, identities, user.Role, user.Status)
			}
			service.settings = authenticationStub{value: json.RawMessage(`{"registration_enabled":false}`)}
			again, err := service.upsertIdentity(ctx, profile, false)
			if err != nil || again.ID != user.ID {
				t.Fatalf("关闭注册后已有用户重复登录失败: err=%v id=%s", err, again.ID)
			}
		})
	}
}
