package identity

import (
	"encoding/json"
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
		{"baizhiyun", nil, "auth_certification openid phone user"},
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
	pool := emailDatabase(t)
	s := NewService(pool, authenticationStub{json.RawMessage(`{"registration_enabled":true}`)}, "", "")
	profile := upstreamProfile{Provider: "baizhiyun", Issuer: "https://identity.example", Subject: "1001", Name: "百智云用户"}
	first, err := s.upsertIdentity(t.Context(), profile, false)
	if err != nil {
		t.Fatal(err)
	}
	again, err := s.upsertIdentity(t.Context(), profile, false)
	if err != nil || first.ID != again.ID {
		t.Fatalf("重复登录未复用身份: %+v %v", again, err)
	}
	var provider, subject string
	if err := pool.QueryRow(t.Context(), `SELECT provider,provider_subject FROM user_identities WHERE user_id=$1`, first.ID).Scan(&provider, &subject); err != nil || provider != "baizhiyun" || subject != "1001" {
		t.Fatalf("百智云身份未持久化: %s %s %v", provider, subject, err)
	}
}
