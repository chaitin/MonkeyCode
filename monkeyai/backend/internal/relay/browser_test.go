package relay

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"
	"uuid"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/endpoint"
)

func TestBrowserPreviewSandbox(t *testing.T) {
	output := os.Getenv("MONKEYAI_BROWSER_PREVIEW_DIR")
	if output == "" {
		t.Skip("设置 MONKEYAI_BROWSER_PREVIEW_DIR 配合真实浏览器验收")
	}
	f := newFixture(t)
	f.previewHTML = true
	runtime := f.runtime(t)
	f.s.config.PreviewOriginTemplate = "https://{artifact}.preview.example.net"
	now := time.Now().UTC()
	grant := FileGrant{Version: 1, ServerID: f.s.config.ServerID, OwnerUserID: f.user, MachineID: runtime.hello.MachineID, SessionID: uuid.New().String(), ArtifactID: uuid.New().String(), Path: "output/app", Scope: "directory", KeyID: endpoint.KeyID(runtime.private.Public().(ed25519.PublicKey)), GrantVersion: runtime.ready.GrantVersion, IssuedAt: now, ExpiresAt: now.Add(5 * time.Minute)}
	grant.PreviewOrigin = PreviewOrigin(f.s.config.PreviewOriginTemplate, grant.ServerID, grant.OwnerUserID, grant.MachineID, grant.SessionID, grant.ArtifactID)
	origin, _ := url.Parse(grant.PreviewOrigin)
	payload, _ := json.Marshal(grant)
	message, _ := FileGrantBytes(grant)
	raw := base64.RawURLEncoding.EncodeToString(payload) + "." + base64.RawURLEncoding.EncodeToString(ed25519.Sign(runtime.private, message))
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.Host = origin.Host
		f.server.Config.Handler.ServeHTTP(w, r)
	}))
	t.Cleanup(server.Close)
	data, _ := json.Marshal(map[string]string{"url": server.URL + "/preview/" + grant.MachineID + "/" + raw + "/output/app/index.html"})
	if err := os.WriteFile(filepath.Join(output, "ready.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-t.Context().Done():
			t.Fatal("浏览器验收超时")
		case <-ticker.C:
			result, err := os.ReadFile(filepath.Join(output, "result.json"))
			if os.IsNotExist(err) {
				continue
			}
			if err != nil {
				t.Fatal(err)
			}
			var values map[string]string
			if json.Unmarshal(result, &values) != nil {
				t.Fatal("浏览器验收结果无效")
			}
			for _, key := range []string{"localStorage", "cookie", "indexedDB", "serviceWorker"} {
				if values[key] != "blocked" {
					t.Fatalf("浏览器没有禁止 %s", key)
				}
			}
			return
		}
	}
}
