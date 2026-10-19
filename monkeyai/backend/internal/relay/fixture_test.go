package relay

import (
	"bufio"
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
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
	"uuid"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/endpoint"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/coder/websocket"
	"github.com/go-chi/chi/v5"
	"github.com/hashicorp/yamux"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type fixture struct {
	previewHTML bool
	s           *Service
	ids         *identity.Service
	pool        *pgxpool.Pool
	server      *httptest.Server
	user        string
	token       string
	grant       string
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	return newFixtureOrigin(t, "http://localhost")
}

func newFixtureOrigin(t *testing.T, origin string) *fixture {
	t.Helper()
	dsn := os.Getenv("MONKEYAI_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("设置 MONKEYAI_TEST_DATABASE_URL 运行真实中转测试")
	}
	root, err := pgxpool.New(t.Context(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(root.Close)
	schema := pgx.Identifier{"test_relay_" + strings.ReplaceAll(uuid.New().String(), "-", "")}.Sanitize()
	if _, err = root.Exec(t.Context(), "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { root.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE") })
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(t.Context(), cfg)
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
		if _, err = pool.Exec(t.Context(), string(data)); err != nil {
			t.Fatalf("%s: %v", path, err)
		}
	}
	user := uuid.New().String()
	if _, err = pool.Exec(t.Context(), "INSERT INTO users(id,name,email) VALUES($1,'中转测试',$2)", user, user+"@example.com"); err != nil {
		t.Fatal(err)
	}
	_, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(private)
	if err != nil {
		t.Fatal(err)
	}
	keyFile := filepath.Join(t.TempDir(), "access.pem")
	if err = os.WriteFile(keyFile, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}), 0600); err != nil {
		t.Fatal(err)
	}
	ids := identity.NewService(pool, nil, origin)
	s, err := NewService(pool, ids, endpoint.NewExecution(pool, ids), slog.New(slog.NewTextHandler(io.Discard, nil)), Config{ServerID: uuid.New().String(), PublicURL: origin, FilesOrigin: origin, SigningKeyFile: keyFile})
	if err != nil {
		t.Fatal(err)
	}
	ids.WithGrantRevoker(s.InvalidateGrant)
	f := &fixture{s: s, ids: ids, pool: pool, user: user}
	f.token, f.grant = f.mint(t, user, []string{"device:bind", "device:publish", "device:connect", "device:manage", "session:report", "session:read", "session:control", "files:read", "files:write", "resources:manage"})
	router := chi.NewRouter()
	s.Register(router)
	server := httptest.NewServer(router)
	f.server = server
	t.Cleanup(func() { s.Shutdown(context.Background()); server.Close() })
	return f
}

func (f *fixture) mint(t *testing.T, user string, scopes []string) (string, string) {
	t.Helper()
	var grant string
	if err := f.pool.QueryRow(t.Context(), "INSERT INTO oauth_grants(user_id,client_id,scopes,expires_at) VALUES($1,'monkeyai-desktop',$2,now()+interval '1 day') RETURNING id", user, scopes).Scan(&grant); err != nil {
		t.Fatal(err)
	}
	raw := uuid.New().String()
	hash := sha256.Sum256([]byte(raw))
	refresh := sha256.Sum256([]byte(raw + "refresh"))
	if _, err := f.pool.Exec(t.Context(), `INSERT INTO oauth_tokens(user_id,client_id,grant_id,access_token_hash,refresh_token_hash,access_expires_at,refresh_expires_at)
		VALUES($1,'monkeyai-desktop',$2,$3,$4,now()+interval '1 hour',now()+interval '1 day')`, user, grant, hex.EncodeToString(hash[:]), hex.EncodeToString(refresh[:])); err != nil {
		t.Fatal(err)
	}
	return raw, grant
}

type runtimeFixture struct {
	hello    Hello
	ready    Ready
	private  ed25519.PrivateKey
	mux      *yamux.Session
	control  io.ReadCloser
	ws       *websocket.Conn
	data     *yamux.Session
	client   *http.Client
	events   chan map[string]any
	sequence atomic.Int64
}

