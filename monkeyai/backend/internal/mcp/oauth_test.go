package mcp

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestAutomaticRefresh(t *testing.T) {
	f := setup(t)
	var calls atomic.Int32
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if err := r.ParseForm(); err != nil || r.Form.Get("grant_type") != "refresh_token" || r.Form.Get("client_id") != "client" || r.Form.Get("client_secret") != "client-secret" {
			t.Error("自动刷新未携带正确的授权参数")
		}
		resource.JSON(w, 200, resource.Object{"access_token": "renewed", "refresh_token": "rotated", "expires_in": 3600})
	}))
	defer remote.Close()
	c := f.call("POST", "/agent/connectors", resource.Object{"name": "自动刷新", "url": remote.URL, "authorization_mode": "independent", "authorization_method": "oauth", "oauth_config": resource.Object{"client_id": "client", "token_url": remote.URL, "authorization_url": remote.URL}, "oauth_client_secret": "client-secret"}, "owner", "", 201)
	cases := []struct {
		name     string
		expires  any
		access   string
		refresh  string
		revoked  any
		revision int
		want     bool
	}{
		{name: "即将过期", expires: time.Now().Add(20 * time.Second), access: "old", refresh: "refresh", revision: 1, want: true},
		{name: "已过期", expires: time.Now().Add(-time.Minute), access: "old", refresh: "refresh", revision: 1, want: true},
		{name: "缺少访问令牌", refresh: "refresh", revision: 1, want: true},
		{name: "仍有效", expires: time.Now().Add(time.Hour), access: "old", refresh: "refresh", revision: 1},
		{name: "有效期未知", access: "old", refresh: "refresh", revision: 1},
		{name: "无刷新令牌", expires: time.Now().Add(-time.Minute), access: "old", revision: 1},
		{name: "已撤销", expires: time.Now().Add(-time.Minute), access: "old", refresh: "refresh", revoked: time.Now(), revision: 1},
		{name: "旧连接配置", expires: time.Now().Add(-time.Minute), access: "old", refresh: "refresh", revision: 2},
	}
	ids := make([]string, len(cases))
	for i, tc := range cases {
		ids[i] = resource.ID()
		f.sql(`INSERT INTO connector_credentials(id,connector_id,user_id,name,oauth_access_token,oauth_refresh_token,oauth_expires_at,config_revision,revoked_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, ids[i], c.String("id"), f.users["owner"], tc.name, tc.access, tc.refresh, tc.expires, tc.revision, tc.revoked)
		f.sql(`INSERT INTO mcp_tools(connector_id,credential_id,name,config_revision,enabled) VALUES($1,$2,'tool',1,true)`, c.String("id"), ids[i])
	}
	f.service.refreshCredentials(t.Context())
	f.service.refreshCredentials(t.Context())
	if calls.Load() != 3 {
		t.Fatalf("刷新请求次数错误: %d", calls.Load())
	}
	for i, tc := range cases {
		var access, refresh string
		var revision int
		if err := f.pool.QueryRow(t.Context(), `SELECT oauth_access_token,oauth_refresh_token,revision FROM connector_credentials WHERE id=$1`, ids[i]).Scan(&access, &refresh, &revision); err != nil {
			t.Fatal(err)
		}
		if revision != 1 || (tc.want && (access != "renewed" || refresh != "rotated")) || (!tc.want && (access != tc.access || refresh != tc.refresh)) {
			t.Errorf("%s: 令牌刷新或凭证版本错误", tc.name)
		}
	}
	var count int
	if err := f.pool.QueryRow(t.Context(), `SELECT count(*) FROM mcp_tools WHERE connector_id=$1 AND deleted_at IS NULL`, c.String("id")).Scan(&count); err != nil || count != len(cases) {
		t.Fatal("自动刷新使工具目录失效")
	}
}

func TestConcurrentAutomaticRefresh(t *testing.T) {
	f := setup(t)
	started, release := make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			close(started)
		}
		<-release
		resource.JSON(w, 200, resource.Object{"access_token": "renewed", "expires_in": 3600})
	}))
	defer remote.Close()
	c := f.call("POST", "/admin/connectors", resource.Object{"name": "集中自动刷新", "url": remote.URL, "authorization_mode": "centralized", "authorization_method": "oauth", "oauth_config": resource.Object{"client_id": "client", "token_url": remote.URL, "authorization_url": remote.URL}}, "owner", "", 200)
	id := resource.ID()
	f.sql(`INSERT INTO connector_credentials(id,connector_id,name,oauth_access_token,oauth_refresh_token,oauth_expires_at,config_revision) VALUES($1,$2,'集中凭证','old','refresh',now()-interval '1 minute',1)`, id, c.String("id"))
	cred, err := f.service.Credential(t.Context(), f.pool, c, "", id)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	var workers sync.WaitGroup
	workers.Go(func() { f.service.Run(ctx) })
	<-started
	workers.Go(func() { f.service.refreshCredentials(t.Context()) })
	workers.Go(func() {
		headers, fresh, err := f.service.headers(t.Context(), c, cred)
		if err != nil || headers["Authorization"] != "Bearer renewed" || fresh.String("oauth_refresh_token") != "refresh" {
			t.Error("调用前刷新未复用后台续期后的令牌")
		}
	})
	close(release)
	// 等令牌写入后再停止后台任务，确保覆盖完整启动刷新流程。
	if _, err := f.service.refresh(t.Context(), c, cred); err != nil {
		t.Fatal(err)
	}
	cancel()
	workers.Wait()
	if calls.Load() != 1 {
		t.Fatalf("并发任务重复刷新了同一份凭证: %d", calls.Load())
	}
}

func TestOAuthDiscoveryStatus(t *testing.T) {
	f := setup(t)
	started, release := make(chan struct{}), make(chan struct{})
	remote := mcpRemote(t, func() { close(started); <-release })
	oauth := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resource.JSON(w, 200, resource.Object{"access_token": "oauth-secret", "refresh_token": "refresh-secret", "expires_in": 3600})
	}))
	defer oauth.Close()
	c := f.call("POST", "/agent/connectors", resource.Object{"name": "授权自动发现", "url": remote.URL, "authorization_mode": "independent", "authorization_method": "oauth", "oauth_config": resource.Object{"client_id": "client", "token_url": oauth.URL, "authorization_url": oauth.URL}}, "owner", "", 201)
	path := "/agent/connectors/" + c.String("id")
	auth := f.call("POST", path+"/oauth/authorizations", resource.Object{"name": "工作凭证"}, "owner", "", 200)
	target, _ := url.Parse(auth.String("authorization_url"))
	done := make(chan struct{})
	go func() {
		defer close(done)
		f.call("GET", "/oauth/connectors/"+c.String("id")+"/callback?state="+target.Query().Get("state")+"&code=code", nil, "", "", 200)
	}()
	<-started
	status := f.call("GET", "/agent/connector-authorizations/"+auth.String("id"), nil, "owner", "", 200)
	if status.String("status") != "processing" {
		t.Error("工具发现结束前就报告了授权完成")
	}
	close(release)
	<-done
	status = f.call("GET", "/agent/connector-authorizations/"+auth.String("id"), nil, "owner", "", 200)
	if status.String("status") != "succeeded" || len(f.call("GET", path+"/credentials/"+status.String("credential_id")+"/tools", nil, "owner", "", 200)["items"].([]any)) != 1 {
		t.Fatal("授权完成时工具目录未就绪")
	}
}

func TestAutomaticDiscoveryFailure(t *testing.T) {
	for _, method := range []string{"oauth", "http_header"} {
		t.Run(method, func(t *testing.T) {
			f := setup(t)
			remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/token" {
					resource.JSON(w, 200, resource.Object{"access_token": "oauth-secret", "refresh_token": "refresh-secret", "expires_in": 3600})
					return
				}
				w.WriteHeader(http.StatusServiceUnavailable)
			}))
			defer remote.Close()
			c := f.call("POST", "/agent/connectors", resource.Object{"name": "测试失败", "url": remote.URL, "authorization_mode": "independent", "authorization_method": method, "oauth_config": resource.Object{"client_id": "client", "token_url": remote.URL + "/token", "authorization_url": remote.URL}}, "owner", "", 201)
			path := "/agent/connectors/" + c.String("id")
			var cred resource.Object
			if method == "oauth" {
				auth := f.call("POST", path+"/oauth/authorizations", resource.Object{"name": "工作凭证"}, "owner", "", 200)
				target, _ := url.Parse(auth.String("authorization_url"))
				f.call("GET", "/oauth/connectors/"+c.String("id")+"/callback?state="+target.Query().Get("state")+"&code=code", nil, "", "", 200)
				status := f.call("GET", "/agent/connector-authorizations/"+auth.String("id"), nil, "owner", "", 200)
				if status.String("status") != "succeeded" {
					t.Fatal("连接失败使已完成的 OAuth 授权失败")
				}
				cred = f.call("GET", path+"/credentials/"+status.String("credential_id"), nil, "owner", "", 200)
			} else {
				cred = f.call("POST", path+"/credentials", resource.Object{"name": "工作凭证", "http_headers": resource.Object{"Authorization": "header-secret"}}, "owner", "", 201)
			}
			if cred.String("authorization_status") != "authorized" || cred.String("connection_status") != "error" || cred.String("last_error") == "" || cred["last_checked_at"] == nil {
				data, _ := json.Marshal(cred)
				t.Fatalf("连接失败后凭证状态错误: %s", data)
			}
		})
	}
}
