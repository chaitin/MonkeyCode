package identity

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestBaizhiyunOIDC(t *testing.T) {
	var issuer string
	var userinfo string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/.well-known/openid-configuration":
			writeJSON(w, 200, providerMetadata{issuer + "/authorize", issuer + "/token", issuer + "/userinfo"})
		case "/token":
			if r.Method != "POST" || r.FormValue("client_id") != "client" || r.FormValue("client_secret") != "secret" || r.FormValue("code") != "code" {
				t.Error("交换令牌参数无效")
			}
			writeJSON(w, 200, map[string]string{"access_token": "upstream-token"})
		case "/userinfo":
			if r.Header.Get("Authorization") != "Bearer upstream-token" {
				t.Error("缺少上游令牌")
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(userinfo))
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()
	issuer = upstream.URL
	s := NewService(nil, nil, "https://monkeyai.example", "")
	connection := OAuthConnection{Provider: "baizhiyun", IssuerURL: issuer, ClientID: "client", ClientSecret: "secret"}
	for _, tc := range []struct {
		provider string
		scopes   []string
		want     string
	}{
		{"baizhiyun", nil, "auth_certification openid phone user email"},
		{"baizhiyun", []string{"openid", "user"}, "openid user"},
		{"oidc", nil, "openid profile email"},
	} {
		connection.Provider, connection.Scopes = tc.provider, tc.scopes
		target, err := s.upstreamAuthorizeURL(t.Context(), connection, "state")
		if err != nil {
			t.Fatal(err)
		}
		parsed, err := url.Parse(target)
		if err != nil {
			t.Fatal(err)
		}
		if parsed.Path != "/authorize" || parsed.Query().Get("scope") != tc.want || parsed.Query().Get("state") != "state" {
			t.Fatalf("授权地址无效: %s", target)
		}
	}
	for _, tc := range []struct {
		name     string
		provider string
		body     string
		want     upstreamProfile
		wantErr  string
	}{
		{
			name:     "baizhiyun",
			provider: "baizhiyun",
			body:     `{"code":0,"message":"success","data":{"id":"1001","name":"百智云用户","avatar":"https://example.com/avatar.png","phone_number":"13800000000","is_certified":false,"user_type":"personal"}}`,
			want:     upstreamProfile{Provider: "baizhiyun", Issuer: issuer, Subject: "1001", Name: "百智云用户", AvatarURL: "https://example.com/avatar.png"},
		},
		{
			name:     "baizhiyun_email",
			provider: "baizhiyun",
			body:     `{"code":0,"data":{"id":"1001","name":"百智云用户","email":" User@Example.com "}}`,
			want:     upstreamProfile{Provider: "baizhiyun", Issuer: issuer, Subject: "1001", Name: "百智云用户", Email: "user@example.com"},
		},
		{
			name:     "baizhiyun_empty_email",
			provider: "baizhiyun",
			body:     `{"code":0,"data":{"id":"1001","email":" "}}`,
			want:     upstreamProfile{Provider: "baizhiyun", Issuer: issuer, Subject: "1001"},
		},
		{
			name:     "baizhiyun_null_email",
			provider: "baizhiyun",
			body:     `{"code":0,"data":{"id":"1001","email":null}}`,
			want:     upstreamProfile{Provider: "baizhiyun", Issuer: issuer, Subject: "1001"},
		},
		{
			name:     "oidc",
			provider: "oidc",
			body:     `{"sub":"1002","name":"OIDC 用户","preferred_username":"user","email":"user@example.com","picture":"https://example.com/oidc.png"}`,
			want:     upstreamProfile{Provider: "oidc", Issuer: issuer, Subject: "1002", Username: "user", Name: "OIDC 用户", Email: "user@example.com", AvatarURL: "https://example.com/oidc.png"},
		},
		{
			name:     "business_error",
			provider: "baizhiyun",
			body:     `{"code":1001,"message":"denied","data":{"id":"1001"}}`,
			wantErr:  "读取百智云用户: code 1001",
		},
		{
			name:     "missing_code",
			provider: "baizhiyun",
			body:     `{"data":{"id":"1001"}}`,
			wantErr:  "百智云用户响应缺少 code",
		},
		{
			name:     "missing_data",
			provider: "baizhiyun",
			body:     `{"code":0,"data":null,"id":"1001"}`,
			wantErr:  "上游用户缺少 subject",
		},
		{
			name:     "missing_id",
			provider: "baizhiyun",
			body:     `{"code":0,"data":{"sub":"1001","phone_number":"13800000000"}}`,
			wantErr:  "上游用户缺少 subject",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			connection.Provider, userinfo = tc.provider, tc.body
			profile, err := s.exchangeUpstream(t.Context(), connection, "code")
			if tc.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tc.wantErr) || profile != (upstreamProfile{}) {
					t.Fatalf("无效用户信息未被拒绝: profile=%+v err=%v", profile, err)
				}
				return
			}
			if err != nil || profile != tc.want {
				t.Fatalf("上游身份解析错误: profile=%+v want=%+v err=%v", profile, tc.want, err)
			}
		})
	}
}

