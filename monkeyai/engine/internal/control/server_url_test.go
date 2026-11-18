package control

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestServerURLKeepsSigningOrigin(t *testing.T) {
	const origin = "https://control.example"
	public, key, _ := ed25519.GenerateKey(rand.Reader)
	task := remoteTask()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/host/v1/time" {
			json.NewEncoder(w).Encode(map[string]any{"at": time.Now().UTC()})
			return
		}
		if strings.HasSuffix(r.URL.Path, "/installer") {
			w.Write([]byte("installer"))
			return
		}
		var in struct {
			Name, Token, Architecture, Version string
			HostID                             string `json:"host_id"`
			At                                 time.Time
			Report, Payload                    json.RawMessage
			Signature                          []byte
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			t.Error(err)
		}
		var message string
		switch r.URL.Path {
		case "/api/host/v1/enroll":
			message = "monkeyai-engine/enroll/v1\n" + origin + "\n" + in.Token + "\n" + in.Architecture + "\n" + in.Version + "\n" + in.Name
			json.NewEncoder(w).Encode(map[string]string{"host_id": "host-a"})
		case "/api/host/v1/heartbeat", "/api/host/v1/exchange":
			purpose, payload := "heartbeat", in.Report
			if strings.HasSuffix(r.URL.Path, "/exchange") {
				purpose, payload = "exchange", in.Payload
			}
			message = "monkeyai-engine/" + purpose + "/v2\n" + origin + "\n" + in.HostID + "\n" + in.At.UTC().Format(time.RFC3339Nano) + "\n" + Digest(payload)
			json.NewEncoder(w).Encode(map[string]bool{"accepted": true})
		default:
			t.Error("意外请求", r.URL.Path)
			http.NotFound(w, r)
			return
		}
		if !ed25519.Verify(public, []byte(message), in.Signature) {
			t.Error("覆盖访问地址改变了签名绑定", r.URL.Path)
		}
	}))
	defer server.Close()
	cfg := Config{Server: origin, ServerURL: server.URL + "/"}
	raw, _ := json.Marshal(cfg)
	if err := json.Unmarshal(raw, &cfg); err != nil {
		t.Fatal(err)
	}
	client, err := cfg.Client(key)
	if err != nil {
		t.Fatal(err)
	}
	if id, err := client.Enroll(t.Context(), "token", "amd64", "v1"); err != nil || id != "host-a" {
		t.Fatal(id, err)
	}
	if err := client.Heartbeat(t.Context(), "host-a", map[string]any{"ready": true}); err != nil {
		t.Fatal(err)
	}
	var response map[string]bool
	if err := client.Exchange(t.Context(), "host-a", map[string]int{"protocol": 1}, &response); err != nil {
		t.Fatal(err)
	}
	if err := downloadInstaller(t.Context(), client, task, "amd64", filepath.Join(t.TempDir(), "installer")); err != nil {
		t.Fatal("升级仍访问原地址", err)
	}
	endpoint, _ := url.Parse(server.URL)
	auth, err := client.RegistryAuth("host-a", endpoint.Host+"/environments/image@sha256:"+strings.Repeat("a", 64))
	if err != nil {
		t.Fatal(err)
	}
	raw, _ = base64.URLEncoding.DecodeString(auth)
	var credentials struct{ Username, Password, ServerAddress string }
	if err := json.Unmarshal(raw, &credentials); err != nil || credentials.ServerAddress != endpoint.Host {
		t.Fatal(credentials, err)
	}
	raw, _ = base64.RawURLEncoding.DecodeString(credentials.Password)
	var token struct {
		ExpiresAt int64 `json:"expires_at"`
		Signature []byte
	}
	if err := json.Unmarshal(raw, &token); err != nil {
		t.Fatal(err)
	}
	message := "monkeyai-engine/registry/v1\n" + origin + "\nhost-a\n" + strconv.FormatInt(token.ExpiresAt, 10)
	if !ed25519.Verify(public, []byte(message), token.Signature) {
		t.Fatal("内网仓库凭据改变了签名绑定")
	}
	if _, err := client.RegistryAuth("host-a", "control.example/environments/image@sha256:"+strings.Repeat("a", 64)); err == nil {
		t.Fatal("凭据仍允许发送到原仓库地址")
	}
	for _, address := range []string{"ftp://server.example", "http://user:pass@server.example", "http://server.example/path"} {
		cfg.ServerURL = address
		if _, err := cfg.Client(key); err == nil {
			t.Fatal("接受非法访问地址", address)
		}
	}
}
