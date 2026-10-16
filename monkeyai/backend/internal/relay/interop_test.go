package relay

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"
	"uuid"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/endpoint"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/relay/sqlc"
	"github.com/coder/websocket"
)

func TestDefaultTicketBusinessScopes(t *testing.T) {
	f := newFixture(t)
	runtime := f.runtime(t)
	conn := f.connection(t, runtime.hello.MachineID, ConnectionRequest{SupportedProtocols: runtime.hello.Protocols}, f.token)
	want := []string{"files:read", "files:write", "resources:manage", "session:control", "session:read"}
	if !slices.Equal(conn.Scopes, want) {
		t.Fatalf("缺省业务权限不应包括设备管理: %v", conn.Scopes)
	}
}

func TestDesktopProxyOriginsRoutesAndCORS(t *testing.T) {
	f := newFixture(t)
	runtime := f.runtime(t)
	f.s.config.DesktopOrigins = []string{"http://localhost:5173"}
	scopes := []string{"files:read", "files:write", "resources:manage", "session:control", "session:read"}
	connection := f.connection(t, runtime.hello.MachineID, ConnectionRequest{Scopes: &scopes, SupportedProtocols: runtime.hello.Protocols}, f.token)
	for _, origin := range []string{"app://monkeyai", "http://localhost:5173"} {
		ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
		ws, _, err := websocket.Dial(ctx, strings.Replace(f.server.URL, "http", "ws", 1)+"/api/v1/endpoints/"+runtime.hello.MachineID+"/proxy/acp", &websocket.DialOptions{HTTPHeader: http.Header{"Origin": {origin}}, Subprotocols: []string{"monkeyai.v1", "monkeyai.token." + connection.Ticket}})
		if err != nil {
			cancel()
			t.Fatal(err)
		}
		if ws.Subprotocol() != "monkeyai.v1" {
			t.Fatal("没有回选业务子协议")
		}
		ws.CloseNow()
		cancel()
	}
	base := f.server.URL + "/api/v1/endpoints/" + runtime.hello.MachineID + "/proxy"
	for _, path := range []string{"/read/session", "/read/config", "/read/interaction", "/write/resource"} {
		req, _ := http.NewRequestWithContext(t.Context(), "POST", base+path, strings.NewReader(`{}`))
		req.Header.Set("Origin", "app://monkeyai")
		req.Header.Set("Authorization", "Bearer "+connection.Ticket)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode != 200 || resp.Header.Get("Access-Control-Allow-Origin") != "app://monkeyai" {
			t.Fatalf("%s: %d %s", path, resp.StatusCode, body)
		}
	}
	req, _ := http.NewRequestWithContext(t.Context(), "OPTIONS", base+"/uploads/u1", nil)
	req.Header.Set("Origin", "app://monkeyai")
	req.Header.Set("Access-Control-Request-Method", "PUT")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 204 || !strings.Contains(resp.Header.Get("Access-Control-Allow-Headers"), "Upload-Session-ID") || !strings.Contains(resp.Header.Get("Access-Control-Expose-Headers"), "Mcp-Session-Id") {
		t.Fatal("上传或 MCP CORS 不完整")
	}
	req.Header.Set("Origin", "http://localhost:9999")
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 403 {
		t.Fatal("未配置来源不能放行")
	}
	req, _ = http.NewRequestWithContext(t.Context(), "PUT", base+"/uploads/test", strings.NewReader("data"))
	req.Header.Set("Origin", "app://monkeyai")
	req.Header.Set("Authorization", "Bearer "+connection.Ticket)
	req.Header.Set("Upload-Session-ID", "upload-session")
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	uploadBody, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 200 || string(uploadBody) != "data" || resp.Header.Get("Upload-Session-ID") != "upload-session" || resp.Header.Get("Upload-Offset") != "4" {
		t.Fatal("上传请求和响应状态头丢失")
	}
	narrow := []string{"resources:manage"}
	restricted := f.connection(t, runtime.hello.MachineID, ConnectionRequest{ConnectionID: connection.ConnectionID, Scopes: &narrow}, f.token)
	req, _ = http.NewRequestWithContext(t.Context(), "POST", base+"/write/resource", strings.NewReader(`{}`))
	req.Header.Set("Authorization", "Bearer "+restricted.Ticket)
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 403 {
		t.Fatal("资源写入必须同时拥有 session:read")
	}
	if responseTimeout("/read/session") != 150*time.Second || responseTimeout("/write/resource") != 225*time.Second {
		t.Fatal("业务等待期限错误")
	}
}

