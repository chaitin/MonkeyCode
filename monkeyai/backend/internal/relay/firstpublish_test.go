package relay

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"
	"uuid"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/endpoint"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity/sqlc"
)

func TestStandaloneFirstPublishConnection(t *testing.T) {
	f := newFixture(t)
	ctx := t.Context()
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	machine, key := uuid.New().String(), endpoint.KeyID(public)
	q := sqlc.New(f.pool)
	expires := time.Now().Add(time.Hour)
	grant, err := q.CreateRuntimeGrant(ctx, sqlc.CreateRuntimeGrantParams{UserID: f.user, Scopes: []string{identity.AccountResources, "device:bind", "device:publish", "session:report"}, RequestedMachineID: &machine, RequestedKeyID: &key, ExpiresAt: expires})
	if err != nil {
		t.Fatal(err)
	}
	token := uuid.New().String()
	_, err = q.CreateToken(ctx, sqlc.CreateTokenParams{UserID: f.user, ClientID: identity.RuntimeClientID, GrantID: grant.ID, AccessTokenHash: fmt.Sprintf("%x", sha256.Sum256([]byte(token))), RefreshTokenHash: fmt.Sprintf("%x", sha256.Sum256([]byte(token+"refresh"))), AccessExpiresAt: time.Now().Add(time.Minute), RefreshExpiresAt: expires})
	if err != nil {
		t.Fatal(err)
	}
	hello := Hello{Type: "hello", TunnelVersion: Version, ChannelKind: "control", MachineID: machine, BootID: uuid.New().String(), ExecutionPublicKey: base64.RawURLEncoding.EncodeToString(public), DisplayName: "首启云电脑", Platform: "linux", Arch: "arm64", DeploymentMode: "standalone", Intent: "publish", Protocols: map[string][]int{"acp": {1}, "runtime_api": {1}}}
	f.publish(t, hello, private, token, nil)
	if conn := f.connection(t, machine, ConnectionRequest{SupportedProtocols: hello.Protocols}, f.token); conn.Ticket == "" {
		t.Fatal("首次发布后未签发连接票据")
	}
	// 即使撤销通知尚未到达路由，也必须重新核验授权。
	f.ids.WithGrantRevoker(nil)
	if err := f.ids.RevokeGrant(ctx, grant.ID, "user_revoked"); err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, f.server.URL+"/api/v1/endpoints/"+machine+"/connections", strings.NewReader("{}"))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+f.token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("撤销后申请连接返回 %d", resp.StatusCode)
	}
}
