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
	"time"
)

func TestClientSignedRequestsAndRevocation(t *testing.T) {
	for _, secure := range []bool{false, true} {
		name := "http"
		if secure {
			name = "https"
		}
		t.Run(name, func(t *testing.T) { testSignedRequests(t, secure) })
	}
}

func testSignedRequests(t *testing.T, secure bool) {
	pub, key, _ := ed25519.GenerateKey(rand.Reader)
	revoked := false
	var server *httptest.Server
	server = httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if revoked {
			w.WriteHeader(401)
			return
		}
		switch r.URL.Path {
		case "/api/host/v1/enroll":
			var in struct {
				Name         string
				Token        string `json:"token"`
				PublicKey    []byte `json:"public_key"`
				Signature    []byte `json:"signature"`
				Architecture string `json:"architecture"`
				Version      string `json:"version"`
			}
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				t.Error(err)
			}
			if !ed25519.Verify(pub, []byte("monkeyai-engine/enroll/v1\n"+server.URL+"\n"+in.Token+"\n"+in.Architecture+"\n"+in.Version+"\n"+in.Name), in.Signature) {
				t.Error("注册签名不匹配")
			}
			_ = json.NewEncoder(w).Encode(map[string]string{"host_id": "host-1"})
		case "/api/host/v1/time":
			_ = json.NewEncoder(w).Encode(map[string]any{"at": time.Now().UTC()})
		case "/api/host/v1/heartbeat":
			var in struct {
				HostID    string          `json:"host_id"`
				At        time.Time       `json:"at"`
				Report    json.RawMessage `json:"report"`
				Signature []byte          `json:"signature"`
			}
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				t.Error(err)
			}
			if !ed25519.Verify(pub, []byte("monkeyai-engine/heartbeat/v2\n"+server.URL+"\n"+in.HostID+"\n"+in.At.UTC().Format(time.RFC3339Nano)+"\n"+Digest(in.Report)), in.Signature) {
				t.Error("心跳签名不匹配")
			}
			_ = json.NewEncoder(w).Encode(map[string]bool{"accepted": true})
		case "/api/host/v1/exchange":
			var in struct {
				HostID    string          `json:"host_id"`
				At        time.Time       `json:"at"`
				Payload   json.RawMessage `json:"payload"`
				Signature []byte          `json:"signature"`
			}
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				t.Error(err)
			}
			message := []byte("monkeyai-engine/exchange/v2\n" + server.URL + "\n" + in.HostID + "\n" + in.At.UTC().Format(time.RFC3339Nano) + "\n" + Digest(in.Payload))
			if !ed25519.Verify(pub, message, in.Signature) {
				t.Error("同步签名不匹配")
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"protocol": 1})
		default:
			t.Errorf("意外路径 %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	if secure {
		server.StartTLS()
	} else {
		server.Start()
	}
	defer server.Close()
	c, err := New(server.URL, key)
	if err != nil {
		t.Fatal(err)
	}
	if secure {
		if _, err := c.Enroll(t.Context(), strings.Repeat("a", 43), "amd64", "v1"); err == nil {
			t.Fatal("默认连接接受了不受信任的证书")
		}
	}
	raw, err := json.Marshal(Config{Server: server.URL, Insecure: secure})
	if err != nil {
		t.Fatal(err)
	}
	var cfg Config
	if err := json.Unmarshal(raw, &cfg); err != nil {
		t.Fatal(err)
	}
	c.WithInsecure(cfg.Insecure)
	id, err := c.Enroll(t.Context(), strings.Repeat("a", 43), "amd64", "v1")
	if err != nil || id != "host-1" {
		t.Fatalf("注册失败: %s %v", id, err)
	}
	if err := c.Heartbeat(t.Context(), id, map[string]any{"detail": "测试 <>&", "checks": []string{}}); err != nil {
		t.Fatal(err)
	}
	var exchanged struct {
		Protocol int `json:"protocol"`
	}
	if err := c.Exchange(t.Context(), id, map[string]any{"protocol": 1}, &exchanged); err != nil || exchanged.Protocol != 1 {
		t.Fatal("同步失败", err)
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
	for _, server := range []string{"http://example.com", "https://example.com", "http://127.0.0.1:8080", "https://[::1]:8443/"} {
		if err := ValidateServer(server); err != nil {
			t.Fatal(server, err)
		}
	}
	for _, server := range []string{"ftp://example.com", "https://user:pass@example.com", "http://example.com?a=b", "http://example.com?", "https://example.com/#token", "http://example.com/base"} {
		if err := ValidateServer(server); err == nil {
			t.Fatalf("接受无效后台地址 %s", server)
		}
	}
}