func leaseInput(f *fixture, r *runtimeFixture, row sqlc.GetConnectionRow) LeaseRequest {
	return LeaseRequest{Type: "access_lease_request", Authorization: f.s.authorization(f.s.current(target{f.user, r.hello.MachineID}), row), Nonce: uuid.New().String(), LeaseSeq: r.sequence.Add(1), BootID: r.hello.BootID, RequireFresh: true}
}
func leaseHTTP(t *testing.T, r *runtimeFixture, in LeaseRequest) (leaseResponse, int) {
	t.Helper()
	body, _ := json.Marshal(in)
	resp, err := r.client.Post("http://relay.internal/_control/access-lease", "application/json", strings.NewReader(string(body)))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var result leaseResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	return result, resp.StatusCode
}
func TestCompleteLeaseBindingAndFreshFailure(t *testing.T) {
	f := newFixture(t)
	runtime := f.runtime(t)
	scopes := []string{"files:read", "session:read"}
	conn := f.connection(t, runtime.hello.MachineID, ConnectionRequest{Scopes: &scopes, SupportedProtocols: runtime.hello.Protocols}, f.token)
	row, err := sqlc.New(f.pool).GetConnection(t.Context(), conn.ConnectionID)
	if err != nil {
		t.Fatal(err)
	}
	in := leaseInput(f, runtime, row)
	result, status := leaseHTTP(t, runtime, in)
	if status != 200 || result.Signed == "" {
		t.Fatalf("完整租约失败: %d %+v", status, result)
	}
	replay, status := leaseHTTP(t, runtime, in)
	if status != 400 || replay.Code != "invalid_tunnel_message" {
		t.Fatal("重复序号应拒绝")
	}
	in = leaseInput(f, runtime, row)
	in.Authorization.AccessVersion++
	revoked, status := leaseHTTP(t, runtime, in)
	payload, ok := verifyWire(f.s.key.Public().(ed25519.PublicKey), revoked.Revocation)
	if status != 200 || !ok {
		t.Fatal("旧权限代次必须签名撤销")
	}
	var claim map[string]any
	json.Unmarshal(payload, &claim)
	if claim["authorization"] != nil || claim["connection_id"] != row.ID || claim["boot_id"] != runtime.hello.BootID {
		t.Fatal("撤销身份必须在顶层")
	}
	if _, err := f.pool.Exec(t.Context(), "ALTER TABLE device_client_connections RENAME TO unavailable_connections"); err != nil {
		t.Fatal(err)
	}
	defer f.pool.Exec(context.Background(), "ALTER TABLE unavailable_connections RENAME TO device_client_connections")
	in = leaseInput(f, runtime, row)
	result, status = leaseHTTP(t, runtime, in)
	if status != 503 || result.Code != "authorization_state_unavailable" || result.Revocation != "" {
		t.Fatalf("实时核验故障不能宽限或伪装撤销: %d %+v", status, result)
	}
}
func TestTwoControllersRevocationKeepsOtherObserver(t *testing.T) {
	f := newFixture(t)
	runtime := f.runtime(t)
	scopes := []string{"session:read"}
	open := func(token string) *websocket.Conn {
		t.Helper()
		conn := f.connection(t, runtime.hello.MachineID, ConnectionRequest{Scopes: &scopes, SupportedProtocols: runtime.hello.Protocols}, token)
		ws, _, err := websocket.Dial(t.Context(), strings.Replace(f.server.URL, "http", "ws", 1)+"/api/v1/endpoints/"+runtime.hello.MachineID+"/proxy/acp", &websocket.DialOptions{HTTPHeader: http.Header{"Authorization": {"Bearer " + conn.Ticket}}})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { ws.CloseNow() })
		return ws
	}
	token, grant := f.mint(t, f.user, []string{"device:connect", "session:read"})
	first := open(token)
	second := open(f.token)
	if err := f.ids.RevokeGrant(t.Context(), grant, "test"); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
	defer cancel()
	if _, _, err := first.Read(ctx); err == nil {
		t.Fatal("被撤销连接没有关闭")
	}
	if err := second.Write(ctx, websocket.MessageText, []byte("still active")); err != nil {
		t.Fatal(err)
	}
	if _, body, err := second.Read(ctx); err != nil || string(body) != "still active" {
		t.Fatal("撤销单控制端影响另一观察者", err)
	}
	select {
	case event := <-runtime.events:
		if event["type"] != "revocation" {
			t.Fatalf("不是撤销事件: %v", event)
		}
	case <-ctx.Done():
		t.Fatal("没有签名撤销事件")
	}
	if f.s.current(target{f.user, runtime.hello.MachineID}) == nil {
		t.Fatal("执行端被错误撤销")
	}
}
func TestConditionalDeleteAndRestoreGeneration(t *testing.T) {
	f := newFixture(t)
	runtime := f.runtime(t)
	remove := func(version int64, want int) {
		t.Helper()
		req, _ := http.NewRequestWithContext(t.Context(), "DELETE", f.server.URL+"/api/v1/endpoints/"+runtime.hello.MachineID, nil)
		req.Header.Set("Authorization", "Bearer "+f.token)
		req.Header.Set("If-Match", strconv.FormatInt(version, 10))
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode != want {
			t.Fatalf("DELETE %d: %d %s", version, resp.StatusCode, body)
		}
	}
	version := runtime.ready.RegistrationVersion
	remove(version-1, 412)
	remove(version, 204)
	remove(version, 204)
	runtime.mux.Close()
	runtime.data.Close()
	state, err := f.s.devices.State(t.Context(), f.user, runtime.hello.MachineID)
	if err != nil {
		t.Fatal(err)
	}
	public := runtime.private.Public().(ed25519.PublicKey)
	restored, err := f.s.devices.Enroll(t.Context(), runtimePrincipalWithScopes(f, runtime), endpoint.Enrollment{MachineID: runtime.hello.MachineID, PublicKey: public, DisplayName: "恢复", Platform: "macos", Arch: "arm64", Intent: "publish", DeploymentMode: "desktop_managed", RestoreRevoked: true, Protocols: runtime.hello.Protocols}, state.RegistrationVersion)
	if err != nil {
		t.Fatal(err)
	}
	if restored.RegistrationVersion <= state.RegistrationVersion {
		t.Fatal("恢复没有推进登记代次")
	}
	remove(version, 412)
	remove(state.RegistrationVersion, 412)
	remove(restored.RegistrationVersion, 204)
}
func runtimePrincipalWithScopes(f *fixture, r *runtimeFixture) identity.Principal {
	p := runtimePrincipal(f, r)
	p.Scopes = []string{"device:bind", "device:publish", "device:manage"}
	return p
}

