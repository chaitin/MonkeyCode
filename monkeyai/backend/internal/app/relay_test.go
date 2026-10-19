package app

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"uuid"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/config"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/relay"
	"github.com/coder/websocket"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type connectorQueryTrace struct{ started chan struct{} }

func (t connectorQueryTrace) TraceQueryStart(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	if strings.Contains(data.SQL, "CleanupOAuthRequests") || strings.Contains(data.SQL, "ListExpiringCredentials") {
		select {
		case t.started <- struct{}{}:
		default:
		}
	}
	return ctx
}
func (connectorQueryTrace) TraceQueryEnd(context.Context, *pgx.Conn, pgx.TraceQueryEndData) {}

func TestRuntimeRelayApplication(t *testing.T) {
	dsn := os.Getenv("MONKEYAI_TEST_DATABASE_URL")
	if dsn == "" || os.Getenv("MONKEYAI_S3_ENDPOINT") == "" {
		t.Skip("需要隔离 PostgreSQL 和 RustFS 测试环境")
	}
	ctx := t.Context()
	root, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(root.Close)
	schema := pgx.Identifier{"test_relay_app_" + strings.ReplaceAll(uuid.New().String(), "-", "")}.Sanitize()
	if _, err = root.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { root.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE") })
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	connectorStarted := make(chan struct{}, 1)
	cfg.ConnConfig.Tracer = connectorQueryTrace{started: connectorStarted}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	paths, err := filepath.Glob("../../migrations/*.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = pool.Exec(ctx, string(data)); err != nil {
			t.Fatal(err)
		}
	}
	var user, grant string
	if err = pool.QueryRow(ctx, "INSERT INTO users(name,email,role) VALUES('集成管理员','runtime-app@example.com','admin') RETURNING id").Scan(&user); err != nil {
		t.Fatal(err)
	}
	if err = pool.QueryRow(ctx, "INSERT INTO oauth_grants(user_id,client_id,scopes,expires_at) VALUES($1,'monkeyai-desktop',$2,now()+interval '1 day') RETURNING id", user, []string{"device:bind", "device:connect", "device:manage", "session:report"}).Scan(&grant); err != nil {
		t.Fatal(err)
	}
	token := "runtime-app-test"
	digest := sha256.Sum256([]byte(token))
	if _, err = pool.Exec(ctx, `INSERT INTO oauth_tokens(user_id,client_id,grant_id,access_token_hash,refresh_token_hash,access_expires_at,refresh_expires_at)
		VALUES($1,'monkeyai-desktop',$2,$3,'test-refresh',now()+interval '1 hour',now()+interval '1 day')`, user, grant, hex.EncodeToString(digest[:])); err != nil {
		t.Fatal(err)
	}
	_, signing, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, _ := x509.MarshalPKCS8PrivateKey(signing)
	keyPath := filepath.Join(t.TempDir(), "signing.pem")
	if err = os.WriteFile(keyPath, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}), 0600); err != nil {
		t.Fatal(err)
	}
	handler, err := newApplicationHandler(ctx, slog.New(slog.NewTextHandler(io.Discard, nil)), pool, config.Config{PublicURL: "http://192.168.1.20:8080", RuntimeRelay: true, RuntimeServerID: uuid.New().String(), RuntimeSigningKeyFile: keyPath, RuntimeFilesOrigin: "http://203.0.113.20:8080"})
	if err != nil {
		t.Fatal(err)
	}
	badState := filepath.Join(t.TempDir(), "not-a-directory")
	if err := os.WriteFile(badState, []byte("blocked"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := newApplicationHandler(ctx, slog.New(slog.NewTextHandler(io.Discard, nil)), pool, config.Config{PublicURL: "http://192.168.1.20:8080", RuntimeRelay: true, RuntimeStateDir: filepath.Join(badState, "runtime")}); err == nil {
		t.Fatal("状态目录不可写时应拒绝初始化")
	}
	select {
	case <-connectorStarted:
		t.Fatal("初始化阶段启动了Connector后台刷新，失败后会访问已关闭连接池")
	case <-time.After(200 * time.Millisecond):
	}
	t.Cleanup(func() {
		app := handler.(*applicationHandler)
		app.relay.Shutdown(context.Background())
		app.endpoints.Shutdown(context.Background())
	})
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	hello := relay.Hello{Type: "hello", TunnelVersion: relay.Version, ChannelKind: "control", MachineID: uuid.New().String(), BootID: uuid.New().String(), ExecutionPublicKey: base64.RawURLEncoding.EncodeToString(public), DisplayName: "身份恢复设备", Platform: "macos", Arch: "arm64", DeploymentMode: "desktop_managed", Intent: "bind_identity", Protocols: map[string][]int{"acp": {1}, "runtime_api": {1}}}
	ws, _, err := websocket.Dial(ctx, strings.Replace(server.URL, "http", "ws", 1)+"/api/v1/endpoint-bridge?channel_kind=control&tunnel_version=1", &websocket.DialOptions{HTTPHeader: http.Header{"Authorization": {"Bearer " + token}}})
	if err != nil {
		t.Fatal(err)
	}
	defer ws.CloseNow()
	write := func(value any) {
		t.Helper()
		data, _ := json.Marshal(value)
		if err := ws.Write(ctx, websocket.MessageText, data); err != nil {
			t.Fatal(err)
		}
	}
	read := func(out any) {
		t.Helper()
		_, data, err := ws.Read(ctx)
		if err != nil || json.Unmarshal(data, out) != nil {
			t.Fatal("应用握手失败")
		}
	}
	write(hello)
	var challenge relay.Challenge
	read(&challenge)
	message, _ := relay.ProofBytes(hello, challenge)
	write(relay.Proof{Type: "proof", ChallengeID: challenge.ChallengeID, Signature: base64.RawURLEncoding.EncodeToString(ed25519.Sign(private, message))})
	var ready relay.Ready
	read(&ready)
	if !ready.Bound || ready.LeaseEpoch != 0 {
		t.Fatal("只认证错误进入业务模式")
	}
	write(relay.ReadyAck{Type: "ready_ack", RegistrationVersion: ready.RegistrationVersion})
	call := func(method, path, body string, version bool, want int) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+token)
		if method == "DELETE" {
			req.Header.Set("If-Match", "1")
		}
		if version {
			req.Header.Set("X-MAI-Runtime-API", "1")
		}
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, req)
		if response.Code != want {
			t.Fatalf("应用路由 status=%d want=%d body=%s", response.Code, want, response.Body.String())
		}
		return response
	}
	legacy := call("GET", "/api/v1/endpoints", "", false, 200)
	if !strings.Contains(legacy.Body.String(), `"items"`) {
		t.Fatal("旧目录形状被破坏")
	}
	modern := call("GET", "/api/v1/endpoints?capability=execute", "", true, 200)
	if !strings.Contains(modern.Body.String(), hello.MachineID) || !strings.Contains(modern.Body.String(), `"remote_access_state":"disabled"`) {
		t.Fatal("新目录或只认证状态无效")
	}
	call("GET", "/api/v1/endpoints/"+hello.MachineID+"/proxy/acp", "", false, 401)
	call("DELETE", "/api/v1/endpoints/"+hello.MachineID, "", false, 204)
	payload, _ := json.Marshal(map[string]any{"state_seq": 0, "session_type": "conversation", "started_at": time.Now().UTC(), "client": map[string]any{"type": "desktop", "machine_id": hello.MachineID, "version": "1"}})
	call("PUT", "/api/v1/sessions/"+uuid.New().String(), string(payload), false, 200)
}
