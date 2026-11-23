package app

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/config"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/endpoint"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

type parityClient struct {
	t      *testing.T
	app    http.Handler
	cookie *http.Cookie
}

func (c parityClient) request(method, path, token, csrf string, body any, want int) resource.Object {
	c.t.Helper()
	var data string
	mime := "application/json"
	if form, ok := body.(url.Values); ok {
		data = form.Encode()
		mime = "application/x-www-form-urlencoded"
	} else if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			c.t.Fatal(err)
		}
		data = string(b)
	}
	req := httptest.NewRequest(method, path, strings.NewReader(data))
	req.Header.Set("Content-Type", mime)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if strings.HasPrefix(path, "/api/auth/") {
		req.AddCookie(c.cookie)
		req.Header.Set("X-CSRF-Token", csrf)
		req.Header.Set("Origin", "http://localhost")
	}
	w := httptest.NewRecorder()
	c.app.ServeHTTP(w, req)
	if w.Code != want {
		c.t.Fatalf("%s %s: %d，期望 %d: %s", method, path, w.Code, want, w.Body.String())
	}
	var obj resource.Object
	if w.Body.Len() > 0 {
		if err := json.Unmarshal(w.Body.Bytes(), &obj); err != nil {
			c.t.Fatal(err)
		}
	}
	return obj
}

