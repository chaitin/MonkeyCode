package mcp

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestRegisterOAuthClient(t *testing.T) {
	t.Setenv("MONKEYAI_MCP_ALLOWED_CIDRS", "127.0.0.0/8")
	redirect := "https://app.example.com/oauth/connectors/test/callback"
	for _, tc := range []struct {
		name       string
		status     int
		body       string
		wantMethod string
	}{
		{"公共客户端", 201, `{"client_id":"dynamic","redirect_uris":["` + redirect + `"],"token_endpoint_auth_method":"none"}`, "none"},
		{"默认Basic认证", 201, `{"client_id":"dynamic","client_secret":"secret","redirect_uris":["` + redirect + `"]}`, "client_secret_basic"},
		{"Post认证", 201, `{"client_id":"dynamic","client_secret":"secret","redirect_uris":["` + redirect + `"],"token_endpoint_auth_method":"client_secret_post"}`, "client_secret_post"},
		{"注册被拒绝", 401, `{"error":"invalid_token","error_description":"private-secret"}`, ""},
		{"错误状态", 200, `{"client_id":"dynamic"}`, ""},
		{"非法JSON", 201, `not json`, ""},
		{"缺少ID", 201, `{"token_endpoint_auth_method":"none","redirect_uris":["` + redirect + `"]}`, ""},
		{"缺少Secret", 201, `{"client_id":"dynamic","redirect_uris":["` + redirect + `"]}`, ""},
		{"缺少回调", 201, `{"client_id":"dynamic","token_endpoint_auth_method":"none"}`, ""},
		{"回调不匹配", 201, `{"client_id":"dynamic","token_endpoint_auth_method":"none","redirect_uris":["https://other.example.com/callback"]}`, ""},
		{"不支持的认证方式", 201, `{"client_id":"dynamic","token_endpoint_auth_method":"private_key_jwt","redirect_uris":["` + redirect + `"]}`, ""},
		{"Secret已过期", 201, `{"client_id":"dynamic","client_secret":"secret","client_secret_expires_at":1,"redirect_uris":["` + redirect + `"]}`, ""},
		{"包含错误", 201, `{"client_id":"dynamic","error":"invalid_client_metadata"}`, ""},
		{"超大响应", 201, strings.Repeat("x", (1<<20)+1), ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var body struct {
					Name      string   `json:"client_name"`
					Redirects []string `json:"redirect_uris"`
					Grants    []string `json:"grant_types"`
					Responses []string `json:"response_types"`
					Method    string   `json:"token_endpoint_auth_method"`
					Scope     string   `json:"scope"`
				}
				if r.Method != "POST" || r.Header.Get("Content-Type") != "application/json" || json.NewDecoder(r.Body).Decode(&body) != nil || body.Name != "MonkeyAI" || len(body.Redirects) != 1 || body.Redirects[0] != redirect || strings.Join(body.Grants, ",") != "authorization_code,refresh_token" || strings.Join(body.Responses, ",") != "code" || body.Method != "none" || body.Scope != "read offline_access" {
					t.Error("动态注册请求参数错误")
				}
				w.WriteHeader(tc.status)
				_, _ = io.WriteString(w, tc.body)
			}))
			defer remote.Close()
			result, err := registerOAuthClient(t.Context(), oauthConfig{RegistrationURL: remote.URL, Scopes: "read offline_access"}, redirect)
			if tc.wantMethod == "" {
				if err == nil || result.ClientID != "" || result.Secret != "" || result.Method != "" || strings.Contains(err.Error(), "private-secret") {
					t.Fatalf("无效注册响应被接受或泄露响应: %q %q %v", result.ClientID, result.Method, err)
				}
			} else if err != nil || result.ClientID != "dynamic" || result.Method != tc.wantMethod || (result.Method != "none" && result.Secret != "secret") {
				t.Fatalf("注册失败: %q %q %v", result.ClientID, result.Method, err)
			}
		})
	}
}

