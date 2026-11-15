package enginehost

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestRegistryCredentialsExpireAndRespectRevocation(t *testing.T) {
	pool := testPool(t)
	host := resource.ID()
	public, key, _ := ed25519.GenerateKey(rand.Reader)
	if _, err := pool.Exec(t.Context(), `INSERT INTO hosts(id,user_id,name,architecture,version,status,public_key) VALUES($1,$3,'registry','amd64','v1','active',$2)`, host, []byte(public), testAdmin); err != nil {
		t.Fatal(err)
	}
	service := NewService(pool).WithInstallation("https://server.example", "", "")
	request := func(server, user string, expires int64, signer ed25519.PrivateKey) bool {
		message := []byte("monkeyai-engine/registry/v1\n" + server + "\n" + host + "\n" + strconv.FormatInt(expires, 10))
		raw, _ := json.Marshal(map[string]any{"expires_at": expires, "signature": ed25519.Sign(signer, message)})
		r := httptest.NewRequest("GET", "https://server.example/v2/", nil)
		r.SetBasicAuth(user, base64.RawURLEncoding.EncodeToString(raw))
		return service.RegistryAuthorized(r)
	}
	future := time.Now().Add(30 * time.Minute).Unix()
	if !request("https://server.example", host, future, key) {
		t.Fatal("有效宿主无法拉取镜像")
	}
	if request("https://server.example", host, time.Now().Add(-time.Minute).Unix(), key) {
		t.Fatal("接受过期凭据")
	}
	if request("https://server.example", host, time.Now().Add(2*time.Hour).Unix(), key) {
		t.Fatal("接受超长凭据")
	}
	if request("https://other.example", host, future, key) {
		t.Fatal("凭据未绑定server")
	}
	if request("https://server.example", resource.ID(), future, key) {
		t.Fatal("凭据未绑定宿主")
	}
	_, other, _ := ed25519.GenerateKey(rand.Reader)
	if request("https://server.example", host, future, other) {
		t.Fatal("接受其他宿主签名")
	}
	if _, err := pool.Exec(t.Context(), "UPDATE hosts SET status='revoked' WHERE id=$1", host); err != nil {
		t.Fatal(err)
	}
	if request("https://server.example", host, future, key) {
		t.Fatal("撤销宿主后仍能拉取镜像")
	}
}
