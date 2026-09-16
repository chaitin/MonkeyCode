package endpoint

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
	"uuid"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/coder/websocket"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func testDatabase(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("MONKEYAI_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("设置 MONKEYAI_TEST_DATABASE_URL 运行端点桥接数据库与真实 WebSocket 测试")
	}
	root, err := pgxpool.New(t.Context(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(root.Close)
	schema := pgx.Identifier{"test_endpoint_" + strings.ReplaceAll(uuid.New().String(), "-", "")}.Sanitize()
	if _, err = root.Exec(t.Context(), "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := root.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE"); err != nil {
			t.Error(err)
		}
	})
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
			t.Fatal(err)
		}
	}
	return pool
}
func testUser(t *testing.T, pool *pgxpool.Pool, token string) string {
	t.Helper()
	user := uuid.New().String()
	if _, err := pool.Exec(t.Context(), `INSERT INTO users(id,name,email) VALUES($1,'桥接测试',$2)`, user, user+"@example.com"); err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256([]byte(token))
	refreshHash := sha256.Sum256([]byte(token + "-refresh"))
	if _, err := pool.Exec(t.Context(), `INSERT INTO oauth_tokens(user_id,client_id,access_token_hash,refresh_token_hash,access_expires_at,refresh_expires_at) VALUES($1,'monkeyai-desktop',$2,$3,now()+interval '1 hour',now()+interval '1 day')`, user, hex.EncodeToString(hash[:]), hex.EncodeToString(refreshHash[:])); err != nil {
		t.Fatal(err)
	}
	return user
}

type testAuth struct{ *identity.Service }

func (a testAuth) Credential(r *http.Request) (Credential, bool) {
	c, ok := identity.CredentialFromContext(r.Context())
	return Credential{c.UserID, c.Reference, c.ExpiresAt}, ok
}
func (a testAuth) Valid(ctx context.Context, c Credential) (bool, error) {
	return a.ValidCredential(ctx, identity.AccessCredential{UserID: c.UserID, Reference: c.Reference, ExpiresAt: c.ExpiresAt})
}

type fixture struct {
	service *Service
	pool    *pgxpool.Pool
	server  *httptest.Server
	user    string
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	pool := testDatabase(t)
	user := testUser(t, pool, "owner")
	testUser(t, pool, "other")
	ids := identity.NewService(pool, nil, "http://localhost")
	service := NewService(NewPostgres(pool), testAuth{ids}, slog.New(slog.NewTextHandler(io.Discard, nil)), "http://localhost")
	service.verifyInterval = 50 * time.Millisecond
	router := chi.NewRouter()
	router.Use(ids.RequireAgent)
	service.RegisterAgent(router)
	root := chi.NewRouter()
	root.Mount("/api/v1", router)
	root.Mount("/", router)
	server := httptest.NewServer(root)
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		if err := service.Shutdown(ctx); err != nil {
			t.Error(err)
		}
		server.Close()
	})
	return &fixture{service, pool, server, user}
}
func writeWS(t *testing.T, c *websocket.Conn, v any) {
	t.Helper()
	data, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
	defer cancel()
	if err = c.Write(ctx, websocket.MessageText, data); err != nil {
		t.Fatal(err)
	}
}
func readWS(t *testing.T, c *websocket.Conn, kind string) map[string]json.RawMessage {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
	defer cancel()
	for {
		_, data, err := c.Read(ctx)
		if err != nil {
			t.Fatal(err)
		}
		var out map[string]json.RawMessage
		if err = json.Unmarshal(data, &out); err != nil {
			t.Fatal(err)
		}
		if string(out["type"]) == `"`+kind+`"` {
			return out
		}
		if string(out["type"]) != `"directory.snapshot"` {
			t.Fatalf("意外消息 %s", data)
		}
	}
}
func dial(t *testing.T, f *fixture, machine, token string) *websocket.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(f.server.URL, "http")+"/endpoints/connect", &websocket.DialOptions{HTTPHeader: http.Header{"Authorization": []string{"Bearer " + token}}, CompressionMode: websocket.CompressionDisabled})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.CloseNow() })
	c.SetReadLimit(maxMessage)
	writeWS(t, c, Hello{Type: "hello", Versions: []int{1}, MachineID: machine, Profile: Profile{"电脑", "macos", "15", "arm64", "1"}})
	readWS(t, c, "welcome")
	readWS(t, c, "directory.snapshot")
	return c
}
func call(t *testing.T, f *fixture, method, path, body, token string) (int, []byte) {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), method, f.server.URL+path, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	response, err := f.server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	data, _ := io.ReadAll(response.Body)
	return response.StatusCode, data
}
func assertClose(t *testing.T, c *websocket.Conn, code websocket.StatusCode) {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
	defer cancel()
	for {
		_, _, err := c.Read(ctx)
		if err != nil {
			if websocket.CloseStatus(err) != code {
				t.Fatalf("关闭码=%v, want %v: %v", websocket.CloseStatus(err), code, err)
			}
			return
		}
	}
}

