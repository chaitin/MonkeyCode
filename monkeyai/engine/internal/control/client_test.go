package control

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestClientSignedRequestsAndRevocation(t *testing.T) {
	pub, key, _ := ed25519.GenerateKey(rand.Reader)
	revoked := false
	var server *httptest.Server
	server = httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if revoked {
			w.WriteHeader(401)
			return
		}
		switch r.URL.Path {
		case "/api/host/v1/enroll":
			var in struct {
				Token        string `json:"token"`
				PublicKey    []byte `json:"public_key"`
				Signature    []byte `json:"signature"`
				Architecture string `json:"architecture"`
				Version      string `json:"version"`
			}
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				t.Error(err)
			}
			if !ed25519.Verify(pub, []byte("monkeyai-engine/enroll/v1\n"+server.URL+"\n"+in.Token+"\n"+in.Architecture+"\n"+in.Version), in.Signature) {
				t.Error("注册签名不匹配")
			}
			_ = json.NewEncoder(w).Encode(map[string]string{"host_id": "host-1"})
		case "/api/host/v1/challenges":
			_ = json.NewEncoder(w).Encode(map[string]string{"challenge": strings.Repeat("x", 43)})
		case "/api/host/v1/heartbeat":
			var in struct {
				HostID    string          `json:"host_id"`
				Challenge string          `json:"challenge"`
				Report    json.RawMessage `json:"report"`
				Signature []byte          `json:"signature"`
			}
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				t.Error(err)
			}
			if !ed25519.Verify(pub, []byte("monkeyai-engine/heartbeat/v1\n"+server.URL+"\n"+in.HostID+"\n"+in.Challenge+"\n"+Digest(in.Report)), in.Signature) {
				t.Error("心跳签名不匹配")
			}
			_ = json.NewEncoder(w).Encode(map[string]bool{"accepted": true})
		default:
			t.Errorf("意外路径 %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	c, err := New(server.URL, key)
	if err != nil {
		t.Fatal(err)
	}
	c.HTTP = server.Client()
	id, err := c.Enroll(t.Context(), strings.Repeat("a", 43), "amd64", "v1")
	if err != nil || id != "host-1" {
		t.Fatalf("注册失败: %s %v", id, err)
	}
	if err := c.Heartbeat(t.Context(), id, map[string]any{"detail": "测试 <>&", "checks": []string{}}); err != nil {
		t.Fatal(err)
	}
	revoked = true
	if err := c.Heartbeat(t.Context(), id, map[string]any{}); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("撤销未生效: %v", err)
	}
}
func TestIdentityIsPersistentAndPrivate(t *testing.T) {
	path := filepath.Join(t.TempDir(), "identity.key")
	first, err := Key(path)
	if err != nil {
		t.Fatal(err)
	}
	second, err := Key(path)
	if err != nil {
		t.Fatal(err)
	}
	if !first.Equal(second) {
		t.Fatal("重启生成了不同身份")
	}
	if err := os.Chmod(path, 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := Key(path); err == nil {
		t.Fatal("接受公开可读私钥")
	}
}
func TestServerValidation(t *testing.T) {
	for _, server := range []string{"http://example.com", "https://user:pass@example.com", "https://example.com?a=b", "https://example.com/#token"} {
		if err := ValidateServer(server); err == nil {
			t.Fatalf("接受无效后台地址 %s", server)
		}
	}
}
