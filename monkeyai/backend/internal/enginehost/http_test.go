package enginehost

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestServerHTTPUpgradeScript(t *testing.T) {
	service := NewService(nil).WithInstallation("http://server.example:8080", fixture(t), "v1")
	router := chi.NewRouter()
	registerAdmin(router, service)
	service.Register(router)
	response := call(router, http.MethodGet, "/engine-upgrade", nil)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "http://server.example:8080") {
		t.Fatal(response.Code, response.Body.String())
	}
	response = call(router, http.MethodGet, "/api/host/v1/install.sh?version=v1", nil)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "'=http,https'") {
		t.Fatal(response.Code, response.Body.String())
	}
	for _, valid := range []string{"http://server.example", "https://server.example", "http://127.0.0.1:8080/"} {
		if !validServer(valid) {
			t.Fatal(valid)
		}
	}
	for _, bad := range []string{"ftp://server.example", "http://user:pass@server.example", "http://server.example/path", "http://server.example?", "http://server.example#x"} {
		if validServer(bad) {
			t.Fatal("接受非法server", bad)
		}
	}
}

func TestBootstrapDownloadsFromHTTPServer(t *testing.T) {
	cmd, dir := bootstrapCommand(t, false, "0")
	fixture, err := os.ReadFile(filepath.Join(dir, "installer"))
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/host/v1/releases/v1/arm64/installer" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write(fixture)
	}))
	defer server.Close()
	if err := os.Remove(filepath.Join(dir, "bin/curl")); err != nil {
		t.Fatal(err)
	}
	cmd.Args[2] = server.URL
	cmd.Env = append(cmd.Env, "NO_PROXY=127.0.0.1,localhost", "no_proxy=127.0.0.1,localhost")
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("HTTP引导失败：%v %s", err, out)
	}
	if _, err := os.Stat(filepath.Join(dir, "executed")); err != nil {
		t.Fatal("校验后的安装器未执行", err)
	}
}
