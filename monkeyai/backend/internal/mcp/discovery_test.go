package mcp

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestDiscoverOAuth(t *testing.T) {
	t.Setenv("MONKEYAI_MCP_ALLOWED_CIDRS", "127.0.0.0/8")
	for _, scenario := range []string{"challenge", "resource-path", "resource-root", "legacy", "oidc", "basic", "post", "bad-issuer", "bad-resource", "bad-endpoint", "no-registration", "no-pkce", "unsupported-auth", "malformed", "oversized", "redirect"} {
		t.Run(scenario, func(t *testing.T) {
			var origin string
			remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" {
					t.Error("发现请求不应包含凭证")
				}
				if r.URL.Path == "/mcp" {
					if scenario == "challenge" {
						w.Header().Set("WWW-Authenticate", `Bearer realm="mcp", resource_metadata="`+origin+`/metadata"`)
					}
					w.WriteHeader(401)
					return
				}
				prmPath := "/.well-known/oauth-protected-resource/mcp"
				if scenario == "challenge" {
					prmPath = "/metadata"
				} else if scenario == "resource-root" {
					prmPath = "/.well-known/oauth-protected-resource"
				}
				if r.URL.Path == prmPath && scenario != "legacy" {
					res := origin + "/mcp"
					if scenario == "bad-resource" {
						res += "/other"
					}
					resource.JSON(w, 200, resource.Object{"resource": res, "authorization_servers": []string{origin + "/tenant"}, "scopes_supported": []string{"read", "offline_access"}})
					return
				}
				metadataPath, issuer := "/.well-known/oauth-authorization-server/tenant", origin+"/tenant"
				if scenario == "legacy" {
					metadataPath, issuer = "/.well-known/oauth-authorization-server", origin
				} else if scenario == "oidc" {
					metadataPath = "/tenant/.well-known/openid-configuration"
				}
				if r.URL.Path != metadataPath {
					http.NotFound(w, r)
					return
				}
				metadata := resource.Object{"issuer": issuer, "authorization_endpoint": origin + "/authorize", "token_endpoint": origin + "/token", "registration_endpoint": origin + "/register", "token_endpoint_auth_methods_supported": []string{"client_secret_basic", "none"}, "code_challenge_methods_supported": []string{"S256"}}
				switch scenario {
				case "basic":
					delete(metadata, "token_endpoint_auth_methods_supported")
				case "post":
					metadata["token_endpoint_auth_methods_supported"] = []string{"client_secret_post"}
				case "bad-issuer":
					metadata["issuer"] = origin + "/other"
				case "bad-endpoint":
					metadata["token_endpoint"] = "file:///secret"
				case "no-registration":
					delete(metadata, "registration_endpoint")
				case "no-pkce":
					metadata["code_challenge_methods_supported"] = []string{"plain"}
				case "unsupported-auth":
					metadata["token_endpoint_auth_methods_supported"] = []string{"private_key_jwt"}
				case "malformed":
					fmt.Fprint(w, "invalid-json")
					return
				case "oversized":
					fmt.Fprint(w, strings.Repeat("x", (1<<20)+1))
					return
				case "redirect":
					http.Redirect(w, r, origin+"/redirected", http.StatusFound)
					return
				}
				resource.JSON(w, 200, metadata)
			}))
			defer remote.Close()
			origin = remote.URL
			o, err := discoverOAuth(t.Context(), origin+"/mcp")
			valid := scenario == "challenge" || scenario == "resource-path" || scenario == "resource-root" || scenario == "legacy" || scenario == "oidc" || scenario == "basic" || scenario == "post"
			if !valid {
				if err == nil {
					t.Fatal("接受了无效元数据")
				}
				return
			}
			method := "none"
			if scenario == "basic" {
				method = "client_secret_basic"
			} else if scenario == "post" {
				method = "client_secret_post"
			}
			if err != nil || o.Mode != "dynamic" || o.Resource != origin+"/mcp" || o.AuthorizationURL != origin+"/authorize" || o.TokenURL != origin+"/token" || o.RegistrationURL != origin+"/register" || o.TokenAuthMethod != method || (scenario != "legacy" && o.Scopes != "read offline_access") {
				t.Fatalf("自动发现结果错误: %+v %v", o, err)
			}
		})
	}
}

func TestOAuthDiscoverySafety(t *testing.T) {
	t.Setenv("MONKEYAI_MCP_ALLOWED_CIDRS", "")
	var calls atomic.Int32
	blocked := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1) }))
	defer blocked.Close()
	if _, err := discoverOAuth(t.Context(), blocked.URL); err == nil || calls.Load() != 0 {
		t.Fatal("发现请求绕过私网限制")
	}
	if discoveryURL("http://auth.example.com/metadata", "https://mcp.example.com") || discoveryURL("https://user:pass@auth.example.com", "https://mcp.example.com") {
		t.Fatal("接受 HTTPS 降级或包含凭证的地址")
	}
	// 初始 MCP 地址允许访问，不代表它引用的元数据地址也允许。
	t.Setenv("MONKEYAI_MCP_ALLOWED_CIDRS", "127.0.0.1/32")
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("WWW-Authenticate", `Bearer resource_metadata="http://127.0.0.2/metadata"`)
		w.WriteHeader(401)
	}))
	defer remote.Close()
	if _, err := discoverOAuth(t.Context(), remote.URL); err == nil {
		t.Fatal("间接元数据请求绕过私网限制")
	}
}