func TestBaizhiyunIdentityRegistration(t *testing.T) {
	for _, email := range []string{"", "user@example.com"} {
		t.Run(email, func(t *testing.T) {
			pool := emailDatabase(t)
			s := NewService(pool, authenticationStub{json.RawMessage(`{"registration_enabled":true}`)}, "", "")
			profile := upstreamProfile{Provider: "baizhiyun", Issuer: "https://identity.example", Subject: "1001", Name: "百智云用户", Email: email}
			first, err := s.upsertIdentity(t.Context(), profile, false)
			if err != nil {
				t.Fatal(err)
			}
			wantEmail := email
			if wantEmail == "" {
				wantEmail = "1001@baizhiyun.oauth.local"
			}
			if first.Email != wantEmail {
				t.Fatalf("注册邮箱错误: got=%q want=%q", first.Email, wantEmail)
			}
			again, err := s.upsertIdentity(t.Context(), profile, false)
			if err != nil || first.ID != again.ID || again.Email != wantEmail {
				t.Fatalf("重复登录未复用身份: %+v %v", again, err)
			}
			var provider, subject, savedEmail string
			if err := pool.QueryRow(t.Context(), `SELECT provider,provider_subject,email FROM user_identities WHERE user_id=$1`, first.ID).Scan(&provider, &subject, &savedEmail); err != nil || provider != "baizhiyun" || subject != "1001" || savedEmail != wantEmail {
				t.Fatalf("百智云身份未持久化: %s %s %s %v", provider, subject, savedEmail, err)
			}
		})
	}
}

func TestBaizhiyunIdentityEmail(t *testing.T) {
	for _, tc := range []struct {
		name         string
		initialEmail string
		ownerStatus  string
		wantEmail    string
	}{
		{name: "backfill", wantEmail: "user@example.com"},
		{name: "existing_email", initialEmail: "original@example.com", wantEmail: "original@example.com"},
		{name: "email_conflict", ownerStatus: "active", wantEmail: "1001@baizhiyun.oauth.local"},
		{name: "disabled_owner", ownerStatus: "disabled", wantEmail: "1001@baizhiyun.oauth.local"},
		{name: "deleted_owner", ownerStatus: "deleted", wantEmail: "user@example.com"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			pool := emailDatabase(t)
			s := NewService(pool, authenticationStub{json.RawMessage(`{"registration_enabled":true}`)}, "", "")
			profile := upstreamProfile{Provider: "baizhiyun", Issuer: "https://identity.example", Subject: "1001", Name: "百智云用户", Email: tc.initialEmail}
			first, err := s.upsertIdentity(t.Context(), profile, false)
			if err != nil {
				t.Fatal(err)
			}
			profile.Email = "user@example.com"
			if tc.ownerStatus != "" {
				owner, err := s.insertUser(t.Context(), "邮箱所有者", profile.Email, "admin", "")
				if err != nil {
					t.Fatal(err)
				}
				switch tc.ownerStatus {
				case "disabled":
					_, err = s.updateUser(t.Context(), owner.ID, owner.Name, owner.Role, "disabled", "")
				case "deleted":
					_, err = pool.Exec(t.Context(), `UPDATE users SET deleted_at=now() WHERE id=$1`, owner.ID)
				}
				if err != nil {
					t.Fatal(err)
				}
			}
			s.settings = authenticationStub{json.RawMessage(`{"registration_enabled":false}`)}
			for range 2 {
				again, err := s.upsertIdentity(t.Context(), profile, false)
				if err != nil || again.ID != first.ID || again.Email != tc.wantEmail || again.Role != "user" {
					t.Fatalf("邮箱补齐改变了用户身份或邮箱错误: user=%+v err=%v", again, err)
				}
				var savedEmail string
				if err := pool.QueryRow(t.Context(), `SELECT email FROM user_identities WHERE user_id=$1`, first.ID).Scan(&savedEmail); err != nil || savedEmail != "user@example.com" {
					t.Fatalf("上游身份邮箱未保留: email=%q err=%v", savedEmail, err)
				}
				profile.Email = ""
			}
		})
	}
}

func TestBaizhiyunEmailBinding(t *testing.T) {
	pool := emailDatabase(t)
	s := NewService(pool, authenticationStub{json.RawMessage(`{"registration_enabled":false}`)}, "", "")
	for _, role := range []string{"user", "admin"} {
		t.Run(role, func(t *testing.T) {
			profile := upstreamProfile{Provider: "baizhiyun", Issuer: "https://identity.example", Subject: role, Name: "百智云用户", Email: role + "@example.com"}
			owner, err := s.insertUser(t.Context(), "已有用户", strings.ToUpper(profile.Email), role, "")
			if err != nil {
				t.Fatal(err)
			}
			if role == "user" {
				if _, err := s.upsertIdentity(t.Context(), profile, true); !errors.Is(err, ErrAdminRoleRequired) {
					t.Fatalf("普通用户不应通过管理后台登录: %v", err)
				}
			}
			again, err := s.upsertIdentity(t.Context(), profile, role == "admin")
			if err != nil || again.ID != owner.ID || again.Role != role || again.Email != owner.Email {
				t.Fatalf("未复用同邮箱账号: user=%+v err=%v", again, err)
			}
			if _, err := s.updateUser(t.Context(), owner.ID, owner.Name, role, "disabled", ""); err != nil {
				t.Fatal(err)
			}
			if _, err := s.upsertIdentity(t.Context(), profile, false); !errors.Is(err, ErrUserDisabled) {
				t.Fatalf("停用用户不应通过邮箱关联登录: %v", err)
			}
		})
	}
}
