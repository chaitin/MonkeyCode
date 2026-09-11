package mcp

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type iconStorage map[string][]byte

func (s iconStorage) Put(_ context.Context, key string, data []byte, _ string) error {
	s[key] = bytes.Clone(data)
	return nil
}
func (s iconStorage) Get(_ context.Context, key string) (io.ReadCloser, error) {
	return io.NopCloser(bytes.NewReader(s[key])), nil
}
func (s iconStorage) Delete(_ context.Context, key string) error { delete(s, key); return nil }
func (s iconStorage) Ping(context.Context) error                 { return nil }

type fixture struct {
	t       *testing.T
	pool    *pgxpool.Pool
	service *Service
	router  http.Handler
	users   map[string]string
}

func setup(t *testing.T) *fixture { return setupAt(t, 0) }
func setupAt(t *testing.T, last int) *fixture {
	t.Helper()
	dsn := os.Getenv("MONKEYAI_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("设置 MONKEYAI_TEST_DATABASE_URL 运行凭证数据库测试")
	}
	ctx := t.Context()
	root, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	schema := "test_mcp_" + strings.ReplaceAll(resource.ID(), "-", "")
	if _, err = root.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { root.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE"); root.Close() })
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	files, _ := filepath.Glob("../../migrations/*.up.sql")
	for i, path := range files {
		if last > 0 && i >= last {
			break
		}
		b, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = pool.Exec(ctx, string(b)); err != nil {
			t.Fatalf("%s: %v", path, err)
		}
	}
	users := map[string]string{"owner": resource.ID(), "other": resource.ID()}
	for token, id := range users {
		if _, err = pool.Exec(ctx, `INSERT INTO users(id,name,email,role) VALUES($1,$2,$2||'@example.com','admin')`, id, token); err != nil {
			t.Fatal(err)
		}
		digest := fmt.Sprintf("%x", sha256.Sum256([]byte(token)))
		if _, err = pool.Exec(ctx, `INSERT INTO oauth_tokens(user_id,client_id,access_token_hash,refresh_token_hash,access_expires_at,refresh_expires_at) VALUES($1,'test',$2,$2,now()+interval '1 hour',now()+interval '2 hours')`, id, digest); err != nil {
			t.Fatal(err)
		}
	}
	s := NewService(resource.NewStore(pool), "http://localhost").WithStorage(iconStorage{})
	router := chi.NewRouter()
	router.Get("/oauth/connectors/{id}/callback", s.Callback)
	router.Group(func(r chi.Router) {
		r.Use(identity.NewService(pool, nil, "http://localhost", "http://localhost").RequireAgent)
		r.Route("/agent", s.RegisterAgent)
		r.Route("/admin", s.RegisterAdmin)
	})
	t.Setenv("MONKEYAI_MCP_ALLOWED_CIDRS", "127.0.0.0/8")
	return &fixture{t, pool, s, router, users}
}
func (f *fixture) call(method, path string, body any, user, match string, want int) resource.Object {
	f.t.Helper()
	data, _ := json.Marshal(body)
	req := httptest.NewRequest(method, path, bytes.NewReader(data))
	req.Header.Set("Authorization", "Bearer "+user)
	req.Header.Set("If-Match", match)
	w := httptest.NewRecorder()
	f.router.ServeHTTP(w, req)
	if w.Code != want {
		f.t.Fatalf("%s %s: %d %s，预期 %d", method, path, w.Code, w.Body.String(), want)
	}
	out := resource.Object{}
	if strings.Contains(w.Header().Get("Content-Type"), "application/json") {
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
			f.t.Fatal(err)
		}
	}
	for _, secret := range []string{"header-secret", "oauth-secret", "refresh-secret", "client-secret"} {
		if strings.Contains(w.Body.String(), secret) {
			f.t.Fatal("响应泄露凭证秘密")
		}
	}
	return out
}
func etag(o resource.Object) string { return fmt.Sprintf(`"%d"`, o.Int("revision")) }
func (f *fixture) sql(query string, args ...any) {
	f.t.Helper()
	if _, err := f.pool.Exec(f.t.Context(), query, args...); err != nil {
		f.t.Fatal(err)
	}
}
func mcpRemote(t *testing.T, beforeList func()) *httptest.Server {
	t.Helper()
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var in request
		_ = json.NewDecoder(r.Body).Decode(&in)
		w.Header().Set("Content-Type", "application/json")
		result := resource.Object{}
		switch in.Method {
		case "initialize":
			result["protocolVersion"] = protocolVersion
		case "notifications/initialized":
			w.WriteHeader(202)
			return
		case "tools/list":
			if beforeList != nil {
				beforeList()
			}
			result["tools"] = []resource.Object{{"name": "same_tool", "description": r.Header.Get("X-Account"), "inputSchema": resource.Object{"type": "object"}}}
		case "tools/call":
			result["content"] = []resource.Object{{"type": "text", "text": r.Header.Get("X-Account")}}
		}
		_ = json.NewEncoder(w).Encode(resource.Object{"jsonrpc": "2.0", "id": in.ID, "result": result})
	}))
	t.Cleanup(s.Close)
	return s
}
func TestCredentialIsolation(t *testing.T) {
	f := setup(t)
	remote := mcpRemote(t, nil)
	c := f.call("POST", "/agent/connectors", resource.Object{"name": "个人连接", "url": remote.URL, "authorization_mode": "independent", "authorization_method": "http_header", "ownership_type": "system", "owner_user_id": f.users["other"], "enabled": false}, "owner", "", 201)
	if c.String("ownership_type") != "user" || c["user"].(map[string]any)["id"] != f.users["owner"] || !c.Bool("enabled") {
		t.Fatal("个人资源归属错误")
	}
	path := "/agent/connectors/" + c.String("id")
	f.call("POST", path+"/test", nil, "owner", "", 400)
	f.call("GET", path+"/tools", nil, "owner", "", 400)
	a := f.call("POST", path+"/credentials", resource.Object{"name": "相同名称", "http_headers": resource.Object{"Authorization": "header-secret", "X-Account": "A"}}, "owner", "", 201)
	b := f.call("POST", path+"/credentials", resource.Object{"name": "相同名称", "http_headers": resource.Object{"Authorization": "header-secret", "X-Account": "B"}}, "owner", "", 201)
	if a.String("id") == b.String("id") {
		t.Fatal("新增凭证互相覆盖")
	}
	for _, cred := range []resource.Object{a, b} {
		cp := path + "/credentials/" + cred.String("id")
		f.call("POST", cp+"/test", nil, "owner", "", 200)
		f.call("GET", cp, nil, "other", "", 404)
		f.call("PATCH", cp, resource.Object{"name": "越权"}, "other", etag(cred), 404)
	}
	ta := f.call("GET", path+"/credentials/"+a.String("id")+"/tools", nil, "owner", "", 200)["items"].([]any)[0].(map[string]any)
	tb := f.call("GET", path+"/credentials/"+b.String("id")+"/tools", nil, "owner", "", 200)["items"].([]any)[0].(map[string]any)
	if ta["id"] == tb["id"] || ta["description"] != "A" || tb["description"] != "B" {
		t.Fatal("工具目录跨凭证混用")
	}
	ap := path + "/credentials/" + a.String("id")
	f.call("PATCH", ap, resource.Object{"name": "改名"}, "owner", "", 428)
	renamed := f.call("PATCH", ap, resource.Object{"name": "改名"}, "owner", etag(a), 200)
	if len(f.call("GET", ap+"/tools", nil, "owner", "", 200)["items"].([]any)) != 1 {
		t.Fatal("改名失效了目录")
	}
	f.call("PATCH", ap, resource.Object{"name": "旧版本"}, "owner", etag(a), 412)
	changed := f.call("PATCH", ap, resource.Object{"http_headers": resource.Object{"X-Account": "C"}}, "owner", etag(renamed), 200)
	if len(f.call("GET", ap+"/tools", nil, "owner", "", 200)["items"].([]any)) != 0 {
		t.Fatal("换 Header 未使目录失效")
	}
	f.call("POST", ap+"/test", nil, "owner", "", 200)
	restored := f.call("GET", ap+"/tools", nil, "owner", "", 200)["items"].([]any)[0].(map[string]any)
	if restored["id"] != ta["id"] || restored["description"] != "C" {
		t.Fatal("重新发现未复用工具 ID")
	}
	other := f.call("POST", "/agent/connectors", resource.Object{"name": "另一连接", "url": remote.URL, "authorization_mode": "independent", "authorization_method": "http_header"}, "owner", "", 201)
	f.call("GET", "/agent/connectors/"+other.String("id")+"/credentials/"+a.String("id"), nil, "owner", "", 404)
	f.call("DELETE", ap, nil, "owner", etag(changed), 204)
	f.call("GET", ap, nil, "owner", "", 404)
	if len(f.call("GET", path+"/credentials", nil, "owner", "", 200)["items"].([]any)) != 1 {
		t.Fatal("撤销影响了其他凭证")
	}
	oldRevision := c.Int("config_revision")
	c = f.call("PUT", path, resource.Object{"name": "换地址", "url": remote.URL + "/new"}, "owner", etag(c), 200)
	if c.Int("config_revision") != oldRevision+1 {
		t.Fatal("地址变更未递增配置版本")
	}
	if f.call("GET", path+"/credentials/"+b.String("id"), nil, "owner", "", 200).String("authorization_status") != "authorization_required" {
		t.Fatal("旧凭证仍可用于新配置")
	}
}
func TestHeaderValidation(t *testing.T) {
	for _, raw := range []string{`{}`, `null`, `[]`, `{"Authorization":"a","authorization":"b"}`, `{"X":"a","X":"b"}`, `{"Host":"evil"}`, `{"Mcp-Session-Id":"x"}`, `{"Accept":"text/plain"}`, `{"X":"a\r\nb"}`, `{"Bad Key":"x"}`, `{"X":1}`} {
		if _, err := decodeHeaders([]byte(raw)); err == nil {
			t.Fatalf("允许了非法 Header: %s", raw)
		}
	}
	if h, err := decodeHeaders([]byte(`{"Authorization":"Bearer exact","X-Key":"v"}`)); err != nil || h["Authorization"] != "Bearer exact" {
		t.Fatal("未保留认证 Header")
	}
}
func TestDiscoveryConcurrentEdit(t *testing.T) {
	f := setup(t)
	started, release := make(chan struct{}), make(chan struct{})
	remote := mcpRemote(t, func() { close(started); <-release })
	c := f.call("POST", "/agent/connectors", resource.Object{"name": "发现竞争", "url": remote.URL, "authorization_mode": "independent", "authorization_method": "http_header"}, "owner", "", 201)
	path := "/agent/connectors/" + c.String("id")
	a := f.call("POST", path+"/credentials", resource.Object{"name": "A", "http_headers": resource.Object{"X-Account": "A"}}, "owner", "", 201)
	ap := path + "/credentials/" + a.String("id")
	done := make(chan struct{})
	go func() { defer close(done); f.call("POST", ap+"/test", nil, "owner", "", 412) }()
	<-started
	f.call("PATCH", ap, resource.Object{"http_headers": resource.Object{"X-Account": "B"}}, "owner", etag(a), 200)
	close(release)
	<-done
	if len(f.call("GET", ap+"/tools", nil, "owner", "", 200)["items"].([]any)) != 0 {
		t.Fatal("旧发现结果覆盖新凭证")
	}
}
func TestOAuthMultipleCredentials(t *testing.T) {
	f := setup(t)
	var exchanges atomic.Int32
	oauth := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/token" {
			t.Error("不应请求用户信息接口")
			w.WriteHeader(404)
			return
		}
		exchanges.Add(1)
		r.ParseForm()
		if r.Form.Get("code_verifier") == "" && r.Form.Get("grant_type") == "authorization_code" {
			t.Error("缺少 PKCE")
		}
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"access_token":"oauth-secret","refresh_token":"refresh-secret","expires_in":3600}`)
	}))
	defer oauth.Close()
	c := f.call("POST", "/agent/connectors", resource.Object{"name": "OAuth", "url": oauth.URL, "authorization_mode": "independent", "authorization_method": "oauth", "oauth_config": resource.Object{"authorization_url": oauth.URL + "/authorize", "token_url": oauth.URL + "/token", "client_id": "test"}, "oauth_client_secret": "client-secret"}, "owner", "", 201)
	path := "/agent/connectors/" + c.String("id")
	begin := func(cp, rev string) resource.Object {
		return f.call("POST", cp+"/oauth/authorizations", resource.Object{"name": "相同账户"}, "owner", rev, 200)
	}
	callback := func(auth resource.Object, want int) {
		u, _ := url.Parse(auth.String("authorization_url"))
		if u.Query().Get("code_challenge_method") != "S256" {
			t.Fatal("未使用 PKCE S256")
		}
		f.call("GET", "/oauth/connectors/"+c.String("id")+"/callback?state="+url.QueryEscape(u.Query().Get("state"))+"&code=identical", nil, "", "", want)
	}
	status := func(auth resource.Object) resource.Object {
		return f.call("GET", "/agent/connector-authorizations/"+auth.String("id"), nil, "owner", "", 200)
	}
	a, b := begin(path, ""), begin(path, "")
	callback(a, 200)
	callback(b, 200)
	ca, cb := status(a), status(b)
	if ca.String("credential_id") == cb.String("credential_id") || ca.String("status") != "succeeded" {
		t.Fatal("同用户授权被覆盖")
	}
	callback(a, 400)
	if exchanges.Load() != 2 {
		t.Fatal("重复回调再次交换 Token")
	}
	f.call("GET", "/agent/connector-authorizations/"+a.String("id"), nil, "other", "", 404)
	ap := path + "/credentials/" + ca.String("credential_id")
	cred := f.call("GET", ap, nil, "owner", "", 200)
	x, y := begin(ap, etag(cred)), begin(ap, etag(cred))
	callback(x, 200)
	callback(y, 412)
	if status(x).String("credential_id") != ca.String("credential_id") || status(y).String("status") != "failed" {
		t.Fatal("重新授权未绑定指定凭证版本")
	}
	cred = f.call("GET", ap, nil, "owner", "", 200)
	z := begin(ap, etag(cred))
	f.call("DELETE", ap, nil, "owner", etag(cred), 204)
	callback(z, 404)
	pending := begin(path, "")
	c = f.call("PUT", path, resource.Object{"name": "配置变化", "url": oauth.URL + "/new"}, "owner", etag(c), 200)
	callback(pending, 412)
	if len(f.call("GET", path+"/credentials", nil, "owner", "", 200)["items"].([]any)) != 1 {
		t.Fatal("失败回调创建或复活凭证")
	}
}

func TestCredentialMigration(t *testing.T) {
	f := setupAt(t, 11)
	p, c1, c2, cred, tool, expert, auth := resource.ID(), resource.ID(), resource.ID(), resource.ID(), resource.ID(), resource.ID(), resource.ID()
	f.sql(`INSERT INTO connector_providers(id,identifier,owner_user_id,name,url,authorization_mode,authorization_method,enabled,icon_s3_key) VALUES($1,'legacy',$2,'旧模板','https://template.example','independent','http_header',false,'shared/icon.png')`, p, f.users["owner"])
	for _, id := range []string{c1, c2} {
		f.sql(`INSERT INTO connectors(id,provider_id,owner_user_id,name,url,authorization_mode,authorization_method) VALUES($1,$2,$3,($1::uuid)::text,'https://instance.example','independent','http_header')`, id, p, f.users["owner"])
	}
	f.sql(`INSERT INTO connector_credentials(id,connector_id,user_id,method,http_headers,config_revision) VALUES($1,$2,$3,'http_header','{"X-Key":"preserved"}',1)`, cred, c1, f.users["owner"])
	f.sql(`INSERT INTO mcp_tools(id,connector_id,credential_id,name,config_revision,enabled) VALUES($1,$2,$3,'legacy',1,true)`, tool, c1, cred)
	f.sql(`INSERT INTO experts(id,name,description,prompt,owner_user_id,created_by_user_id) VALUES($1,'旧专家','','测试',$2,$2)`, expert, f.users["owner"])
	f.sql(`INSERT INTO expert_connector_providers(expert_id,provider_id,required,tool_allowlist) VALUES($1,$2,false,'{legacy}')`, expert, p)
	f.sql(`INSERT INTO connector_oauth_requests(id,connector_id,user_id,centralized,config_revision,state_hash,verifier,redirect_uri,expires_at) VALUES($1,$2,$3,false,1,'state','verifier','http://localhost',now()+interval '1 minute')`, auth, c1, f.users["owner"])
	report, err := os.ReadFile("../../tools/connectorcheck.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.pool.Exec(t.Context(), string(report)); err != nil {
		t.Fatalf("只读预检查失败: %v", err)
	}
	up, err := os.ReadFile("../../migrations/000012_mcp_connector_credentials.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.pool.Exec(t.Context(), string(up)); err == nil || !strings.Contains(err.Error(), "ambiguous_connector") {
		t.Fatalf("多候选迁移应停止: %v", err)
	}
	var count int
	if err = f.pool.QueryRow(t.Context(), `SELECT count(*) FROM connector_providers WHERE id=$1`, p).Scan(&count); err != nil || count != 1 {
		t.Fatal("失败迁移修改了原数据")
	}
	conn, err := f.pool.Acquire(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Release()
	mapping, _ := json.Marshal(resource.Object{expert: resource.Object{p: c1}})
	if _, err = conn.Exec(t.Context(), `SELECT set_config('monkeyai.connector_mappings',$1,false)`, string(mapping)); err != nil {
		t.Fatal(err)
	}
	if _, err = conn.Exec(t.Context(), string(up)); err != nil {
		t.Fatal(err)
	}
	var target, icon, address, status string
	var enabled, required bool
	if err = f.pool.QueryRow(t.Context(), `SELECT x.connector_id::text,x.required,c.icon_s3_key,c.url,c.enabled FROM expert_connectors x JOIN connectors c ON c.id=x.connector_id WHERE expert_id=$1`, expert).Scan(&target, &required, &icon, &address, &enabled); err != nil {
		t.Fatal(err)
	}
	if target != c1 || required || icon != "shared/icon.png" || address != "https://instance.example" || enabled {
		t.Fatal("映射、实例配置或旧停用状态未保留")
	}
	if err = f.pool.QueryRow(t.Context(), `SELECT status FROM connector_oauth_requests WHERE id=$1`, auth).Scan(&status); err != nil || status != "failed" {
		t.Fatal("旧授权事务仍可写入")
	}
	if err = f.pool.QueryRow(t.Context(), `SELECT count(*) FROM mcp_tools WHERE id=$1 AND credential_id=$2 AND deleted_at IS NULL`, tool, cred).Scan(&count); err != nil || count != 1 {
		t.Fatal("迁移丢失有效工具历史")
	}
	f.sql(`INSERT INTO connector_credentials(connector_id,user_id,name,http_headers,config_revision) VALUES($1,$2,'新增','{"X-Key":"second"}',1)`, c1, f.users["owner"])
	if err = f.pool.QueryRow(t.Context(), `SELECT count(*) FROM connector_credentials WHERE connector_id=$1 AND user_id=$2`, c1, f.users["owner"]).Scan(&count); err != nil || count != 2 {
		t.Fatal("迁移后仍限制单凭证")
	}
}

func TestRefreshRevocation(t *testing.T) {
	f := setup(t)
	started, release := make(chan struct{}), make(chan struct{})
	var count atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		count.Add(1)
		close(started)
		<-release
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"access_token":"renewed","expires_in":3600}`)
	}))
	defer server.Close()
	c := f.call("POST", "/agent/connectors", resource.Object{"name": "刷新竞争", "url": server.URL, "authorization_mode": "independent", "authorization_method": "oauth", "oauth_config": resource.Object{"client_id": "id", "authorization_url": server.URL, "token_url": server.URL}}, "owner", "", 201)
	id := resource.ID()
	f.sql(`INSERT INTO connector_credentials(id,connector_id,user_id,name,oauth_access_token,oauth_refresh_token,oauth_expires_at,config_revision) VALUES($1,$2,$3,'待刷新','old','refresh',now()-interval '1 minute',1)`, id, c.String("id"), f.users["owner"])
	ctx := t.Context()
	raw, err := f.service.Connector(ctx, f.pool, c.String("id"), f.users["owner"], false)
	if err != nil {
		t.Fatal(err)
	}
	cred, err := f.service.Credential(ctx, f.pool, raw, f.users["owner"], id)
	if err != nil {
		t.Fatal(err)
	}
	refreshed := make(chan error, 1)
	go func() {
		out, err := f.service.refresh(ctx, raw, cred)
		if err == nil && (out.Int("revision") != 1 || out.String("oauth_refresh_token") != "refresh") {
			err = fmt.Errorf("刷新改变人工版本或丢失刷新令牌")
		}
		refreshed <- err
	}()
	<-started
	revoked := make(chan struct{})
	go func() {
		defer close(revoked)
		f.call("DELETE", "/agent/connectors/"+c.String("id")+"/credentials/"+id, nil, "owner", `"1"`, 204)
	}()
	close(release)
	if err = <-refreshed; err != nil {
		t.Fatal(err)
	}
	<-revoked
	if _, err = f.service.refresh(ctx, raw, cred); err == nil {
		t.Fatal("刷新复活已撤销凭证")
	}
	if count.Load() != 1 {
		t.Fatal("撤销后仍发送刷新请求")
	}
}

