package enginehost

import (
	"context"
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/license"
	"github.com/go-chi/chi/v5"
)

type installationLicense bool

func (allowed installationLicense) Capabilities(context.Context) (license.Capabilities, error) {
	return license.Capabilities{AllowHostInstallation: bool(allowed)}, nil
}

type failingLicense struct{}

func (failingLicense) Capabilities(context.Context) (license.Capabilities, error) {
	return license.Capabilities{AllowHostInstallation: true}, errors.New("读取授权失败")
}

type liveInstallationLicense struct{ active atomic.Bool }

func (l *liveInstallationLicense) Capabilities(ctx context.Context) (license.Capabilities, error) {
	return installationLicense(l.active.Load()).Capabilities(ctx)
}

func TestInstallationRoutesRequireLicense(t *testing.T) {
	for _, tt := range []struct {
		name   string
		reader license.Reader
	}{
		{"未配置授权来源", nil},
		{"未授权", installationLicense(false)},
		{"授权状态读取失败", failingLicense{}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			r := chi.NewRouter()
			s := NewService(nil).WithLicense(tt.reader)
			s.RegisterAdmin(r)
			s.Register(r)
			for _, req := range []struct{ method, path string }{
				{http.MethodPost, "/engine-host-enrollments"},
				{http.MethodPost, "/engine-hosts/" + testAdmin + "/enrollment"},
				{http.MethodGet, "/engine-upgrade"},
				{http.MethodPost, "/engine-hosts/" + testAdmin + "/upgrade"},
				{http.MethodGet, "/api/host/v1/install.sh?token=old"},
				{http.MethodGet, "/api/host/v1/install.sh?version=v1"},
				{http.MethodGet, "/api/host/v1/upgrade.sh?version=v1"},
				{http.MethodGet, "/api/host/v1/releases/v1/amd64/installer"},
				{http.MethodPost, "/api/host/v1/enroll"},
			} {
				w := call(r, req.method, req.path, nil)
				if w.Code != http.StatusForbidden || w.Header().Get("Cache-Control") != "no-store" || !strings.Contains(w.Body.String(), "导入有效的 License") {
					t.Fatalf("%s %s: %d %s", req.method, req.path, w.Code, w.Body.String())
				}
			}
		})
	}
}

func TestLicenseRecheckedForIssuedEnrollment(t *testing.T) {
	db := testPool(t)
	allowed := installationLicense(false)
	s := NewService(db).WithInstallation("https://console.example", fixture(t), "v1").WithLicense(&allowed)
	r := chi.NewRouter()
	registerAdmin(r, s)
	s.Register(r)

	issue := func() *httptest.ResponseRecorder {
		return call(r, http.MethodPost, "/engine-host-enrollments", map[string]any{})
	}
	if w := issue(); w.Code != http.StatusForbidden {
		t.Fatalf("无授权签发命令: %d %s", w.Code, w.Body.String())
	}
	var count int
	if err := db.QueryRow(t.Context(), "SELECT COUNT(*) FROM hosts").Scan(&count); err != nil || count != 0 {
		t.Fatalf("无授权请求创建了待接入记录: %d %v", count, err)
	}

	allowed = true
	w := issue()
	var result struct {
		ID      string `json:"host_id"`
		Command string
	}
	if w.Code != http.StatusCreated || json.Unmarshal(w.Body.Bytes(), &result) != nil {
		t.Fatalf("授权后未能签发命令: %d %s", w.Code, w.Body.String())
	}
	token := commandCredential(t, result.Command)
	script := "/api/host/v1/install.sh?token=" + url.QueryEscape(token)
	if w := call(r, http.MethodGet, script, nil); w.Code != http.StatusOK {
		t.Fatalf("授权后未能获取脚本: %d %s", w.Code, w.Body.String())
	}

	pub, key, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	message := "monkeyai-engine/enroll/v1\n" + s.server + "\n" + token + "\namd64\nv1"
	body := map[string]any{"token": token, "public_key": []byte(pub), "signature": ed25519.Sign(key, []byte(message)), "architecture": "amd64", "version": "v1"}
	allowed = false
	if w := call(r, http.MethodGet, script, nil); w.Code != http.StatusForbidden {
		t.Fatalf("授权失效后仍能获取脚本: %d", w.Code)
	}
	if w := call(r, http.MethodPost, "/api/host/v1/enroll", body); w.Code != http.StatusForbidden {
		t.Fatalf("授权失效后仍能接入: %d", w.Code)
	}
	allowed = true
	if w := call(r, http.MethodPost, "/api/host/v1/enroll", body); w.Code != http.StatusOK {
		t.Fatalf("恢复授权后未能接入: %d %s", w.Code, w.Body.String())
	}
	allowed = false
	report := json.RawMessage(`{"version":1,"engine_version":"v1"}`)
	heartbeat := signedHeartbeat(key, s.server, result.ID, time.Now().UTC(), report)
	if w := call(r, http.MethodPost, "/api/host/v1/heartbeat", heartbeat); w.Code != http.StatusOK {
		t.Fatalf("授权失效影响了已接入宿主的心跳: %d %s", w.Code, w.Body.String())
	}
}

func TestCachedInstallationScriptStopsBeforeLaunchingInstaller(t *testing.T) {
	cmd, dir := bootstrapCommand(t, false, "0")
	if err := os.Remove(filepath.Join(dir, "bin", "curl")); err != nil {
		t.Fatal(err)
	}
	r := chi.NewRouter()
	server := httptest.NewUnstartedServer(r)
	source := new(liveInstallationLicense)
	source.active.Store(true)
	NewService(nil).WithInstallation("http://"+server.Listener.Addr().String(), fixture(t), "v1").WithLicense(source).Register(r)
	server.Start()
	defer server.Close()
	w := call(r, http.MethodGet, "/api/host/v1/install.sh?version=v1", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("授权时未返回脚本: %d", w.Code)
	}
	script := strings.Replace(w.Body.String(), "[ -d /run/systemd/system ] || fail '宿主需要运行 systemd'", "true", 1)
	if err := os.WriteFile(cmd.Args[1], []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	cmd.Args = []string{"bash", cmd.Args[1]}
	cmd.Path = "/bin/bash"
	cmd.Env = append(cmd.Env, "NO_PROXY=127.0.0.1,localhost", "no_proxy=127.0.0.1,localhost")
	source.active.Store(false)
	if output, err := cmd.CombinedOutput(); err == nil || !strings.Contains(string(output), "403") {
		t.Fatalf("缓存脚本没有因授权失效而停止: %v %s", err, output)
	}
	if _, err := os.Stat(filepath.Join(dir, "args")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("授权失效后启动了安装任务: %v", err)
	}
}