func TestAccountResourceParity(t *testing.T) {
	ctx := t.Context()
	pool := designAppDatabase(t)
	h, err := newMemberTestHandler(ctx, slog.New(slog.NewTextHandler(io.Discard, nil)), pool, config.Config{PublicURL: "http://localhost", RuntimeRelay: true, RuntimeStateDir: t.TempDir(), InitialAdminName: "初始管理员", InitialAdminEmail: "admin@example.com", InitialAdminPassword: "resource-test-password"})
	if err != nil {
		t.Fatal(err)
	}
	user, owner := resource.ID(), resource.ID()
	for _, id := range []string{user, owner} {
		if _, err := pool.Exec(ctx, "INSERT INTO users(id,name,email) VALUES($1,'资源测试',$2)", id, id+"@example.com"); err != nil {
			t.Fatal(err)
		}
	}
	app := h.(*applicationHandler)
	cookie := &http.Cookie{Name: "monkeyai_session", Value: resource.ID()}
	hash := sha256.Sum256([]byte(cookie.Value))
	if _, err = pool.Exec(ctx, "INSERT INTO browser_sessions(token_hash,user_id,authentication_method,expires_at) VALUES($1,$2,'password',now()+interval '1 hour')", hex.EncodeToString(hash[:]), user); err != nil {
		t.Fatal(err)
	}
	c := parityClient{t, h, cookie}
	ids := identity.NewService(pool, nil, "http://localhost")
	devices := endpoint.NewExecution(pool, ids)
	ids.WithDeviceAuthorization(app.relay.Metadata()["server_id"].(string), app.relay.DeviceAuthorizationKey(), devices)
	verifier := strings.Repeat("x", 64)
	challenge := sha256.Sum256([]byte(verifier))
	req, err := ids.BeginAuthorization(ctx, url.Values{"client_id": {"monkeyai-desktop"}, "response_type": {"code"}, "redirect_uri": {"monkeyai-desktop://oauth/callback"}, "state": {"test"}, "code_challenge_method": {"S256"}, "code_challenge": {base64.RawURLEncoding.EncodeToString(challenge[:])}, "scope": {"device:manage"}})
	if err != nil {
		t.Fatal(err)
	}
	path := "/api/auth/v1/client-requests/" + req.ID
	view := c.request("GET", path, "", "", nil, 200)
	approved := c.request("POST", path+"/complete", "", view.String("csrf_token"), resource.Object{"approved_scopes": view["scopes"]}, 200)
	callback, err := url.Parse(approved.String("launch_url"))
	if err != nil {
		t.Fatal(err)
	}
	desktop, err := ids.ExchangeCode(ctx, "monkeyai-desktop", req.RedirectURI, callback.Query().Get("code"), verifier)
	if err != nil {
		t.Fatal(err)
	}
	type client struct{ name, token, machine, refresh, key string }
	clients := []client{{name: "桌面", token: desktop.AccessToken}}
	for _, name := range []string{"云电脑", "自建 runtime"} {
		public, _, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		machine := resource.ID()
		form := url.Values{"client_id": {identity.RuntimeClientID}, "machine_id": {machine}, "execution_public_key": {base64.RawURLEncoding.EncodeToString(public)}, "display_name": {name}, "platform": {"linux"}, "arch": {"amd64"}}
		device := c.request("POST", "/oauth/device/authorization", "", "", form, 200)
		if name == "云电脑" {
			tx, err := pool.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback(ctx)
			if _, err = ids.ApproveRuntime(ctx, tx, user, machine, public, device.String("user_code")); err != nil {
				t.Fatal(err)
			}
			if err = tx.Commit(ctx); err != nil {
				t.Fatal(err)
			}
		} else {
			view := c.request("GET", "/api/auth/v1/client-requests/device?purpose=device&user_code="+device.String("user_code"), "", "", nil, 200)
			c.request("POST", "/api/auth/v1/device/decision", "", view.String("csrf_token"), resource.Object{"request_id": view["request_id"], "decision": "approve", "approved_scopes": view["scopes"]}, 200)
		}
		time.Sleep(time.Duration(device.Int("interval")) * time.Second)
		token := c.request("POST", "/oauth/token", "", "", url.Values{"grant_type": {identity.DeviceGrantType}, "client_id": {identity.RuntimeClientID}, "device_code": {device.String("device_code")}}, 200)
		p := identity.Principal{ClientID: identity.RuntimeClientID, UserID: user, GrantID: token.String("grant_id"), Purpose: "runtime", Audience: identity.Audience, Scopes: strings.Fields(token.String("scope")), RevocationVersion: 1}
		if _, err := devices.Enroll(ctx, p, endpoint.Enrollment{MachineID: machine, PublicKey: public, DisplayName: name, Platform: "linux", Arch: "amd64", Intent: "publish", DeploymentMode: "standalone"}, 0); err != nil {
			t.Fatal(err)
		}
		clients = append(clients, client{name: name, machine: machine, token: token.String("access_token"), refresh: token.String("refresh_token")})
	}
	shared, err := app.knowledgeBases.CreateUserKB(ctx, owner, resource.Object{"name": "只读共享库"})
	if err != nil {
		t.Fatal(err)
	}
	sharedID := shared.String("id")
	store := resource.NewStore(pool)
	err = store.Share(ctx, owner, resource.ShareInput{Resources: []resource.ShareResource{{Type: "kb", ID: sharedID}}, UserIDs: []string{user}, AccessLevel: "read_only"}, false, map[string]resource.Shareable{"kb": app.knowledgeBases.CRUD})
	if err != nil {
		t.Fatal(err)
	}
	var common, doc string
	for i := range clients {
		cl := &clients[i]
		book := c.request("POST", "/api/v1/kb", cl.token, "", resource.Object{"name": cl.name + "个人库"}, 201)
		id := book.String("id")
		c.request("GET", "/api/v1/kb/"+id, cl.token, "", nil, 200)
		item := c.request("POST", "/api/v1/kb/"+id+"/documents", cl.token, "", resource.Object{"title": "验收文档", "content": "paritydocument"}, 202)
		if i == 0 {
			common = id
			doc = item.String("id")
		}
		cl.key = c.request("POST", "/api/v1/api-keys", cl.token, "", resource.Object{"name": cl.name, "scopes": []string{"mcp:invoke"}}, 201).String("api_key")
	}
	worker, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() { defer close(done); app.knowledgeBases.Run(worker) }()
	defer func() { cancel(); <-done }()
	deadline := time.Now().Add(10 * time.Second)
	for {
		item := c.request("GET", "/api/v1/kb/"+common+"/documents/"+doc, desktop.AccessToken, "", nil, 200)
		if item.String("status") == "learned" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("文档未完成学习: %v", item)
		}
		time.Sleep(50 * time.Millisecond)
	}
	search := resource.Object{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": resource.Object{"name": "kb_search", "arguments": resource.Object{"kb_ids": []string{common}, "query": "paritydocument"}}}
	for _, cl := range clients {
		t.Run(cl.name, func(t *testing.T) {
			c := parityClient{t, h, cookie}
			for _, path := range []string{"/models", "/rules", "/skills", "/experts", "/connectors", "/design-resources/config"} {
				c.request("GET", "/api/v1"+path, cl.token, "", nil, 200)
			}
			for _, id := range []string{common, sharedID} {
				if c.request("GET", "/api/v1/kb/"+id, cl.token, "", nil, 200).String("id") != id {
					t.Fatal("选库不一致")
				}
			}
			c.request("POST", "/api/v1/kb/"+sharedID+"/documents", cl.token, "", resource.Object{"title": "禁止写入", "content": "内容"}, 403)
			reply := c.request("POST", "/mcp/kb", cl.key, "", search, 200)
			result := reply["result"].(map[string]any)
			items := result["structuredContent"].(map[string]any)["items"].([]any)
			if len(items) != 1 || items[0].(map[string]any)["document_id"] != doc {
				t.Fatalf("检索未命中同一篇文档: %v", result)
			}
			if cl.machine != "" {
				c.request("GET", "/api/v1/users", cl.token, "", nil, 403)
				for _, other := range clients {
					if other.machine != "" && other.machine != cl.machine {
						c.request("POST", "/api/v1/design-resources/token", cl.token, "", resource.Object{"target": "monkeyai-media", "machine_id": other.machine}, 403)
					}
				}
			}
		})
	}
	victim := clients[2]
	c.request("POST", "/api/v1/endpoints/"+victim.machine+"/revoke", desktop.AccessToken, "", nil, 200)
	c.request("GET", "/api/v1/kb/"+common, victim.token, "", nil, 401)
	c.request("POST", "/mcp/kb", victim.key, "", search, 401)
	c.request("POST", "/oauth/token", "", "", url.Values{"grant_type": {"refresh_token"}, "client_id": {identity.RuntimeClientID}, "refresh_token": {victim.refresh}}, 400)
	c.request("GET", "/api/v1/kb/"+common, clients[1].token, "", nil, 200)
}
