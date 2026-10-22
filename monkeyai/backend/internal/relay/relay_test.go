package relay

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
	"uuid"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/endpoint"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/coder/websocket"
)

func TestRelayConnectionProxyRotationAndRevocation(t *testing.T) {
	f := newFixture(t)
	runtime := f.runtime(t)
	scopes := []string{"session:read", "session:control", "files:read", "files:write"}
	connection := f.connection(t, runtime.hello.MachineID, ConnectionRequest{Scopes: &scopes, SupportedProtocols: runtime.hello.Protocols}, f.token)
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	ws, _, err := websocket.Dial(ctx, strings.Replace(f.server.URL, "http", "ws", 1)+"/api/v1/endpoints/"+runtime.hello.MachineID+"/proxy/acp", &websocket.DialOptions{Subprotocols: []string{"monkeyai.v1", "monkeyai.token." + connection.Ticket}})
	if err != nil {
		t.Fatal(err)
	}
	defer ws.CloseNow()
	if err = ws.Write(ctx, websocket.MessageText, []byte(`{"jsonrpc":"2.0","id":7,"method":"session/list"}`)); err != nil {
		t.Fatal(err)
	}
	_, message, err := ws.Read(ctx)
	if err != nil || !strings.Contains(string(message), `"id":7`) {
		t.Fatalf("ACP 转发失败：%s %v", message, err)
	}
	filePath := "/files/" + f.fileToken(t, runtime, "test.txt") + "/test.txt"
	read := func(ticket, p string, want int) {
		t.Helper()
		req, _ := http.NewRequestWithContext(ctx, "GET", f.server.URL+"/api/v1/endpoints/"+runtime.hello.MachineID+"/proxy"+p, nil)
		req.Header.Set("Authorization", "Bearer "+ticket)
		req.Header.Set("X-MAI-Role", "host")
		req.Header.Set("Cookie", "private=secret")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != want {
			t.Fatalf("代理 status=%d want=%d body=%s", resp.StatusCode, want, body)
		}
		if want == 200 && resp.Header.Get("X-Target-Path") != p {
			t.Fatal("路径被重复拼接")
		}
		if resp.Header.Get("Set-Cookie") != "" {
			t.Fatal("不应透传执行端 cookie")
		}
	}
	read(connection.Ticket, filePath, 200)
	read(connection.Ticket, "/host/manage", 403)
	rotated := f.connection(t, runtime.hello.MachineID, ConnectionRequest{ConnectionID: connection.ConnectionID}, f.token)
	if rotated.ConnectionID != connection.ConnectionID || rotated.TicketVersion != 2 || rotated.Ticket == connection.Ticket {
		t.Fatal("票据未原子轮换")
	}
	read(connection.Ticket, filePath, 200)
	if err = ws.Write(ctx, websocket.MessageText, []byte("轮换后仍观察")); err != nil {
		t.Fatal(err)
	}
	if _, _, err = ws.Read(ctx); err != nil {
		t.Fatal(err)
	}
	narrow := []string{"files:read"}
	restricted := f.connection(t, runtime.hello.MachineID, ConnectionRequest{ConnectionID: connection.ConnectionID, Scopes: &narrow}, f.token)
	read(rotated.Ticket, filePath, 401)
	read(restricted.Ticket, filePath, 200)
	if _, _, err = ws.Read(ctx); err == nil {
		t.Fatal("收窄后旧 ACP 流未关闭")
	}
	req, _ := http.NewRequestWithContext(ctx, "DELETE", f.server.URL+"/api/v1/endpoints/"+runtime.hello.MachineID, nil)
	req.Header.Set("Authorization", "Bearer "+f.token)
	req.Header.Set("If-Match", "1")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 204 {
		t.Fatalf("撤销状态=%d", resp.StatusCode)
	}
	read(restricted.Ticket, filePath, 401)
	if valid, err := f.ids.VerifyGrant(ctx, runtimePrincipal(f, runtime)); err != nil || !valid {
		t.Fatalf("撤销托管远程不应撤销账号：%v", err)
	}
}

