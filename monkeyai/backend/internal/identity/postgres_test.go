package identity

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity/sqlc"
	"github.com/jackc/pgx/v5"
)

type authenticationStub struct {
	value json.RawMessage
}

func (s authenticationStub) GetValue(context.Context, string) (json.RawMessage, error) {
	return s.value, nil
}

func TestOAuthUserRegistration(t *testing.T) {
	pool := emailDatabase(t)
	ctx := t.Context()

	for _, test := range []struct {
		name                    string
		autoRegistrationEnabled bool
		want                    error
	}{
		{name: "enabled", autoRegistrationEnabled: true},
		{name: "disabled", want: ErrRegistrationDisabled},
	} {
		t.Run(test.name, func(t *testing.T) {
			service := newTestService(pool, nil, "http://localhost")
			profile := upstreamProfile{Provider: "oidc", Issuer: "https://issuer.example.com", Subject: test.name, Email: test.name + "@example.com", Name: test.name}
			user, err := service.upsertIdentity(ctx, profile, false, test.autoRegistrationEnabled)
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
			again, err := service.upsertIdentity(ctx, profile, false, false)
			if err != nil || again.ID != user.ID {
				t.Fatalf("关闭注册后已有用户重复登录失败: err=%v id=%s", err, again.ID)
			}
		})
	}
}

func TestOAuthAdminClientLogin(t *testing.T) {
	pool := emailDatabase(t)
	for _, bound := range []bool{false, true} {
		name := "email_binding"
		if bound {
			name = "promoted_identity"
		}
		t.Run(name, func(t *testing.T) {
			s := newTestService(pool, nil, "http://localhost")
			profile := upstreamProfile{Provider: "oidc", Issuer: "https://issuer.example.com", Subject: name, Email: name + "@example.com", Name: name}
			var user User
			var err error
			if bound {
				user, err = s.upsertIdentity(t.Context(), profile, false, true)
			} else {
				user, err = s.insertUser(t.Context(), name, profile.Email, "user", "")
			}
			if err != nil {
				t.Fatal(err)
			}
			if _, err := s.updateUser(t.Context(), user.ID, user.Name, "admin", "active", ""); err != nil {
				t.Fatal(err)
			}
			for _, adminOnly := range []bool{false, true} {
				loggedIn, err := s.upsertIdentity(t.Context(), profile, adminOnly, false)
				if err != nil || loggedIn.ID != user.ID || loggedIn.Role != "admin" {
					t.Fatalf("管理员 OAuth 登录失败: adminOnly=%t user=%+v err=%v", adminOnly, loggedIn, err)
				}
			}
			var identities int
			if err := pool.QueryRow(t.Context(), "SELECT count(*) FROM user_identities WHERE user_id = $1", user.ID).Scan(&identities); err != nil || identities != 1 {
				t.Fatalf("第三方身份未正确复用: count=%d err=%v", identities, err)
			}
			if _, err := s.updateUser(t.Context(), user.ID, user.Name, "admin", "disabled", ""); err != nil {
				t.Fatal(err)
			}
			if _, err := s.upsertIdentity(t.Context(), profile, false, false); !errors.Is(err, ErrUserDisabled) {
				t.Fatalf("停用管理员登录结果=%v", err)
			}
		})
	}
}

func TestOAuthRegistrationConflictWithAdmin(t *testing.T) {
	pool := emailDatabase(t)
	s := newTestService(pool, nil, "")
	user, err := s.insertUser(t.Context(), "管理员", "admin@example.com", "admin", "")
	if err != nil {
		t.Fatal(err)
	}
	params := sqlc.CreateIdentityUserParams{Name: "OAuth 管理员", Email: user.Email}
	row, err := sqlc.New(pool).CreateIdentityUser(t.Context(), params)
	if err != nil || row.ID != user.ID || row.Role != "admin" {
		t.Fatalf("OAuth 注册邮箱冲突未保留管理员身份: user=%+v err=%v", row, err)
	}
	if _, err := s.updateUser(t.Context(), user.ID, user.Name, "admin", "disabled", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := sqlc.New(pool).CreateIdentityUser(t.Context(), params); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("OAuth 注册冲突不应更新停用管理员: %v", err)
	}
}