func TestBridgeRouting(t *testing.T) {
	f := newFixture(t)
	a := dial(t, f, machineA, "owner")
	b := dial(t, f, machineB, "owner")
	writeWS(t, a, Message{Type: "request", ID: messageID, Target: machineB, Method: "agent.example", Payload: json.RawMessage(`{"n":9007199254740993}`)})
	got := readWS(t, b, "request")
	if string(got["source"]) != `"`+machineA+`"` || !bytes.Contains(got["payload"], []byte("9007199254740993")) {
		t.Fatalf("转发消息错误 %s", got)
	}
	writeWS(t, b, Message{Type: "response", ID: uuid.New().String(), Target: machineA, ReplyTo: messageID, Payload: json.RawMessage(`{"ok":true}`)})
	got = readWS(t, a, "response")
	if string(got["reply_to"]) != `"`+messageID+`"` {
		t.Fatal("请求关联丢失")
	}
	other := dial(t, f, uuid.New().String(), "other")
	writeWS(t, other, Message{Type: "event", ID: messageID, Target: machineA, Method: "agent.example", Payload: json.RawMessage(`{}`)})
	got = readWS(t, other, "error")
	if !bytes.Contains(got["error"], []byte("target_unavailable")) {
		t.Fatal("跨用户信息泄露")
	}
	code, _ := call(t, f, "GET", "/endpoints/"+machineA, "", "other")
	if code != 404 {
		t.Fatalf("跨用户管理返回 %d", code)
	}
	code, data := call(t, f, "PATCH", "/endpoints/"+machineB, `{"alias":"工作电脑"}`, "owner")
	if code != 200 || !bytes.Contains(data, []byte("工作电脑")) {
		t.Fatalf("改名 %d %s", code, data)
	}
	snapshot := readWS(t, b, "directory.snapshot")
	if !bytes.Contains(snapshot["endpoints"], []byte("工作电脑")) {
		t.Fatal("改名未更新目录")
	}
}

func TestReplacementAndRevocation(t *testing.T) {
	f := newFixture(t)
	old := dial(t, f, machineA, "owner")
	current := dial(t, f, machineA, "owner")
	assertClose(t, old, 4001)
	writeWS(t, current, Message{Type: "event", ID: messageID, Target: machineA, Method: "agent.example", Payload: json.RawMessage(`{}`)})
	readWS(t, current, "event")
	code, _ := call(t, f, "POST", "/endpoints/"+machineA+"/revoke", "", "owner")
	if code != 200 {
		t.Fatal(code)
	}
	assertClose(t, current, 4002)
	code, data := call(t, f, "GET", "/endpoints/"+machineA, "", "owner")
	if code != 200 || !bytes.Contains(data, []byte(`"online":false`)) {
		t.Fatalf("撤销状态错误 %d %s", code, data)
	}
	code, _ = call(t, f, "POST", "/endpoints/"+machineA+"/restore", "", "owner")
	if code != 200 {
		t.Fatal(code)
	}
	next := dial(t, f, machineA, "owner")
	writeWS(t, next, Message{Type: "event", ID: messageID, Target: machineA, Method: "agent.example", Payload: json.RawMessage(`{}`)})
	readWS(t, next, "event")
}

func TestTokenRevocationAndFailures(t *testing.T) {
	f := newFixture(t)
	for _, token := range []string{"", "unknown"} {
		code, _ := call(t, f, "GET", "/endpoints", "", token)
		if code != 401 {
			t.Fatalf("无效凭据 %d", code)
		}
	}
	c := dial(t, f, machineA, "owner")
	if _, err := f.pool.Exec(t.Context(), `UPDATE oauth_tokens SET revoked_at=now() WHERE user_id=$1`, f.user); err != nil {
		t.Fatal(err)
	}
	assertClose(t, c, 4003)
	code, _ := call(t, f, "GET", "/endpoints", "", "owner")
	if code != 401 {
		t.Fatal(code)
	}
	if _, err := f.pool.Exec(t.Context(), `ALTER TABLE oauth_tokens RENAME TO unavailable_tokens`); err != nil {
		t.Fatal(err)
	}
	code, _ = call(t, f, "GET", "/endpoints", "", "other")
	if code != 503 {
		t.Fatalf("数据库故障错误映射为 %d", code)
	}
}

func TestStoreLimitAndAudit(t *testing.T) {
	pool := testDatabase(t)
	user := testUser(t, pool, "owner")
	store := NewPostgres(pool)
	var wg sync.WaitGroup
	results := make(chan error, 25)
	for range 25 {
		wg.Go(func() {
			_, err := store.Register(t.Context(), user, Hello{MachineID: uuid.New().String(), Profile: Profile{"电脑", "macos", "15", "arm64", "1"}}, 20)
			results <- err
		})
	}
	wg.Wait()
	close(results)
	success, limited := 0, 0
	for err := range results {
		if err == nil {
			success++
		} else if err.Error() == "endpoint_limit_exceeded" {
			limited++
		} else {
			t.Fatal(err)
		}
	}
	if success != 20 || limited != 5 {
		t.Fatalf("并发限额失效 %d %d", success, limited)
	}
	rows, err := store.Active(t.Context(), user)
	if err != nil {
		t.Fatal(err)
	}
	id := rows[0].MachineID
	if _, err = store.Update(t.Context(), user, id, "revoke", nil, 20); err != nil {
		t.Fatal(err)
	}
	if _, err = store.Register(t.Context(), user, Hello{MachineID: id, Profile: Profile{"电脑", "macos", "15", "arm64", "1"}}, 20); err == nil || err.Error() != "endpoint_revoked" {
		t.Fatalf("hello 自动恢复已停用端点: %v", err)
	}
	if _, err = store.Register(t.Context(), user, Hello{MachineID: uuid.New().String(), Profile: Profile{"电脑", "macos", "15", "arm64", "1"}}, 20); err != nil {
		t.Fatal(err)
	}
	if _, err = store.Update(t.Context(), user, id, "restore", nil, 20); err == nil || err.Error() != "endpoint_limit_exceeded" {
		t.Fatalf("恢复绕过限额 %v", err)
	}
	var n int
	if err = pool.QueryRow(t.Context(), `SELECT count(*) FROM audits WHERE action='endpoint.register'`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 21 {
		t.Fatalf("登记审计数 %d", n)
	}
}