func runtimePrincipal(f *fixture, r *runtimeFixture) identity.Principal {
	return identity.Principal{UserID: f.user, ClientID: "monkeyai-desktop", GrantID: f.grant, Audience: identity.Audience, Purpose: "user", RevocationVersion: 1}
}

func TestRelayFileGrantAndUpload(t *testing.T) {
	f := newFixture(t)
	runtime := f.runtime(t)
	scopes := []string{"files:read", "files:write"}
	connection := f.connection(t, runtime.hello.MachineID, ConnectionRequest{Scopes: &scopes, SupportedProtocols: runtime.hello.Protocols}, f.token)
	payload := strings.Repeat("流式上传", 10000)
	req, _ := http.NewRequestWithContext(t.Context(), "PUT", f.server.URL+"/api/v1/endpoints/"+runtime.hello.MachineID+"/proxy/uploads/test", strings.NewReader(payload))
	req.Header.Set("Authorization", "Bearer "+connection.Ticket)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 200 || string(body) != payload {
		t.Fatal("上传内容不完整")
	}
	now := time.Now().UTC()
	grant := FileGrant{Version: 1, ServerID: f.s.config.ServerID, OwnerUserID: f.user, MachineID: runtime.hello.MachineID, SessionID: uuid.New().String(), Path: "output/test.html", Scope: "file", KeyID: endpoint.KeyID(runtime.private.Public().(ed25519.PublicKey)), GrantVersion: runtime.ready.GrantVersion, IssuedAt: now, ExpiresAt: now.Add(5 * time.Minute)}
	data, _ := json.Marshal(grant)
	message, _ := FileGrantBytes(grant)
	raw := base64.RawURLEncoding.EncodeToString(data) + "." + base64.RawURLEncoding.EncodeToString(ed25519.Sign(runtime.private, message))
	read := func(p string, want int) {
		req, _ := http.NewRequestWithContext(t.Context(), "GET", f.server.URL+"/endpoints/"+grant.MachineID+"/files/"+raw+"/"+p, nil)
		req.Host = "localhost"
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		io.Copy(io.Discard, resp.Body)
		if resp.StatusCode != want {
			t.Fatalf("文件 status=%d want=%d", resp.StatusCode, want)
		}
		if want == 200 && resp.Header.Get("Content-Disposition") != "attachment" {
			t.Fatal("共享 origin 应交付下载")
		}
	}
	read(grant.Path, 200)
	read("output/other.html", 403)
}

func TestRelayLeaseGraceAndHardCutoff(t *testing.T) {
	f := newFixture(t)
	runtime := f.runtime(t)
	scopes := []string{"session:read"}
	connection := f.connection(t, runtime.hello.MachineID, ConnectionRequest{Scopes: &scopes, SupportedProtocols: runtime.hello.Protocols}, f.token)
	route := f.s.current(target{f.user, runtime.hello.MachineID})
	a := &access{id: connection.ConnectionID, clientGrant: f.grant, accessVersion: 1, scopes: scopes, grantVersion: runtime.ready.GrantVersion, expiresAt: time.Now().Add(15 * time.Minute), verifiedAt: time.Now().Add(-90 * time.Second)}
	f.s.mu.Lock()
	route.streams[a] = struct{}{}
	f.s.mu.Unlock()
	defer func() { f.s.mu.Lock(); delete(route.streams, a); f.s.mu.Unlock() }()
	if _, err := f.pool.Exec(t.Context(), "ALTER TABLE device_client_connections RENAME TO inaccessible_connections"); err != nil {
		t.Fatal(err)
	}
	defer f.pool.Exec(context.Background(), "ALTER TABLE inaccessible_connections RENAME TO device_client_connections")
	message := LeaseRequest{Type: "access_lease_request", Authorization: FileAuthorization{ServerID: f.s.config.ServerID, OwnerUserID: f.user, MachineID: runtime.hello.MachineID, ConnectionID: connection.ConnectionID, ClientGrantID: f.grant, GrantVersion: runtime.ready.GrantVersion, AccessVersion: 1, LeaseEpoch: runtime.ready.LeaseEpoch, Scopes: scopes}, Nonce: "nonce", LeaseSeq: 1, BootID: runtime.hello.BootID}
	result, status := f.s.lease(t.Context(), route, message)
	decoded, ok := verifyWire(f.s.key.Public().(ed25519.PublicKey), result.Signed)
	if status != 200 || !ok {
		t.Fatal("90 秒故障应允许原连接续租")
	}
	var payload map[string]any
	json.Unmarshal(decoded, &payload)
	if payload["verification_state"] != "grace" || payload["ttl_ms"].(float64) > 60000 {
		t.Fatalf("宽限 TTL 无效：%v", payload)
	}
	a.mu.Lock()
	a.verifiedAt = time.Now().Add(-181 * time.Second)
	a.mu.Unlock()
	message.RequireFresh = true
	message.LeaseSeq++
	fresh, freshStatus := f.s.lease(t.Context(), route, message)
	if freshStatus != 503 || fresh.Code != "authorization_state_unavailable" {
		t.Fatalf("新访问不能宽限: %+v", fresh)
	}
	message.RequireFresh = false
	message.LeaseSeq++
	result2, _ := f.s.lease(t.Context(), route, message)
	if result2.Signed != "" {
		t.Fatal("超过 180 秒不能续签")
	}
	a.mu.Lock()
	closed := a.closed
	a.mu.Unlock()
	if !closed {
		t.Fatal("超期应关闭旧访问")
	}
	message.Authorization.ConnectionID = uuid.New().String()
	result3, _ := f.s.lease(t.Context(), route, message)
	if result3.Signed != "" {
		t.Fatal("不能凭缓存签发新连接租约")
	}
}

