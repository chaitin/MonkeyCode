package relay

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/endpoint"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
	"uuid"
)

func TestArtifactPreviewBindsHostGrantAndOpaqueSandbox(t *testing.T) {
	f := newFixture(t)
	runtime := f.runtime(t)
	template := "https://{artifact}.preview.example.net"
	f.s.config.PreviewOriginTemplate = template
	now := time.Now().UTC()
	grant := FileGrant{Version: 1, ServerID: f.s.config.ServerID, OwnerUserID: f.user, MachineID: runtime.hello.MachineID, SessionID: uuid.New().String(), ArtifactID: uuid.New().String(), Path: "output/app", Scope: "directory", KeyID: f.s.kid, GrantVersion: runtime.ready.GrantVersion, IssuedAt: now, ExpiresAt: now.Add(5 * time.Minute)}
	grant.KeyID = endpoint.KeyID(runtime.private.Public().(ed25519.PublicKey))
	grant.PreviewOrigin = PreviewOrigin(template, grant.ServerID, grant.OwnerUserID, grant.MachineID, grant.SessionID, grant.ArtifactID)
	encode := func(grant FileGrant) string {
		data, _ := json.Marshal(grant)
		message, _ := FileGrantBytes(grant)
		return base64.RawURLEncoding.EncodeToString(data) + "." + base64.RawURLEncoding.EncodeToString(ed25519.Sign(runtime.private, message))
	}
	raw := encode(grant)
	origin, _ := url.Parse(grant.PreviewOrigin)
	call := func(host, raw, p string, want int) http.Header {
		t.Helper()
		request, _ := http.NewRequestWithContext(t.Context(), "GET", f.server.URL+"/preview/"+grant.MachineID+"/"+raw+"/"+p, nil)
		request.Host = host
		request.Header.Set("Cookie", "monkeyai_session=secret; parent_cookie=secret")
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		io.Copy(io.Discard, response.Body)
		if response.StatusCode != want {
			t.Fatalf("预览状态=%d want=%d", response.StatusCode, want)
		}
		return response.Header
	}
	headers := call(origin.Host, raw, "output/app/index.html", 200)
	csp := headers.Get("Content-Security-Policy")
	if !strings.Contains(csp, "sandbox allow-scripts;") || strings.Contains(csp, "allow-same-origin") || !strings.Contains(csp, "connect-src 'none'") || !strings.Contains(csp, "worker-src 'none'") {
		t.Fatal("HTTP 预览未禁止来源存储或跨源通信")
	}
	if headers.Get("Content-Disposition") != "" || headers.Get("Set-Cookie") != "" || headers.Get("Access-Control-Allow-Credentials") != "" || headers.Get("Referrer-Policy") != "no-referrer" {
		t.Fatal("预览泄露登录渠道或错误下载")
	}
	call(origin.Host, raw, "output/app/assets/app.js", 200)
	call("control.example.com", raw, "output/app/index.html", 403)
	call(strings.Repeat("a", 32)+".preview.example.net", raw, "output/app/index.html", 403)
	call(origin.Host, raw, "output/other/index.html", 403)
	other := grant
	other.ArtifactID = uuid.New().String()
	other.PreviewOrigin = PreviewOrigin(template, other.ServerID, other.OwnerUserID, other.MachineID, other.SessionID, other.ArtifactID)
	call(origin.Host, encode(other), "output/app/index.html", 403)
	guard := PreviewGuard(template)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }))
	for _, host := range []string{origin.Host, "invalid.preview.example.net", "preview.example.net"} {
		req := httptest.NewRequest("GET", "https://"+host+"/api/auth/v1/session", nil)
		response := httptest.NewRecorder()
		guard.ServeHTTP(response, req)
		if response.Code != 404 {
			t.Fatal("预览域能访问登录 API")
		}
	}
}

func TestPreviewTemplateRejectsSharedOrUntrustedOrigins(t *testing.T) {
	for _, template := range []string{"http://{artifact}.preview.example.net", "https://preview.example.net/{artifact}", "https://{artifact}.example.com", "https://{artifact}.preview.example.net:443", "https://{artifact}.preview.example.net/?x=1"} {
		if validatePreviewTemplate(template, "https://control.example.com", "https://files.example.com") == nil {
			t.Fatalf("接受危险预览模板 %s", template)
		}
	}
	if err := validatePreviewTemplate("https://{artifact}.preview.example.net", "https://control.example.com", "https://files.example.com"); err != nil {
		t.Fatal(err)
	}
	first := PreviewOrigin("https://{artifact}.preview.example.net", "server", "user", "machine", "session", "artifact")
	if first == PreviewOrigin("https://{artifact}.preview.example.net", "other-server", "user", "machine", "session", "artifact") {
		t.Fatal("跨控制面共用产物来源")
	}
}