func (f *fixture) handshake(t *testing.T, hello Hello, private ed25519.PrivateKey, channel, token string) (*websocket.Conn, Ready) {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	ws, _, err := websocket.Dial(ctx, strings.Replace(f.server.URL, "http", "ws", 1)+"/api/v1/endpoint-bridge?channel_kind="+channel+"&tunnel_version=1", &websocket.DialOptions{HTTPHeader: http.Header{"Authorization": {"Bearer " + token}, "Origin": {f.s.config.PublicURL}}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ws.CloseNow() })
	if err = writeWS(ctx, ws, hello); err != nil {
		t.Fatal(err)
	}
	var challenge Challenge
	if err = readWS(ctx, ws, &challenge); err != nil {
		t.Fatal(err)
	}
	message, _ := ProofBytes(hello, challenge)
	if err = writeWS(ctx, ws, Proof{Type: "proof", ChallengeID: challenge.ChallengeID, Signature: base64.RawURLEncoding.EncodeToString(ed25519.Sign(private, message))}); err != nil {
		t.Fatal(err)
	}
	var ready Ready
	if err = readWS(ctx, ws, &ready); err != nil {
		t.Fatal(err)
	}
	if err = writeWS(ctx, ws, ReadyAck{Type: "ready_ack", RegistrationVersion: ready.RegistrationVersion, LeaseEpoch: ready.LeaseEpoch}); err != nil {
		t.Fatal(err)
	}
	return ws, ready
}