func fg1(t *testing.T, f *fixture, r *runtimeFixture, row sqlc.GetConnectionRow, path string) string {
	t.Helper()
	now := time.Now().UnixMilli()
	in := FileGrantV1{Type: "monkeyai.file-grant.v1", Version: 1, KeyID: endpoint.KeyID(r.private.Public().(ed25519.PublicKey)), Authorization: f.s.authorization(f.s.current(target{f.user, r.hello.MachineID}), row), SessionID: "legacy-session-name", Path: path, Purpose: "download", IssuedAt: now, ExpiresAt: now + 300000}
	raw, _ := json.Marshal(in)
	message, _ := FileGrantV1Bytes(in)
	return "fg1." + base64.RawURLEncoding.EncodeToString(raw) + "." + base64.RawURLEncoding.EncodeToString(ed25519.Sign(r.private, message))
}
func TestIndependentFG1PathsNarrowingAndDatabaseFailure(t *testing.T) {
	f := newFixture(t)
	runtime := f.runtime(t)
	scopes := []string{"files:read", "session:read"}
	conn := f.connection(t, runtime.hello.MachineID, ConnectionRequest{Scopes: &scopes, SupportedProtocols: runtime.hello.Protocols}, f.token)
	row, err := sqlc.New(f.pool).GetConnection(t.Context(), conn.ConnectionID)
	if err != nil {
		t.Fatal(err)
	}
	read := func(raw, path, method string, want int) {
		t.Helper()
		req, _ := http.NewRequestWithContext(t.Context(), method, f.server.URL+"/endpoints/"+runtime.hello.MachineID+"/files/"+raw+"/"+path, nil)
		req.Host = "localhost"
		if method == "GET" {
			req.Header.Set("Range", "bytes=2-5")
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode != want {
			t.Fatalf("文件 %s %s: %d %s", method, path, resp.StatusCode, body)
		}
		if want == 206 && (string(body) != "2345" || resp.Header.Get("Content-Range") != "bytes 2-5/10") {
			t.Fatal("Range 未保留")
		}
	}
	for _, path := range []string{"普通文件.txt", "中文 空格.txt", "100%.txt", "encoded%2fname.txt"} {
		raw := fg1(t, f, runtime, row, path)
		read(raw, url.PathEscape(path), "GET", 206)
		read(raw, url.PathEscape(path), "HEAD", 200)
	}
	old := fg1(t, f, runtime, row, "100%.txt")
	read(old, "other.txt", "GET", 403)
	read(old, "100%2f.txt", "GET", 400)
	narrow := []string{"files:read"}
	f.connection(t, runtime.hello.MachineID, ConnectionRequest{ConnectionID: conn.ConnectionID, Scopes: &narrow}, f.token)
	read(old, "100%25.txt", "GET", 403)
	row, err = sqlc.New(f.pool).GetConnection(t.Context(), conn.ConnectionID)
	if err != nil {
		t.Fatal(err)
	}
	newer := fg1(t, f, runtime, row, "100%.txt")
	read(newer, "100%25.txt", "GET", 206)
	allowedPath := strings.Repeat("中", 2100) + ".txt"
	largeAllowed := fg1(t, f, runtime, row, allowedPath)
	if len(largeAllowed) <= 8192 || len(largeAllowed) > 12<<10 {
		t.Fatal("没有覆盖大于 8KiB 的合法 token")
	}
	if _, _, err := f.s.verifyFileV1(t.Context(), runtime.hello.MachineID, largeAllowed, "/"+allowedPath); err != nil {
		t.Fatal("12KiB 上限内合法 token 被拒绝", err)
	}
	longPath := strings.Repeat("中", 2600) + ".txt"
	large := fg1(t, f, runtime, row, longPath)
	if len(large) <= 8192 || len(large) > 12<<10 {
		t.Fatal("没有覆盖 8–12KiB token")
	}
	if _, _, err := f.s.verifyFileV1(t.Context(), runtime.hello.MachineID, large, "/"+longPath); err == nil {
		t.Fatal("超过 8KiB 解码载荷应拒绝")
	}
	if _, err = f.pool.Exec(t.Context(), "ALTER TABLE device_client_connections RENAME TO unavailable_connections"); err != nil {
		t.Fatal(err)
	}
	defer f.pool.Exec(context.Background(), "ALTER TABLE unavailable_connections RENAME TO device_client_connections")
	read(newer, "100%25.txt", "GET", 503)
}

func TestHTTPControlIdleBeyond90Seconds(t *testing.T) {
	f := newFixture(t)
	runtime := f.runtime(t)
	select {
	case <-time.After(95 * time.Second):
	case <-t.Context().Done():
		t.Fatal("测试提前取消")
	}
	if f.s.current(target{f.user, runtime.hello.MachineID}) == nil {
		t.Fatal("空闲 95 秒控制端变为离线")
	}
	resp, err := runtime.client.Get("http://relay.internal/_control/status")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var status struct {
		DataOnline bool `json:"data_online"`
	}
	if json.NewDecoder(resp.Body).Decode(&status) != nil || !status.DataOnline {
		t.Fatal("数据通道未保持在线")
	}
	runtime.control.Close()
	deadline := time.Now().Add(6 * time.Second)
	for f.s.current(target{f.user, runtime.hello.MachineID}) != nil && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if f.s.current(target{f.user, runtime.hello.MachineID}) != nil {
		t.Fatal("事件流终止后路由未回收")
	}
}