func TestRegistrationConfigValidation(t *testing.T) {
	for _, tc := range []struct {
		name, id, endpoint, method string
		want                       bool
	}{
		{"手动配置", "manual", "", "", true},
		{"动态注册", "", "https://oauth.example.com/register", "", true},
		{"指定认证方式", "", "https://oauth.example.com/register", "client_secret_post", true},
		{"公共客户端", "manual", "", "none", true},
		{"缺少客户端配置", "", "", "", false},
		{"空白客户端", "  ", "", "", false},
		{"非法注册端点", "", "file:///register", "", false},
		{"注册端点含凭证", "", "https://user:pass@oauth.example.com/register", "", false},
		{"无效认证方式", "manual", "", "private_key_jwt", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			in := resource.Object{"url": "https://mcp.example.com", "authorization_mode": "independent", "authorization_method": "oauth", "oauth_client_secret": "secret", "oauth_config": oauthConfig{AuthorizationURL: "https://oauth.example.com/authorize", TokenURL: "https://oauth.example.com/token", ClientID: tc.id, RegistrationURL: tc.endpoint, TokenAuthMethod: tc.method, Scopes: " read   offline_access "}}
			err := (&Service{}).validateConnector(t.Context(), nil, in, resource.Object{})
			if (err == nil) != tc.want {
				t.Fatalf("配置校验结果错误: %v", err)
			}
			if tc.want {
				o := oauthSettings(in)
				if o.RegistrationURL != tc.endpoint || o.TokenAuthMethod != tc.method || o.Scopes != "read offline_access" {
					t.Fatal("动态注册配置未保留或规范化")
				}
				if (tc.id == "" || tc.method == "none") && in.String("oauth_client_secret") != "" {
					t.Fatal("动态注册或公共客户端不应保留手动 Secret")
				}
			}
		})
	}
}

func TestRegistrationNetworkSafety(t *testing.T) {
	t.Setenv("MONKEYAI_MCP_ALLOWED_CIDRS", "")
	var calls atomic.Int32
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1) }))
	defer remote.Close()
	if _, err := registerOAuthClient(t.Context(), oauthConfig{RegistrationURL: remote.URL}, "https://app.example.com/callback"); err == nil || calls.Load() != 0 {
		t.Fatal("动态注册绕过私网地址限制")
	}
	t.Setenv("MONKEYAI_MCP_ALLOWED_CIDRS", "127.0.0.0/8")
	bounce := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, remote.URL, http.StatusTemporaryRedirect)
	}))
	defer bounce.Close()
	if _, err := registerOAuthClient(t.Context(), oauthConfig{RegistrationURL: bounce.URL}, "https://app.example.com/callback"); err == nil || calls.Load() != 0 {
		t.Fatal("动态注册跟随重定向")
	}
}

