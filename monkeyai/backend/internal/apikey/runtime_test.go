package apikey

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"uuid"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/endpoint"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestRuntimeGatewayKeysStayWithinExecutionGrant(t *testing.T) {
	dsn := os.Getenv("MONKEYAI_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("需要隔离 PostgreSQL")
	}
	root, err := pgxpool.New(t.Context(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(root.Close)
	schema := pgx.Identifier{"test_runtime_keys_" + strings.ReplaceAll(uuid.New().String(), "-", "")}.Sanitize()
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
			t.Fatal(err)
		}
	}
	var user string
	if err = pool.QueryRow(t.Context(), "INSERT INTO users(name,email) VALUES('密钥测试','runtime-keys@example.com') RETURNING id").Scan(&user); err != nil {
		t.Fatal(err)
	}
	keys := NewService(NewPostgres(pool))
	ids := identity.NewService(pool, nil, "http://localhost")
	devices := endpoint.NewExecution(pool, ids)
	host, err := keys.Create(t.Context(), user, CreateInput{Name: "Desktop", Scopes: []string{ScopeModelInvoke}})
	if err != nil {
		t.Fatal(err)
	}
	type installation struct {
		token, grant, machine string
		p                     identity.Principal
	}
	newRuntime := func(name string) installation {
		t.Helper()
		public, _, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		in := endpoint.Enrollment{MachineID: uuid.New().String(), PublicKey: public, DisplayName: name, Platform: "linux", Arch: "amd64", Intent: "publish", DeploymentMode: "standalone"}
		var grant string
		scopes := []string{"device:bind", "device:publish", "session:report"}
		if err = pool.QueryRow(t.Context(), `INSERT INTO oauth_grants(user_id,client_id,scopes,purpose,requested_machine_id,requested_key_id,expires_at)
		VALUES($1,'monkeyai-runtime',$2,'runtime',$3,$4,now()+interval '1 day') RETURNING id`, user, scopes, in.MachineID, endpoint.KeyID(public)).Scan(&grant); err != nil {
			t.Fatal(err)
		}
		p := identity.Principal{UserID: user, ClientID: identity.RuntimeClientID, GrantID: grant, Scopes: scopes, Audience: identity.Audience, Purpose: "runtime", RevocationVersion: 1}
		if _, err = devices.Enroll(t.Context(), p, in, 0); err != nil {
			t.Fatal(err)
		}
		token := uuid.New().String()
		hash := sha256.Sum256([]byte(token))
		if _, err = pool.Exec(t.Context(), `INSERT INTO oauth_tokens(user_id,client_id,grant_id,access_token_hash,refresh_token_hash,access_expires_at,refresh_expires_at)
		VALUES($1,'monkeyai-runtime',$2,$3,$4,now()+interval '1 hour',now()+interval '1 day')`, user, grant, hex.EncodeToString(hash[:]), uuid.New().String()); err != nil {
			t.Fatal(err)
		}
		return installation{token: token, grant: grant, machine: in.MachineID, p: p}
	}
	first, second := newRuntime("服务器一"), newRuntime("服务器二")
	router := chi.NewRouter()
	router.Use(ids.RequireAgent)
	keys.RegisterAgent(router)
	call := func(inst installation, method, path, body string, want int) []byte {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+inst.token)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, req)
		if response.Code != want {
			t.Fatalf("密钥请求状态=%d want=%d body=%s", response.Code, want, response.Body.String())
		}
		return response.Body.Bytes()
	}
	var created CreatedKey
	if err = json.Unmarshal(call(first, "POST", "/api-keys", `{"name":"执行密钥","scopes":["model:invoke","mcp:invoke"]}`, 201), &created); err != nil {
		t.Fatal(err)
	}
	if created.MachineID == nil || *created.MachineID != first.machine || created.RuntimeGrantID == nil || *created.RuntimeGrantID != first.grant {
		t.Fatal("专用调用密钥没有设备授权归属")
	}
	for _, scope := range []string{ScopeModelInvoke, ScopeMCPInvoke} {
		if got, err := keys.Authenticate(t.Context(), created.APIKey, scope); err != nil || got != user {
			t.Fatalf("专用密钥不可调用：%v", err)
		}
	}
	body := call(second, "GET", "/api-keys", "", 200)
	if strings.Contains(string(body), created.ID) || strings.Contains(string(body), host.ID) {
		t.Fatal("独立 runtime 看到了其他安装或 Desktop 密钥")
	}
	call(second, "DELETE", "/api-keys/"+created.ID, "", 404)
	call(first, "POST", "/api-keys/"+host.ID+"/rotate", "", 404)
	var rotated CreatedKey
	if err = json.Unmarshal(call(first, "POST", "/api-keys/"+created.ID+"/rotate", "", 201), &rotated); err != nil {
		t.Fatal(err)
	}
	if rotated.RuntimeGrantID == nil || *rotated.RuntimeGrantID != first.grant {
		t.Fatal("轮换丢失执行授权归属")
	}
	if _, err := keys.Authenticate(t.Context(), created.APIKey, ScopeModelInvoke); err == nil {
		t.Fatal("轮换后旧密钥仍有效")
	}
	if err := ids.RevokeGrant(t.Context(), first.grant, "logout"); err != nil {
		t.Fatal(err)
	}
	if _, err := keys.Authenticate(t.Context(), rotated.APIKey, ScopeModelInvoke); err == nil {
		t.Fatal("专用授权撤销未传播到网关认证")
	}
	if _, err := keys.Authenticate(t.Context(), host.APIKey, ScopeModelInvoke); err != nil {
		t.Fatal("独立撤销影响托管密钥")
	}
	if err := keys.RevokeRuntimeKeys(t.Context(), first.grant); err != nil {
		t.Fatal(err)
	}
	var revoked bool
	if err = pool.QueryRow(t.Context(), "SELECT revoked_at IS NOT NULL FROM api_keys WHERE id=$1", rotated.ID).Scan(&revoked); err != nil || !revoked {
		t.Fatal("专用密钥撤销状态未落库")
	}
}
