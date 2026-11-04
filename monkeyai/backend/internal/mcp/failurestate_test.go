package mcp

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestAuthorizationCallbackMessageAndLegacyStatus(t *testing.T) {
	f := setup(t)
	c := f.call("POST", "/agent/connectors", resource.Object{"name": "授权状态", "url": "https://mcp.example.com", "authorization_mode": "independent", "authorization_method": "oauth", "oauth_config": resource.Object{"authorization_url": "https://oauth.example.com/auth", "token_url": "https://oauth.example.com/token", "client_id": "client"}}, "owner", "", 201)
	path := "/agent/connectors/" + c.String("id")
	auth := f.call("POST", path+"/oauth/authorizations", resource.Object{"name": "凭证"}, "owner", "", 200)
	target, _ := url.Parse(auth.String("authorization_url"))
	r := httptest.NewRequest("GET", "/oauth/connectors/"+c.String("id")+"/callback?state="+url.QueryEscape(target.Query().Get("state"))+"&error=access_denied", nil)
	r.Header.Set("Accept-Language", "en-US")
	w := httptest.NewRecorder()
	f.router.ServeHTTP(w, r)
	if w.Code != 400 || !strings.Contains(w.Body.String(), "oauth_authorization_cancelled") || !strings.Contains(w.Body.String(), "cancelled") || w.Header().Get("X-Request-ID") == "" {
		t.Fatalf("回调错误未本地化或缺少请求编号: %d %s", w.Code, w.Body.String())
	}
	status := f.call("GET", "/agent/connector-authorizations/"+auth.String("id"), nil, "owner", "", 200)
	if status.String("status") != "failed" {
		t.Fatalf("原有授权状态更新失败: %+v", status)
	}
	expiring := f.call("POST", path+"/oauth/authorizations", resource.Object{"name": "过期凭证"}, "owner", "", 200)
	f.sql(`UPDATE connector_oauth_requests SET expires_at = now() - interval '1 second' WHERE id = $1`, expiring.String("id"))
	expired := f.call("GET", "/agent/connector-authorizations/"+expiring.String("id"), nil, "owner", "", 200)
	if expired.String("status") != "expired" {
		t.Fatalf("原有授权过期状态错误: %+v", expired)
	}
}

func TestConnectionFailureMessageAndRecovery(t *testing.T) {
	f := setup(t)
	var rejected atomic.Bool
	rejected.Store(true)
	working := mcpRemote(t, nil)
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if rejected.Load() {
			w.WriteHeader(401)
			w.Write([]byte("private-upstream-response"))
			return
		}
		working.Config.Handler.ServeHTTP(w, r)
	}))
	defer remote.Close()
	c := f.call("POST", "/agent/connectors", resource.Object{"name": "测试诊断", "url": remote.URL, "authorization_mode": "independent", "authorization_method": "http_header"}, "owner", "", 201)
	path := "/agent/connectors/" + c.String("id")
	cred := f.call("POST", path+"/credentials", resource.Object{"name": "凭证", "http_headers": resource.Object{"Authorization": "Bearer private-key"}}, "owner", "", 201)
	credentialPath := path + "/credentials/" + cred.String("id")
	r := httptest.NewRequest("POST", credentialPath+"/test", nil)
	r.Header.Set("Authorization", "Bearer owner")
	r.Header.Set("Accept-Language", "en-US")
	w := httptest.NewRecorder()
	f.router.ServeHTTP(w, r)
	var failed struct {
		Error struct{ Code, Message string } `json:"error"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &failed); err != nil || w.Code != 502 || failed.Error.Code != "mcp_upstream_unauthorized" || !strings.Contains(failed.Error.Message, "authentication failed") || w.Header().Get("X-Request-ID") == "" || strings.Contains(w.Body.String(), "private-") {
		t.Fatalf("同步测试错误分类、翻译或脱敏错误: %v %d %s", err, w.Code, w.Body.String())
	}
	saved := f.call("GET", credentialPath, nil, "owner", "", 200)
	if saved.String("last_error") == "" || saved.String("connection_status") != "error" {
		t.Fatalf("原有连接状态未保留: %+v", saved)
	}
	rejected.Store(false)
	f.call("POST", credentialPath+"/test", nil, "owner", "", 200)
	saved = f.call("GET", credentialPath, nil, "owner", "", 200)
	if saved["last_error"] != nil || saved.String("connection_status") != "connected" {
		t.Fatalf("连接恢复后未清理原有错误: %+v", saved)
	}
}