func TestDynamicOAuthConfigValidation(t *testing.T) {
	in := resource.Object{"url": "https://mcp.example.com/mcp", "authorization_mode": "independent", "authorization_method": "oauth", "oauth_config": oauthConfig{Mode: "dynamic", ClientID: "untrusted", Resource: "https://other.example.com"}, "oauth_client_secret": "untrusted"}
	if err := (&Service{}).validateConnector(t.Context(), nil, in, resource.Object{}); err != nil {
		t.Fatal("动态模式只需 MCP 地址", err)
	}
	if o := oauthSettings(in); o != (oauthConfig{Mode: "dynamic"}) || in.String("oauth_client_secret") != "" {
		t.Fatal("动态模式接受了手动配置字段", o)
	}
	in["oauth_config"] = oauthConfig{Mode: "invalid"}
	if err := (&Service{}).validateConnector(t.Context(), nil, in, resource.Object{}); err == nil {
		t.Fatal("接受了无效配置模式")
	}
}

func TestDynamicOAuthLifecycle(t *testing.T) {
	f := setup(t)
	var registrations, discoveries atomic.Int32
	var origin string
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/mcp":
			w.WriteHeader(401)
		case "/.well-known/oauth-protected-resource/mcp":
			discoveries.Add(1)
			resource.JSON(w, 200, resource.Object{"resource": origin + "/mcp", "authorization_servers": []string{origin}, "scopes_supported": []string{"read"}})
		case "/.well-known/oauth-authorization-server":
			resource.JSON(w, 200, resource.Object{"issuer": origin, "authorization_endpoint": origin + "/authorize", "token_endpoint": origin + "/token", "registration_endpoint": origin + "/register"})
		case "/register":
			registrations.Add(1)
			var body resource.Object
			_ = json.NewDecoder(r.Body).Decode(&body)
			resource.JSON(w, 201, resource.Object{"client_id": "dynamic", "client_secret": "registered-secret", "redirect_uris": body["redirect_uris"]})
		case "/token":
			_ = r.ParseForm()
			user, secret, ok := r.BasicAuth()
			if r.Form.Get("resource") != origin+"/mcp" || r.Form.Get("code_verifier") == "" || !ok || user != "dynamic" || secret != "registered-secret" {
				t.Error("Token 请求缺少资源标识、PKCE 或注册后的客户端凭证")
			}
			resource.JSON(w, 200, resource.Object{"access_token": "access"})
		default:
			http.NotFound(w, r)
		}
	}))
	defer remote.Close()
	origin = remote.URL
	c := f.call("POST", "/agent/connectors", resource.Object{"name": "自动发现", "url": origin + "/mcp", "authorization_mode": "independent", "authorization_method": "oauth", "oauth_config": resource.Object{"mode": "dynamic"}}, "owner", "", 201)
	path := "/agent/connectors/" + c.String("id")
	var authURL *url.URL
	for range 2 {
		auth := f.call("POST", path+"/oauth/authorizations", resource.Object{"name": "凭证"}, "owner", "", 200)
		u, _ := url.Parse(auth.String("authorization_url"))
		authURL = u
		if u.Query().Get("client_id") != "dynamic" || u.Query().Get("resource") != origin+"/mcp" || u.Query().Get("scope") != "read" || u.Query().Get("code_challenge_method") != "S256" {
			t.Fatal("授权请求缺少自动发现参数")
		}
	}
	if registrations.Load() != 1 || discoveries.Load() != 1 {
		t.Fatal("授权未复用已发现并注册的客户端")
	}
	c = f.call("GET", path, nil, "owner", "", 200)
	updated := f.call("PUT", path, resource.Object{"name": "重命名", "oauth_config": resource.Object{"mode": "dynamic", "client_id": "forged"}, "oauth_client_secret": "forged"}, "owner", etag(c), 200)
	if !reflect.DeepEqual(oauthSettings(c), oauthSettings(updated)) || c.Int("config_revision") != updated.Int("config_revision") {
		t.Fatal("普通编辑清除了动态客户端或改变配置版本")
	}
	var secret string
	if err := f.pool.QueryRow(t.Context(), `SELECT oauth_client_secret FROM connectors WHERE id=$1`, c.String("id")).Scan(&secret); err != nil || secret != "registered-secret" {
		t.Fatal("动态客户端密钥被修改", err)
	}
	f.call("GET", "/oauth/connectors/"+c.String("id")+"/callback?state="+authURL.Query().Get("state")+"&code=code", nil, "", "", 200)
	updated = f.call("PUT", path, resource.Object{"name": "重命名", "url": origin + "/new-mcp", "oauth_config": resource.Object{"mode": "dynamic"}}, "owner", etag(updated), 200)
	if oauthSettings(updated) != (oauthConfig{Mode: "dynamic"}) || updated.Int("config_revision") != c.Int("config_revision")+1 {
		t.Fatal("更换 MCP 地址未清除发现结果")
	}
	updated = f.call("PUT", path, resource.Object{"name": "重命名", "oauth_config": oauthConfig{Mode: "manual", ClientID: "manual", AuthorizationURL: origin + "/authorize", TokenURL: origin + "/token"}, "oauth_client_secret": "manual-secret"}, "owner", etag(updated), 200)
	if o := oauthSettings(updated); o.Mode != "manual" || o.ClientID != "manual" || o.Resource != "" || o.RegistrationURL != "" {
		t.Fatal("切换传统配置后仍携带动态发现结果")
	}
}