func TestExchangeClientAuthentication(t *testing.T) {
	t.Setenv("MONKEYAI_MCP_ALLOWED_CIDRS", "127.0.0.0/8")
	for _, method := range []string{"", "none", "client_secret_post", "client_secret_basic"} {
		t.Run(method, func(t *testing.T) {
			remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_ = r.ParseForm()
				if r.Form.Get("client_id") != "client:id +" || r.Form.Get("grant_type") != "refresh_token" {
					t.Error("Token 请求参数错误")
				}
				if method == "client_secret_basic" {
					user, password, ok := r.BasicAuth()
					if !ok || user != url.QueryEscape("client:id +") || password != url.QueryEscape("secret: +") || r.Form.Get("client_secret") != "" {
						t.Error("Basic 认证未正确编码或重复发送 Secret")
					}
				} else if r.Header.Get("Authorization") != "" || (method == "none" && r.Form.Get("client_secret") != "") || (method != "none" && r.Form.Get("client_secret") != "secret: +") {
					t.Error("Token 认证方式错误")
				}
				resource.JSON(w, 200, resource.Object{"access_token": "access"})
			}))
			defer remote.Close()
			_, err := exchange(t.Context(), resource.Object{"oauth_config": oauthConfig{ClientID: "client:id +", TokenURL: remote.URL, TokenAuthMethod: method}, "oauth_client_secret": "secret: +"}, url.Values{"grant_type": {"refresh_token"}})
			if err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestRegistrationManualClient(t *testing.T) {
	c := resource.Object{"oauth_config": oauthConfig{ClientID: "manual", RegistrationURL: "https://unused.example.com/register"}}
	if err := (&Service{}).ensureOAuthClient(t.Context(), nil, c, ""); err != nil {
		t.Fatal("手动客户端不应触发注册", err)
	}
}

func TestDynamicRegistrationFailure(t *testing.T) {
	f := setup(t)
	var denied atomic.Bool
	denied.Store(true)
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if denied.Load() {
			resource.JSON(w, 400, resource.Object{"error": "invalid_client_metadata", "error_description": "private-registration-secret"})
			return
		}
		var body struct {
			Redirects []string `json:"redirect_uris"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		resource.JSON(w, 201, resource.Object{"client_id": "retry-client", "token_endpoint_auth_method": "none", "redirect_uris": body.Redirects})
	}))
	defer remote.Close()
	c := f.call("POST", "/agent/connectors", resource.Object{"name": "注册重试", "url": remote.URL, "authorization_mode": "independent", "authorization_method": "oauth", "oauth_config": resource.Object{"authorization_url": remote.URL, "token_url": remote.URL, "registration_url": remote.URL}}, "owner", "", 201)
	path := "/agent/connectors/" + c.String("id")
	failed := f.call("POST", path+"/oauth/authorizations", resource.Object{"name": "凭证"}, "owner", "", 502)
	encoded, _ := json.Marshal(failed)
	if strings.Contains(string(encoded), "private-registration-secret") {
		t.Fatal("注册错误泄露远端响应")
	}
	var count int
	if err := f.pool.QueryRow(t.Context(), `SELECT count(*) FROM connector_oauth_requests WHERE connector_id=$1`, c.String("id")).Scan(&count); err != nil || count != 0 {
		t.Fatal("注册失败留下授权事务", err)
	}
	saved := f.call("GET", path, nil, "owner", "", 200)
	if oauthSettings(saved).ClientID != "" || saved.Int("revision") != c.Int("revision") {
		t.Fatal("注册失败修改了连接配置")
	}
	denied.Store(false)
	f.call("POST", path+"/oauth/authorizations", resource.Object{"name": "凭证"}, "owner", "", 200)
}

func TestRegistrationExpiryConfig(t *testing.T) {
	for _, tc := range []struct {
		name  string
		input resource.Object
		want  int64
	}{
		{"修改名称", resource.Object{"name": "改名"}, 1234},
		{"忽略调用方到期时间", resource.Object{"oauth_config": oauthConfig{AuthorizationURL: "https://oauth.example.com/auth", TokenURL: "https://oauth.example.com/token", ClientID: "dynamic", RegistrationURL: "https://oauth.example.com/register", TokenAuthMethod: "client_secret_basic", ClientSecretExpiresAt: 9999999999}}, 1234},
		{"忽略调用方删除到期时间", resource.Object{"oauth_config": oauthConfig{AuthorizationURL: "https://oauth.example.com/auth", TokenURL: "https://oauth.example.com/token", ClientID: "dynamic", RegistrationURL: "https://oauth.example.com/register", TokenAuthMethod: "client_secret_basic"}}, 1234},
		{"手动更换密钥", resource.Object{"oauth_client_secret": "replacement"}, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			old := resource.Object{"url": "https://mcp.example.com", "authorization_mode": "independent", "authorization_method": "oauth", "oauth_client_secret": "secret", "oauth_config": oauthConfig{AuthorizationURL: "https://oauth.example.com/auth", TokenURL: "https://oauth.example.com/token", ClientID: "dynamic", RegistrationURL: "https://oauth.example.com/register", TokenAuthMethod: "client_secret_basic", ClientSecretExpiresAt: 1234}}
			if err := (&Service{}).validateConnector(t.Context(), nil, tc.input, old); err != nil {
				t.Fatal(err)
			}
			if got := oauthSettings(tc.input).ClientSecretExpiresAt; got != tc.want {
				t.Fatalf("到期时间=%d，预期 %d", got, tc.want)
			}
		})
	}
}

func TestRegistrationSecretExpiry(t *testing.T) {
	for _, tc := range []struct {
		method string
		expiry int64
		want   bool
	}{
		{"client_secret_basic", 0, false},
		{"client_secret_post", 1, true},
		{"client_secret_basic", time.Now().Add(time.Hour).Unix(), false},
		{"none", 1, false},
	} {
		if got := (oauthConfig{TokenAuthMethod: tc.method, ClientSecretExpiresAt: tc.expiry}).clientSecretExpired(); got != tc.want {
			t.Fatalf("到期判断错误: %+v", tc)
		}
	}
}

func TestRegistrationCancelledAuthorization(t *testing.T) {
	f := setup(t)
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			Redirects []string `json:"redirect_uris"`
		}
		_ = json.NewDecoder(r.Body).Decode(&input)
		resource.JSON(w, 201, resource.Object{"client_id": "dynamic", "token_endpoint_auth_method": "none", "redirect_uris": input.Redirects})
	}))
	defer remote.Close()
	c := f.call("POST", "/admin/connectors", resource.Object{"name": "取消授权", "url": remote.URL, "authorization_mode": "centralized", "authorization_method": "oauth", "oauth_config": resource.Object{"authorization_url": remote.URL, "token_url": remote.URL, "registration_url": remote.URL}}, "owner", "", 200)
	path := "/admin/connectors/" + c.String("id")
	auth := f.call("POST", path+"/oauth/authorizations", resource.Object{"name": "凭证"}, "owner", "", 200)
	// 页面在发起授权成功后立即刷新，不依赖用户是否完成授权。
	fresh := f.call("GET", path, nil, "owner", "", 200)
	if fresh.Int("revision") != c.Int("revision")+1 {
		t.Fatal("注册未递增版本")
	}
	target, _ := url.Parse(auth.String("authorization_url"))
	f.call("GET", "/oauth/connectors/"+c.String("id")+"/callback?state="+target.Query().Get("state")+"&error=access_denied", nil, "", "", 400)
	f.call("PUT", path, resource.Object{"name": "取消后改名"}, "owner", etag(fresh), 200)
}

func TestDynamicRegistrationRenewal(t *testing.T) {
	for _, mode := range []string{"independent", "centralized"} {
		t.Run(mode, func(t *testing.T) {
			f := setup(t)
			var registrations, exchanges atomic.Int32
			var denied atomic.Bool
			expiry := time.Now().Add(time.Hour).Unix()
			remote := mcpRemote(t, nil)
			oauth := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/register" {
					if denied.Load() {
						resource.JSON(w, 400, resource.Object{"error": "invalid_client_metadata"})
						return
					}
					n := registrations.Add(1)
					var input struct {
						Redirects []string `json:"redirect_uris"`
					}
					_ = json.NewDecoder(r.Body).Decode(&input)
					resource.JSON(w, 201, resource.Object{"client_id": fmt.Sprintf("dynamic-%d", n), "client_secret": fmt.Sprintf("registered-%d", n), "client_secret_expires_at": expiry, "token_endpoint_auth_method": "client_secret_basic", "redirect_uris": input.Redirects})
					return
				}
				exchanges.Add(1)
				user, secret, ok := r.BasicAuth()
				if !ok || user != fmt.Sprintf("dynamic-%d", registrations.Load()) || secret != fmt.Sprintf("registered-%d", registrations.Load()) {
					t.Error("交换令牌未使用新客户端")
				}
				resource.JSON(w, 200, resource.Object{"access_token": "access", "refresh_token": "refresh", "expires_in": 3600})
			}))
			defer oauth.Close()
			base, createStatus := "/agent", 201
			if mode == "centralized" {
				base, createStatus = "/admin", 200
			}
			c := f.call("POST", base+"/connectors", resource.Object{"name": "到期重新注册", "url": remote.URL, "authorization_mode": mode, "authorization_method": "oauth", "oauth_config": resource.Object{"authorization_url": oauth.URL + "/authorize", "token_url": oauth.URL + "/token", "registration_url": oauth.URL + "/register"}}, "owner", "", createStatus)
			path := base + "/connectors/" + c.String("id")
			first := f.call("POST", path+"/oauth/authorizations", resource.Object{"name": "凭证"}, "owner", "", 200)
			pending := f.call("POST", path+"/oauth/authorizations", resource.Object{"name": "未完成授权"}, "owner", "", 200)
			callback := func(auth resource.Object, status int) {
				target, _ := url.Parse(auth.String("authorization_url"))
				f.call("GET", "/oauth/connectors/"+c.String("id")+"/callback?state="+target.Query().Get("state")+"&code=code", nil, "", "", status)
			}
			callback(first, 200)
			result := f.call("GET", base+"/connector-authorizations/"+first.String("id"), nil, "owner", "", 200)
			credentialPath := path + "/credentials/" + result.String("credential_id")
			saved := f.call("GET", path, nil, "owner", "", 200)
			if oauthSettings(saved).ClientSecretExpiresAt != expiry {
				t.Fatal("未持久化密钥到期时间")
			}
			// 模拟到期，无需等待真实时钟；自动刷新不能反复发送已过期密钥。
			f.sql(`UPDATE connectors SET oauth_config=jsonb_set(oauth_config,'{client_secret_expires_at}','1') WHERE id=$1`, c.String("id"))
			f.sql(`UPDATE connector_credentials SET oauth_expires_at=now()-interval '1 minute' WHERE id=$1`, result.String("credential_id"))
			if mode == "independent" {
				f.service.refreshCredentials(t.Context())
				f.service.refreshCredentials(t.Context())
			}
			cred := f.call("GET", credentialPath, nil, "owner", "", 200)
			if exchanges.Load() != 1 || (mode == "independent" && cred.String("authorization_status") != "authorization_required") {
				t.Fatal("过期客户端未停止刷新或未标记需重新授权")
			}
			denied.Store(true)
			f.call("POST", credentialPath+"/oauth/authorizations", nil, "owner", etag(cred), 502)
			failed := f.call("GET", path, nil, "owner", "", 200)
			if failed.Int("revision") != saved.Int("revision") || failed.Int("config_revision") != c.Int("config_revision") || oauthSettings(failed).ClientID != "dynamic-1" || oauthSettings(failed).ClientSecretExpiresAt != 1 {
				t.Fatal("续注册失败未回滚")
			}
			denied.Store(false)
			var renewal resource.Object
			var workers sync.WaitGroup
			workers.Go(func() {
				renewal = f.call("POST", credentialPath+"/oauth/authorizations", nil, "owner", etag(cred), 200)
			})
			workers.Go(func() { f.call("POST", credentialPath+"/oauth/authorizations", nil, "owner", etag(cred), 200) })
			workers.Wait()
			renewed := f.call("GET", path, nil, "owner", "", 200)
			if registrations.Load() != 2 || renewed.Int("config_revision") != c.Int("config_revision")+1 || oauthSettings(renewed).ClientID != "dynamic-2" || oauthSettings(renewed).ClientSecretExpiresAt != expiry {
				t.Fatal("到期重新注册未更新客户端或并发重复注册")
			}
			var tools int
			if err := f.pool.QueryRow(t.Context(), `SELECT count(*) FROM mcp_tools WHERE connector_id=$1 AND deleted_at IS NULL`, c.String("id")).Scan(&tools); err != nil || tools != 0 {
				t.Fatal("旧工具未失效", err)
			}
			stale := f.call("GET", credentialPath, nil, "owner", "", 200)
			if stale.String("authorization_status") != "authorization_required" {
				t.Fatal("旧客户端凭证未失效")
			}
			f.service.refreshCredentials(t.Context())
			callback(pending, 412)
			if exchanges.Load() != 1 {
				t.Fatal("旧授权使用了新客户端交换令牌")
			}
			callback(renewal, 200)
			done := f.call("GET", base+"/connector-authorizations/"+renewal.String("id"), nil, "owner", "", 200)
			if done.String("status") != "succeeded" {
				t.Fatal("重新授权未完成")
			}
			cred = f.call("GET", credentialPath, nil, "owner", "", 200)
			if cred.String("authorization_status") != "authorized" || cred.Int("config_revision") != renewed.Int("config_revision") {
				t.Fatal("重新授权未关联新客户端版本")
			}
			f.sql(`UPDATE connector_credentials SET oauth_expires_at=now()-interval '1 minute' WHERE id=$1`, result.String("credential_id"))
			f.service.refreshCredentials(t.Context())
			if exchanges.Load() != 3 || registrations.Load() != 2 {
				t.Fatal("新客户端刷新失败或重复注册")
			}
		})
	}
}

func TestDynamicRegistrationAuthorization(t *testing.T) {
	for _, mode := range []string{"independent", "centralized"} {
		t.Run(mode, func(t *testing.T) {
			f := setup(t)
			var registrations atomic.Int32
			var callback string
			remote := mcpRemote(t, nil)
			oauth := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/register" {
					registrations.Add(1)
					resource.JSON(w, 201, resource.Object{"client_id": "dynamic", "client_secret": "registered-secret", "redirect_uris": []string{callback}, "token_endpoint_auth_method": "client_secret_basic"})
					return
				}
				user, secret, ok := r.BasicAuth()
				if !ok || user != "dynamic" || secret != "registered-secret" {
					t.Error("未复用注册客户端交换令牌")
				}
				resource.JSON(w, 200, resource.Object{"access_token": "access", "refresh_token": "refresh", "expires_in": 3600})
			}))
			defer oauth.Close()
			base, status := "/agent", 201
			if mode == "centralized" {
				base, status = "/admin", 200
			}
			c := f.call("POST", base+"/connectors", resource.Object{"name": "动态注册", "url": remote.URL, "authorization_mode": mode, "authorization_method": "oauth", "oauth_config": resource.Object{"authorization_url": oauth.URL + "/authorize", "token_url": oauth.URL + "/token", "registration_url": oauth.URL + "/register"}}, "owner", "", status)
			callback = f.service.callbackURL(c.String("id"))
			path := base + "/connectors/" + c.String("id")
			var auth resource.Object
			var workers sync.WaitGroup
			workers.Go(func() {
				auth = f.call("POST", path+"/oauth/authorizations", resource.Object{"name": "凭证"}, "owner", "", 200)
			})
			workers.Go(func() {
				f.call("POST", path+"/oauth/authorizations", resource.Object{"name": "另一凭证"}, "owner", "", 200)
			})
			workers.Wait()
			if registrations.Load() != 1 {
				t.Fatal("并发授权重复注册客户端")
			}
			u, _ := url.Parse(auth.String("authorization_url"))
			if u.Query().Get("client_id") != "dynamic" || u.Query().Get("redirect_uri") != callback || u.Query().Get("code_challenge_method") != "S256" {
				t.Fatal("授权请求未使用注册信息或 PKCE")
			}
			f.call("GET", "/oauth/connectors/"+c.String("id")+"/callback?state="+u.Query().Get("state")+"&code=code", nil, "", "", 200)
			result := f.call("GET", base+"/connector-authorizations/"+auth.String("id"), nil, "owner", "", 200)
			if result.String("status") != "succeeded" {
				t.Fatal("动态注册授权未完成")
			}
			f.sql(`UPDATE connector_credentials SET oauth_expires_at=now()-interval '1 minute' WHERE id=$1`, result.String("credential_id"))
			f.service.refreshCredentials(t.Context())
			var access string
			if err := f.pool.QueryRow(t.Context(), `SELECT oauth_access_token FROM connector_credentials WHERE id=$1 AND oauth_expires_at>now()`, result.String("credential_id")).Scan(&access); err != nil {
				t.Fatal("动态客户端刷新失败", err)
			}
			saved := f.call("GET", path, nil, "owner", "", 200)
			encoded, _ := json.Marshal(saved)
			if oauthSettings(saved).ClientID != "dynamic" || saved.Int("config_revision") != c.Int("config_revision") || strings.Contains(string(encoded), "registered-secret") || registrations.Load() != 1 {
				t.Fatal("注册未正确持久化或泄露 Secret")
			}
		})
	}
}
