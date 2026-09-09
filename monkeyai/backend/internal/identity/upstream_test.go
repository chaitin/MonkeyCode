package identity

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestBaizhiyunOIDC(t *testing.T) {
	var issuer string
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
			writeJSON(w, 200, map[string]string{"sub": "1001", "name": "百智云用户", "phone_number": "13800000000"})
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
	connection.Provider = "baizhiyun"
	profile, err := s.exchangeUpstream(t.Context(), connection, "code")
	if err != nil || profile.Provider != "baizhiyun" || profile.Subject != "1001" || profile.Issuer != issuer {
		t.Fatalf("百智云身份解析错误: %+v %v", profile, err)
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