func TestRelayProofAndBootConflict(t *testing.T) {
	f := newFixture(t)
	runtime := f.runtime(t)
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	attempt := func(hello Hello, alter bool) string {
		ws, _, err := websocket.Dial(ctx, strings.Replace(f.server.URL, "http", "ws", 1)+"/api/v1/endpoint-bridge?channel_kind=control&tunnel_version=1", &websocket.DialOptions{HTTPHeader: http.Header{"Authorization": {"Bearer " + f.token}}})
		if err != nil {
			t.Fatal(err)
		}
		defer ws.CloseNow()
		writeWS(ctx, ws, hello)
		var challenge Challenge
		if readWS(ctx, ws, &challenge) != nil {
			t.Fatal("challenge 缺失")
		}
		if alter {
			challenge.Nonce = "tampered"
		}
		message, _ := ProofBytes(hello, challenge)
		writeWS(ctx, ws, Proof{Type: "proof", ChallengeID: challenge.ChallengeID, Signature: base64.RawURLEncoding.EncodeToString(ed25519.Sign(runtime.private, message))})
		var response map[string]any
		if readWS(ctx, ws, &response) != nil {
			return "closed"
		}
		if code, ok := response["code"].(string); ok {
			return code
		}
		return response["type"].(string)
	}
	other := runtime.hello
	other.BootID = uuid.New().String()
	if got := attempt(other, false); got != "device_process_conflict" {
		t.Fatalf("不同 boot 不应抢占：%s", got)
	}
	if got := attempt(runtime.hello, true); got != "invalid_device_proof" {
		t.Fatalf("篡改证明应返回明确错误：%s", got)
	}
	if f.s.current(target{f.user, runtime.hello.MachineID}) == nil {
		t.Fatal("失败证明不应清除活动路由")
	}
}