func TestRefreshFailure(t *testing.T) {
	f := setup(t)
	var status atomic.Int32
	status.Store(503)
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(int(status.Load()))
		io.WriteString(w, `{"error":"invalid_grant"}`)
	}))
	defer remote.Close()
	c := f.call("POST", "/agent/connectors", resource.Object{"name": "刷新失败", "url": remote.URL, "authorization_mode": "independent", "authorization_method": "oauth", "oauth_config": resource.Object{"client_id": "test", "token_url": remote.URL, "authorization_url": remote.URL}}, "owner", "", 201)
	id := resource.ID()
	f.sql(`INSERT INTO connector_credentials(id,connector_id,user_id,name,oauth_access_token,oauth_refresh_token,oauth_expires_at,config_revision) VALUES($1,$2,$3,'刷新失败','old','refresh',now()-interval '1 minute',1)`, id, c.String("id"), f.users["owner"])
	f.sql(`INSERT INTO mcp_tools(connector_id,credential_id,name,config_revision,enabled) VALUES($1,$2,'tool',1,true)`, c.String("id"), id)
	ctx := t.Context()
	cred, err := f.service.Credential(ctx, f.pool, c, f.users["owner"], id)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.service.refresh(ctx, c, cred); err == nil {
		t.Fatal("上游临时故障被忽略")
	}
	current, err := f.service.Credential(ctx, f.pool, c, f.users["owner"], id)
	if err != nil || current.String("oauth_refresh_token") != "refresh" || current.Int("revision") != 1 {
		t.Fatal("临时故障清除了凭证")
	}
	status.Store(400)
	if _, err = f.service.refresh(ctx, c, cred); err != authorizationRequired {
		t.Fatalf("invalid_grant 未要求重新授权: %v", err)
	}
	current, err = f.service.Credential(ctx, f.pool, c, f.users["owner"], id)
	if err != nil || current.String("oauth_refresh_token") != "" || current.Int("revision") != 2 {
		t.Fatal("失效刷新凭证未清理或未递增版本")
	}
	var count int
	if err = f.pool.QueryRow(ctx, `SELECT count(*) FROM mcp_tools WHERE credential_id=$1 AND deleted_at IS NULL`, id).Scan(&count); err != nil || count != 0 {
		t.Fatal("无效凭证仍保留工具目录")
	}
}