func (f *fixture) runtime(t *testing.T) *runtimeFixture {
	t.Helper()
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	hello := Hello{Type: "hello", TunnelVersion: Version, ChannelKind: "control", MachineID: uuid.New().String(), BootID: uuid.New().String(), ExecutionPublicKey: base64.RawURLEncoding.EncodeToString(public), DisplayName: "测试 runtime", Platform: "macos", Arch: "arm64", DeploymentMode: "desktop_managed", Intent: "publish", Protocols: map[string][]int{"acp": {1}, "runtime_api": {1}}}
	ws, ready := f.handshake(t, hello, private, "control", f.token)
	mux, err := yamux.Client(websocket.NetConn(t.Context(), ws, websocket.MessageBinary), muxConfig())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { mux.Close() })
	transport := &http.Transport{DisableKeepAlives: true, DialContext: func(context.Context, string, string) (net.Conn, error) { return mux.OpenStream() }}
	t.Cleanup(transport.CloseIdleConnections)
	runtime := &runtimeFixture{hello: hello, ready: ready, private: private, mux: mux, ws: ws, client: &http.Client{Transport: transport}, events: make(chan map[string]any, 32)}
	response, err := runtime.client.Get("http://relay.internal/_control/events")
	if err != nil {
		t.Fatal(err)
	}
	runtime.control = response.Body
	t.Cleanup(func() { response.Body.Close() })
	reader := bufio.NewReader(response.Body)
	line, err := reader.ReadBytes('\n')
	if err != nil || string(line) != "{\"type\":\"ready\"}\n" {
		t.Fatalf("events ready: %s %v", line, err)
	}
	go func() {
		for {
			line, err := reader.ReadBytes('\n')
			if err != nil {
				return
			}
			var event map[string]any
			if json.Unmarshal(line, &event) != nil {
				return
			}
			if event["type"] == "revocation" {
				wire, ok := event["signed"].(string)
				if !ok {
					t.Error("撤销不是签名字符串")
					return
				}
				payload, ok := verifyWire(f.s.key.Public().(ed25519.PublicKey), wire)
				if !ok {
					t.Error("撤销签名无效")
					return
				}
				var claim map[string]any
				json.Unmarshal(payload, &claim)
				if claim["authorization"] != nil || claim["boot_id"] != hello.BootID {
					t.Error("撤销载荷不符合协议")
					return
				}
			}
			select {
			case runtime.events <- event:
			default:
			}
		}
	}()
	dhello := Hello{Type: "hello", TunnelVersion: Version, ChannelKind: "data", MachineID: hello.MachineID, ExecutionPublicKey: hello.ExecutionPublicKey, BootID: hello.BootID, DisplayName: hello.DisplayName, Platform: hello.Platform, Arch: hello.Arch, DeploymentMode: hello.DeploymentMode, Intent: "attach", LeaseEpoch: ready.LeaseEpoch, Protocols: hello.Protocols}
	dws, _ := f.handshake(t, dhello, private, "data", f.token)
	data, err := yamux.Client(websocket.NetConn(t.Context(), dws, websocket.MessageBinary), muxConfig())
	if err != nil {
		t.Fatal(err)
	}
	runtime.data = data
	t.Cleanup(func() { data.Close() })
	for _, session := range []*yamux.Session{mux, data} {
		listener := &muxListener{session: session}
		server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" || r.Header.Get("X-MAI-Role") != "" {
				t.Error("代理泄露原凭据或身份头")
			}
			if r.Host != "device.internal" {
				t.Error("业务 Host 不匹配")
				w.WriteHeader(400)
				return
			}
			if r.URL.Path == "/acp" || strings.HasPrefix(r.URL.Path, "/read/") || r.URL.Path == "/write/resource" {
				payload, ok := verifyWire(f.s.key.Public().(ed25519.PublicKey), r.Header.Get("X-MonkeyAI-Access"))
				var claim struct {
					Authorization FileAuthorization `json:"authorization"`
					ExpiresAt     string            `json:"expires_at"`
				}
				if !ok || json.Unmarshal(payload, &claim) != nil || !strings.HasSuffix(claim.ExpiresAt, "Z") {
					t.Error("断言无效或非 UTC Z")
					w.WriteHeader(403)
					return
				}
				request := LeaseRequest{Type: "access_lease_request", Authorization: claim.Authorization, Nonce: uuid.New().String(), LeaseSeq: runtime.sequence.Add(1), BootID: hello.BootID, RequireFresh: true}
				body, _ := json.Marshal(request)
				response, err := runtime.client.Post("http://relay.internal/_control/access-lease", "application/json", strings.NewReader(string(body)))
				if err != nil {
					t.Error(err)
					w.WriteHeader(403)
					return
				}
				var result leaseResponse
				err = json.NewDecoder(response.Body).Decode(&result)
				response.Body.Close()
				if err != nil || response.StatusCode != 200 || result.Signed == "" {
					t.Errorf("租约失败: %+v %v", result, err)
					w.WriteHeader(403)
					return
				}
				if _, ok := verifyWire(f.s.key.Public().(ed25519.PublicKey), result.Signed); !ok {
					t.Error("访问租约签名无效")
					w.WriteHeader(403)
					return
				}
			}
			if strings.HasPrefix(r.URL.Path, "/files/fg1.") {
				payload, ok := verifyWire(f.s.key.Public().(ed25519.PublicKey), r.Header.Get("X-MonkeyAI-Access"))
				var claim struct {
					Authorization FileAuthorization `json:"authorization"`
					ExpiresAt     string            `json:"expires_at"`
				}
				if !ok || json.Unmarshal(payload, &claim) != nil || !strings.HasSuffix(claim.ExpiresAt, "Z") || claim.Authorization.ConnectionID == "" {
					t.Error("独立文件访问缺少完整 UTC 断言")
					w.WriteHeader(403)
					return
				}
			}
			if r.URL.Path == "/acp" {
				ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true, Subprotocols: []string{"monkeyai.v1"}})
				if err != nil {
					return
				}
				defer ws.CloseNow()
				for {
					kind, payload, err := ws.Read(r.Context())
					if err != nil {
						return
					}
					if ws.Write(r.Context(), kind, payload) != nil {
						return
					}
				}
			}
			if f.previewHTML && strings.HasSuffix(r.URL.Path, "/index.html") {
				w.Header().Set("Content-Type", "text/html; charset=utf-8")
				w.Header().Set("Content-Security-Policy", "default-src * 'unsafe-inline'; sandbox allow-scripts allow-same-origin")
				io.WriteString(w, `<!doctype html><html><body><h1>产物预览隔离测试</h1><p id="result">检查中</p><script>const result={};for(const [name,test] of Object.entries({localStorage:()=>localStorage.setItem("runtime-test","secret"),cookie:()=>document.cookie,indexedDB:()=>indexedDB.open("runtime-test"),serviceWorker:()=>navigator.serviceWorker.register("worker.js")})){try{test();result[name]="available"}catch(error){result[name]="blocked"}}document.getElementById("result").textContent=JSON.stringify(result);window.previewResult=result;</script></body></html>`)
				return
			}
			if r.URL.Path == "/cap/test/mcp" {
				w.Header().Set("Content-Type", "text/event-stream")
				w.Header().Set("Mcp-Session-Id", r.Header.Get("Mcp-Session-Id"))
				w.Header().Set("MCP-Protocol-Version", r.Header.Get("MCP-Protocol-Version"))
				w.Header().Set("X-Last-Event-ID", r.Header.Get("Last-Event-ID"))
				io.WriteString(w, "id: 1\ndata: first\n\n")
				w.(http.Flusher).Flush()
				io.WriteString(w, "id: 2\ndata: second\n\n")
				return
			}
			if strings.HasPrefix(r.URL.Path, "/files/") && r.Header.Get("Range") != "" {
				http.ServeContent(w, r, "file.txt", time.Now(), strings.NewReader("0123456789"))
				return
			}
			w.Header().Set("X-Target-Path", r.URL.Path)
			w.Header().Set("Set-Cookie", "private=secret")
			if r.Method == "HEAD" {
				w.WriteHeader(200)
				return
			}
			if r.URL.Path == "/uploads/test" {
				w.Header().Set("Upload-Session-ID", r.Header.Get("Upload-Session-ID"))
				w.Header().Set("Upload-Offset", "4")
				body, _ := io.ReadAll(r.Body)
				w.Write(body)
				return
			}
			w.Write([]byte("目标文件内容"))
		})}
		t.Cleanup(func() { server.Close() })
		go server.Serve(listener)
	}
	return runtime
}