func TestRelayControllerLogoutClosesOnlyItsStreams(t *testing.T) {
	f := newFixture(t)
	runtime := f.runtime(t)
	token, grant := f.mint(t, f.user, []string{"device:connect", "session:read"})
	scopes := []string{"session:read"}
	connection := f.connection(t, runtime.hello.MachineID, ConnectionRequest{Scopes: &scopes, SupportedProtocols: runtime.hello.Protocols}, token)
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	ws, _, err := websocket.Dial(ctx, strings.Replace(f.server.URL, "http", "ws", 1)+"/api/v1/endpoints/"+runtime.hello.MachineID+"/proxy/acp", &websocket.DialOptions{HTTPHeader: http.Header{"Authorization": {"Bearer " + connection.Ticket}}})
	if err != nil {
		t.Fatal(err)
	}
	defer ws.CloseNow()
	if err := f.ids.RevokeGrant(ctx, grant, "test_logout"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := ws.Read(ctx); err == nil {
		t.Fatal("退出后目标流未关闭")
	}
	if f.s.current(target{f.user, runtime.hello.MachineID}) == nil {
		t.Fatal("控制端退出不应关闭另一个安装的执行隧道")
	}
	request := LeaseRequest{Type: "access_lease_request", Authorization: FileAuthorization{ServerID: f.s.config.ServerID, OwnerUserID: f.user, MachineID: runtime.hello.MachineID, ConnectionID: connection.ConnectionID, ClientGrantID: grant, GrantVersion: runtime.ready.GrantVersion, AccessVersion: 1, LeaseEpoch: runtime.ready.LeaseEpoch, Scopes: scopes}, Nonce: "nonce", LeaseSeq: runtime.sequence.Add(1), BootID: runtime.hello.BootID}
	result, _ := f.s.lease(ctx, f.s.current(target{f.user, runtime.hello.MachineID}), request)
	if result.Signed != "" {
		t.Fatal("已撤销连接不能续租")
	}
}

func TestRelayConnectionLimitAndIsolation(t *testing.T) {
	f := newFixture(t)
	runtime := f.runtime(t)
	scopes := []string{"session:read"}
	for range 8 {
		f.connection(t, runtime.hello.MachineID, ConnectionRequest{Scopes: &scopes, SupportedProtocols: runtime.hello.Protocols}, f.token)
	}
	body, _ := json.Marshal(ConnectionRequest{Scopes: &scopes, SupportedProtocols: runtime.hello.Protocols})
	call := func(token string, want int) {
		req, _ := http.NewRequestWithContext(t.Context(), "POST", f.server.URL+"/api/v1/endpoints/"+runtime.hello.MachineID+"/connections", strings.NewReader(string(body)))
		req.Header.Set("Authorization", "Bearer "+token)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != want {
			t.Fatalf("连接隔离状态=%d want=%d", resp.StatusCode, want)
		}
	}
	call(f.token, 429)
	other := uuid.New().String()
	if _, err := f.pool.Exec(t.Context(), "INSERT INTO users(id,name,email) VALUES($1,'其他用户',$2)", other, other+"@example.com"); err != nil {
		t.Fatal(err)
	}
	token, _ := f.mint(t, other, []string{"device:connect", "session:read"})
	call(token, 404)
}

func TestRelayDataFailureAndOldEpochCleanup(t *testing.T) {
	f := newFixture(t)
	runtime := f.runtime(t)
	key := target{f.user, runtime.hello.MachineID}
	old := f.s.current(key)
	if err := runtime.data.Close(); err != nil {
		t.Fatal(err)
	}
	if f.s.current(key) != old {
		t.Fatal("数据通道失败不应清除控制路由")
	}
	ws, ready := f.handshake(t, runtime.hello, runtime.private, "control", f.token)
	defer ws.CloseNow()
	if ready.LeaseEpoch <= runtime.ready.LeaseEpoch || ready.GrantVersion != runtime.ready.GrantVersion {
		t.Fatal("同 boot 重连只应切换 epoch")
	}
	f.s.closeRoute(old)
	f.s.mu.Lock()
	current := f.s.routes[key]
	f.s.mu.Unlock()
	if current == nil || current == old || current.state.LeaseEpoch != ready.LeaseEpoch {
		t.Fatal("旧 epoch 清理覆盖了新路由")
	}
}

func TestRelaySSEHeadersAndFileRange(t *testing.T) {
	f := newFixture(t)
	runtime := f.runtime(t)
	scopes := []string{"session:control", "files:read"}
	connection := f.connection(t, runtime.hello.MachineID, ConnectionRequest{Scopes: &scopes, SupportedProtocols: runtime.hello.Protocols}, f.token)
	request, _ := http.NewRequestWithContext(t.Context(), "GET", f.server.URL+"/api/v1/endpoints/"+runtime.hello.MachineID+"/proxy/cap/test/mcp", nil)
	request.Header.Set("Authorization", "Bearer "+connection.Ticket)
	request.Header.Set("Mcp-Session-Id", "mcp-session")
	request.Header.Set("MCP-Protocol-Version", "2025-11-25")
	request.Header.Set("Last-Event-ID", "previous")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(response.Body)
	response.Body.Close()
	if response.Header.Get("Content-Type") != "text/event-stream" || response.Header.Get("Mcp-Session-Id") != "mcp-session" || response.Header.Get("MCP-Protocol-Version") != "2025-11-25" || response.Header.Get("X-Last-Event-ID") != "previous" || !strings.Contains(string(body), "data: second") {
		t.Fatal("MCP SSE 转发丢失会话、版本、恢复头或事件")
	}
	raw := f.fileToken(t, runtime, "range.txt")
	request, _ = http.NewRequestWithContext(t.Context(), "GET", f.server.URL+"/api/v1/endpoints/"+runtime.hello.MachineID+"/proxy/files/"+raw+"/range.txt", nil)
	request.Header.Set("Authorization", "Bearer "+connection.Ticket)
	request.Header.Set("Range", "bytes=2-5")
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	body, _ = io.ReadAll(response.Body)
	response.Body.Close()
	if response.StatusCode != 206 || string(body) != "2345" || response.Header.Get("Content-Range") != "bytes 2-5/10" {
		t.Fatal("文件 Range 响应或原状态码丢失")
	}
}

func TestDataOverloadLeavesControlChannelAvailable(t *testing.T) {
	f := newFixture(t)
	runtime := f.runtime(t)
	scopes := []string{"session:read", "files:write"}
	connection := f.connection(t, runtime.hello.MachineID, ConnectionRequest{Scopes: &scopes, SupportedProtocols: runtime.hello.Protocols}, f.token)
	route := f.s.current(target{f.user, runtime.hello.MachineID})
	f.s.mu.Lock()
	budget := route.dataBudget
	f.s.mu.Unlock()
	permits := make([]*dataPermit, 0, 15)
	for range 15 {
		permit := budget.reserve(false, false, func() {})
		if permit == nil {
			t.Fatal("未能占满常规数据流")
		}
		permits = append(permits, permit)
	}
	defer func() {
		for _, permit := range permits {
			permit.release()
		}
	}()
	request, _ := http.NewRequestWithContext(t.Context(), "PUT", f.server.URL+"/api/v1/endpoints/"+runtime.hello.MachineID+"/proxy/uploads/test", strings.NewReader("data"))
	request.Header.Set("Authorization", "Bearer "+connection.Ticket)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 429 || response.Header.Get("Retry-After") == "" {
		t.Fatal("数据流超载没有受控拒绝")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
	defer cancel()
	ws, _, err := websocket.Dial(ctx, strings.Replace(f.server.URL, "http", "ws", 1)+"/api/v1/endpoints/"+runtime.hello.MachineID+"/proxy/acp", &websocket.DialOptions{HTTPHeader: http.Header{"Authorization": {"Bearer " + connection.Ticket}}})
	if err != nil {
		t.Fatal(err)
	}
	defer ws.CloseNow()
	if err = ws.Write(ctx, websocket.MessageText, []byte("cancel")); err != nil {
		t.Fatal(err)
	}
	_, body, err := ws.Read(ctx)
	if err != nil || string(body) != "cancel" {
		t.Fatal("数据通道饱和阻塞了控制操作")
	}
}

func TestRelayProtocolRejectsInvalidMessages(t *testing.T) {
	for _, value := range []string{`{"type":"hello","type":"proof"}`, `{"unknown":1}`, `[]`, `{} {}`, string([]byte{0xff})} {
		var hello Hello
		if decodeMessage([]byte(value), &hello) == nil {
			t.Fatalf("接受无效消息 %q", value)
		}
	}
	for _, p := range []string{"/../host", "/files/../host", "//host", "/files/a\\b"} {
		if safePath(p) {
			t.Fatalf("危险路径 %s", p)
		}
	}
	if _, _, allowed := routeScope("POST", "/host/manage"); allowed {
		t.Fatal("本机宿主管理不能代理")
	}
}
