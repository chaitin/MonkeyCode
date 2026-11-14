package control

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"strconv"
	"testing"
	"time"
)

func TestRegistryAuthIsScopedAndShortLived(t *testing.T) {
	public, key, _ := ed25519.GenerateKey(rand.Reader)
	client, _ := New("https://server.example:8443", key)
	reference := "server.example:8443/environments/image@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	encoded, err := client.RegistryAuth("host", reference)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := base64.URLEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatal(err)
	}
	var auth struct{ Username, Password, ServerAddress string }
	if json.Unmarshal(raw, &auth) != nil || auth.Username != "host" || auth.ServerAddress != "server.example:8443" {
		t.Fatal("Docker 拉取身份无效")
	}
	raw, _ = base64.RawURLEncoding.DecodeString(auth.Password)
	var token struct {
		ExpiresAt int64  `json:"expires_at"`
		Signature []byte `json:"signature"`
	}
	if json.Unmarshal(raw, &token) != nil || token.ExpiresAt <= time.Now().Unix() || token.ExpiresAt > time.Now().Add(time.Hour).Unix() {
		t.Fatal("凭据期限无效")
	}
	message := []byte("monkeyai-engine/registry/v1\nhttps://server.example:8443\nhost\n" + strconv.FormatInt(token.ExpiresAt, 10))
	if !ed25519.Verify(public, message, token.Signature) {
		t.Fatal("拉取凭据未绑定宿主签名")
	}
	for _, target := range []string{"public.example/image@sha256:abc", "server.example:8443/other/image@sha256:abc", "server.example:8444/environments/image@sha256:abc"} {
		if _, err := client.RegistryAuth("host", target); err == nil {
			t.Fatal("允许向其他仓库发送宿主凭据", target)
		}
	}
}