type muxListener struct{ session *yamux.Session }

func (l *muxListener) Accept() (net.Conn, error) {
	conn, err := l.session.AcceptStream()
	if err != nil {
		return nil, err
	}
	return conn, nil
}
func (l *muxListener) Close() error   { return l.session.Close() }
func (l *muxListener) Addr() net.Addr { return &net.TCPAddr{} }

func (f *fixture) fileToken(t *testing.T, r *runtimeFixture, path string) string {
	t.Helper()
	now := time.Now().UTC()
	grant := FileGrant{Version: 1, ServerID: f.s.config.ServerID, OwnerUserID: f.user, MachineID: r.hello.MachineID, SessionID: uuid.New().String(), Path: path, Scope: "file", KeyID: endpoint.KeyID(r.private.Public().(ed25519.PublicKey)), GrantVersion: r.ready.GrantVersion, IssuedAt: now, ExpiresAt: now.Add(5 * time.Minute)}
	data, _ := json.Marshal(grant)
	message, _ := FileGrantBytes(grant)
	return base64.RawURLEncoding.EncodeToString(data) + "." + base64.RawURLEncoding.EncodeToString(ed25519.Sign(r.private, message))
}

func (f *fixture) connection(t *testing.T, machine string, in ConnectionRequest, token string) ConnectionResponse {
	t.Helper()
	body, _ := json.Marshal(in)
	req, _ := http.NewRequestWithContext(t.Context(), "POST", f.server.URL+"/api/v1/endpoints/"+machine+"/connections", strings.NewReader(string(body)))
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		data, _ := io.ReadAll(resp.Body)
		t.Fatalf("连接申请 status=%d body=%s", resp.StatusCode, data)
	}
	var out ConnectionResponse
	if json.NewDecoder(resp.Body).Decode(&out) != nil {
		t.Fatal("连接响应无效")
	}
	return out
}