func TestOAuthCallbackConfigurationRace(t *testing.T) {
	f := setup(t)
	started, release := make(chan struct{}), make(chan struct{})
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-release
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"access_token":"oauth-secret"}`)
	}))
	defer remote.Close()
	c := f.call("POST", "/agent/connectors", resource.Object{"name": "回调竞争", "url": remote.URL, "authorization_mode": "independent", "authorization_method": "oauth", "oauth_config": resource.Object{"client_id": "test", "token_url": remote.URL, "authorization_url": remote.URL}}, "owner", "", 201)
	path := "/agent/connectors/" + c.String("id")
	auth := f.call("POST", path+"/oauth/authorizations", resource.Object{"name": "认证"}, "owner", "", 200)
	target, _ := url.Parse(auth.String("authorization_url"))
	done := make(chan struct{})
	go func() {
		defer close(done)
		f.call("GET", "/oauth/connectors/"+c.String("id")+"/callback?state="+target.Query().Get("state")+"&code=code", nil, "", "", 412)
	}()
	<-started
	f.call("PUT", path, resource.Object{"name": "配置变化", "url": remote.URL + "/new"}, "owner", etag(c), 200)
	close(release)
	<-done
	if len(f.call("GET", path+"/credentials", nil, "owner", "", 200)["items"].([]any)) != 0 {
		t.Fatal("旧应用回调写入新配置凭证")
	}
}
