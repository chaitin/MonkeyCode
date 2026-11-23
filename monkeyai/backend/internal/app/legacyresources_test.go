package app

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"log/slog"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/apikey"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/config"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/endpoint"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestRuntimeResourcesWithoutScopes(t *testing.T) {
	ctx := t.Context()
	pool := designAppDatabase(t)
	h, err := newMemberTestHandler(ctx, slog.New(slog.NewTextHandler(io.Discard, nil)), pool, config.Config{
		PublicURL: "http://localhost", RuntimeRelay: true, RuntimeStateDir: t.TempDir(),
		InitialAdminName: "初始管理员", InitialAdminEmail: "admin@example.com", InitialAdminPassword: "resource-test-password",
	})
	if err != nil {
		t.Fatal(err)
	}
	app := h.(*applicationHandler)
	client := parityClient{t: t, app: h}
	user, machine, token := resource.ID(), resource.ID(), resource.ID()
	if _, err := pool.Exec(ctx, "INSERT INTO users(id,name,email) VALUES($1,'旧设备用户',$2)", user, user+"@example.com"); err != nil {
		t.Fatal(err)
	}
	public, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	scopes := []string{}
	var grant string
	if err := pool.QueryRow(ctx, `INSERT INTO oauth_grants(user_id,client_id,scopes,purpose,requested_machine_id,requested_key_id,expires_at)
  VALUES($1,$2,$3,'runtime',$4,$5,now()+interval '1 day') RETURNING id`, user, identity.RuntimeClientID, scopes, machine, endpoint.KeyID(public)).Scan(&grant); err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256([]byte(token))
	if _, err := pool.Exec(ctx, `INSERT INTO oauth_tokens(user_id,client_id,grant_id,access_token_hash,refresh_token_hash,access_expires_at,refresh_expires_at)
  VALUES($1,$2,$3,$4,$5,now()+interval '1 hour',now()+interval '1 day')`, user, identity.RuntimeClientID, grant, hex.EncodeToString(hash[:]), resource.ID()); err != nil {
		t.Fatal(err)
	}
	client.request("GET", "/api/v1/models", token, "", nil, 200)
	client.request("GET", "/api/v1/kb", token, "", nil, 200)
	client.request("GET", "/api/v1/sessions", token, "", nil, 403)
	client.request("POST", "/api/v1/api-keys", token, "", resource.Object{"name": "未绑定"}, 403)

	ids := identity.NewService(pool, nil, "http://localhost")
	devices := endpoint.NewExecution(pool, ids)
	p := identity.Principal{UserID: user, ClientID: identity.RuntimeClientID, GrantID: grant, Purpose: "runtime", Audience: identity.Audience, Scopes: scopes, RevocationVersion: 1}
	if _, err := devices.Enroll(ctx, p, endpoint.Enrollment{MachineID: machine, PublicKey: public, DisplayName: "旧云电脑", Platform: "linux", Arch: "amd64", Intent: "publish", DeploymentMode: "standalone"}, 0); err != nil {
		t.Fatal(err)
	}
	p.MachineID, p.KeyID = machine, endpoint.KeyID(public)
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if ok, err := devices.AuthenticateHost(ctx, tx, p, machine); err != nil || !ok {
		t.Fatalf("无 scope 的运行端无法上报本机：%v", err)
	}
	p.KeyID = "wrong-key"
	if ok, _ := devices.AuthenticateHost(ctx, tx, p, machine); ok {
		t.Fatal("公钥不符的运行端被允许上报")
	}
	if err := tx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}

	// 旧版本可签发同时带模型和 MCP 权限的同一把密钥。
	oldKey := "mk_" + resource.ID()
	oldHash := sha256.Sum256([]byte(oldKey))
	if _, err := pool.Exec(ctx, `INSERT INTO api_keys(user_id,name,key_prefix,key_hash,scopes,expires_at,machine_id,runtime_grant_id)
  VALUES($1,'旧网关密钥','mk_legacy01',$2,ARRAY['model:invoke','mcp:invoke'],now()+interval '1 day',$3,$4)`, user, hex.EncodeToString(oldHash[:]), machine, grant); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"models", "rules", "skills", "experts", "connectors", "kb", "design-resources/config"} {
		client.request("GET", "/api/v1/"+path, token, "", nil, 200)
	}
	book := client.request("POST", "/api/v1/kb", token, "", resource.Object{"name": "自动升级后的个人库"}, 201)
	client.request("GET", "/api/v1/kb/"+book.String("id"), token, "", nil, 200)
	if got, err := app.runtimeKeys.Authenticate(ctx, oldKey, apikey.ScopeModelInvoke); err != nil || got != user {
		t.Fatalf("历史调用密钥未恢复：%v", err)
	}
	client.request("POST", "/mcp/kb", oldKey, "", resource.Object{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}, 200)
	if err := ids.RevokeGrant(ctx, grant, "logout"); err != nil {
		t.Fatal(err)
	}
	client.request("GET", "/api/v1/models", token, "", nil, 401)
	if _, err := app.runtimeKeys.Authenticate(ctx, oldKey, apikey.ScopeModelInvoke); err == nil {
		t.Fatal("撤销后模型密钥仍有效")
	}
}
