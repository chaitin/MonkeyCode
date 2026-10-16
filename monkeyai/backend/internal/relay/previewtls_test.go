package relay

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/endpoint"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"uuid"
)

func TestNginxPreviewTLS(t *testing.T) {
	image := os.Getenv("MONKEYAI_TEST_NGINX_IMAGE")
	if image == "" {
		t.Skip("需要测试 Nginx 镜像")
	}
	f := newFixture(t)
	f.previewHTML = true
	runtime := f.runtime(t)
	f.s.config.PreviewOriginTemplate = "https://{artifact}.preview.example.net"
	public, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	certTemplate := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "*.preview.example.net"}, DNSNames: []string{"*.preview.example.net"}, NotBefore: time.Now().Add(-time.Minute), NotAfter: time.Now().Add(time.Hour), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	cert, err := x509.CreateCertificate(rand.Reader, certTemplate, certTemplate, public, key)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	certPath, keyPath := filepath.Join(dir, "tls.crt"), filepath.Join(dir, "tls.key")
	if err = os.WriteFile(certPath, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: cert}), 0600); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(keyPath, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}), 0600); err != nil {
		t.Fatal(err)
	}
	previewData, err := os.ReadFile("../../../admin/nginx/preview.conf.template")
	if err != nil {
		t.Fatal(err)
	}
	preview := strings.NewReplacer("${MONKEYAI_PREVIEW_DOMAIN}", "preview.example.net", "${MONKEYAI_RUNTIME_PREVIEW_CERT_FILE}", "/etc/nginx/tls.crt", "${MONKEYAI_RUNTIME_PREVIEW_KEY_FILE}", "/etc/nginx/tls.key").Replace(string(previewData))
	upstream, _ := url.Parse(f.server.URL)
	config := "events {}\nhttp { upstream monkeyai_backend { server host.docker.internal:" + upstream.Port() + "; } server { listen 8080; location / { proxy_pass http://monkeyai_backend; proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection upgrade; } } include /etc/nginx/preview.conf; }"
	configPath, previewPath := filepath.Join(dir, "nginx.conf"), filepath.Join(dir, "preview.conf")
	os.WriteFile(configPath, []byte(config), 0600)
	os.WriteFile(previewPath, []byte(preview), 0600)
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	command := func(args ...string) string {
		t.Helper()
		data, err := exec.CommandContext(ctx, "docker", args...).CombinedOutput()
		if err != nil {
			t.Fatalf("预览 Nginx 命令失败：%s", data)
		}
		return strings.TrimSpace(string(data))
	}
	id := command("create", "--label", "monkeyai.task=preview-tls-test", "--add-host", "host.docker.internal:host-gateway", "-p", "127.0.0.1::8443", image)
	t.Cleanup(func() { exec.CommandContext(context.Background(), "docker", "rm", "-f", id).Run() })
	for _, pair := range [][2]string{{configPath, "/etc/nginx/nginx.conf"}, {previewPath, "/etc/nginx/preview.conf"}, {certPath, "/etc/nginx/tls.crt"}, {keyPath, "/etc/nginx/tls.key"}} {
		command("cp", pair[0], id+":"+pair[1])
	}
	command("start", id)
	command("exec", id, "nginx", "-t")
	address := command("port", id, "8443")
	roots := x509.NewCertPool()
	roots.AppendCertsFromPEM(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: cert}))
	transport := &http.Transport{TLSClientConfig: &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS12}, DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "tcp", address)
	}}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 5 * time.Second}
	request, _ := http.NewRequestWithContext(ctx, "GET", "https://"+strings.Repeat("a", 32)+".preview.example.net/api/auth/v1/session", nil)
	var response *http.Response
	for range 20 {
		response, err = client.Do(request)
		if err == nil {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-time.After(100 * time.Millisecond):
		}
	}
	if err != nil {
		logs := command("logs", id)
		t.Fatalf("TLS 预览握手失败：%v 日志=%s", err, logs)
	}
	io.Copy(io.Discard, response.Body)
	response.Body.Close()
	if response.StatusCode != 404 {
		t.Fatal("预览 TLS 域名开放了登录 API")
	}
	request, _ = http.NewRequestWithContext(ctx, "GET", "https://"+strings.Repeat("a", 32)+".preview.example.net/preview/missing/missing/index.html", nil)
	response, err = client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	io.Copy(io.Discard, response.Body)
	response.Body.Close()
	if response.StatusCode != 403 {
		t.Fatalf("TLS 预览未路由后端限定授权入口：%d", response.StatusCode)
	}
	now := time.Now().UTC()
	grant := FileGrant{Version: 1, ServerID: f.s.config.ServerID, OwnerUserID: f.user, MachineID: runtime.hello.MachineID, SessionID: uuid.New().String(), ArtifactID: uuid.New().String(), Path: "output/app", Scope: "directory", KeyID: endpoint.KeyID(runtime.private.Public().(ed25519.PublicKey)), GrantVersion: runtime.ready.GrantVersion, IssuedAt: now, ExpiresAt: now.Add(5 * time.Minute)}
	grant.PreviewOrigin = PreviewOrigin(f.s.config.PreviewOriginTemplate, grant.ServerID, grant.OwnerUserID, grant.MachineID, grant.SessionID, grant.ArtifactID)
	payload, _ := json.Marshal(grant)
	message, _ := FileGrantBytes(grant)
	raw := base64.RawURLEncoding.EncodeToString(payload) + "." + base64.RawURLEncoding.EncodeToString(ed25519.Sign(runtime.private, message))
	request, _ = http.NewRequestWithContext(ctx, "GET", grant.PreviewOrigin+"/preview/"+grant.MachineID+"/"+raw+"/output/app/index.html", nil)
	request.Header.Set("Cookie", "monkeyai_session=secret")
	response, err = client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(response.Body)
	response.Body.Close()
	if response.StatusCode != 200 || !strings.Contains(string(body), "产物预览隔离测试") || !strings.Contains(response.Header.Get("Content-Security-Policy"), "sandbox allow-scripts;") || strings.Contains(response.Header.Get("Content-Security-Policy"), "allow-same-origin") {
		t.Fatal("真实TLS产物预览内容或隔离策略错误")
	}
	logs := command("logs", id)
	if strings.Contains(logs, raw) {
		t.Fatal("预览 Nginx 日志泄露文件授权")
	}
}
