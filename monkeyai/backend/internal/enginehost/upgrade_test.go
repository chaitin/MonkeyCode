package enginehost

import (
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestUpgradeCommandAndScript(t *testing.T) {
	root := fixture(t)
	s := NewService(nil).WithInstallation("https://server.example", root, "v1")
	r := chi.NewRouter()
	registerAdmin(r, s)
	s.Register(r)
	response := call(r, http.MethodGet, "/engine-upgrade", nil)
	if response.Code != 200 {
		t.Fatal(response.Code, response.Body.String())
	}
	var result struct{ Version, Command string }
	if json.Unmarshal(response.Body.Bytes(), &result) != nil || result.Version != "v1" || !strings.Contains(result.Command, "install.sh?version=v1") || strings.Contains(result.Command, "token=") {
		t.Fatal(result)
	}
	script := call(r, http.MethodGet, "/api/host/v1/upgrade.sh?version=v1", nil)
	if script.Code != 200 || script.Header().Get("Cache-Control") != "no-store" {
		t.Fatal(script.Code)
	}
	body := script.Body.String()
	unified := call(r, http.MethodGet, "/api/host/v1/install.sh?version=v1", nil)
	if unified.Code != 200 || unified.Body.String() != body {
		t.Fatal("安装升级脚本不一致")
	}
	for _, want := range []string{"x86_64|amd64", "aarch64|arm64", "/installer", "monkeyai-engine install", "--manifest-sha256", "systemd-run", "sha256sum"} {
		if !strings.Contains(body, want) {
			t.Fatal("缺少", want)
		}
	}
	if strings.Contains(body, "release.monkeycode-ai.com") {
		t.Fatal("升级不应重新注册或访问公网发行源")
	}
	cmd := exec.Command("bash", "-n")
	cmd.Stdin = strings.NewReader(body)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatal(err, string(out))
	}
	cmd = exec.Command("bash", "-n")
	cmd.Stdin = strings.NewReader(body[:strings.LastIndex(body, "}\ninstall_engine")])
	if cmd.Run() == nil {
		t.Fatal("截断升级脚本可执行")
	}
	if res := call(r, http.MethodGet, "/api/host/v1/upgrade.sh?version=../bad", nil); res.Code != 400 {
		t.Fatal(res.Code)
	}
	if err := os.Remove(filepath.Join(root, "v1", "arm64", "installer")); err != nil {
		t.Fatal(err)
	}
	if res := call(r, http.MethodGet, "/engine-upgrade", nil); res.Code != 503 {
		t.Fatal("缺少架构资源却生成升级命令", res.Code)
	}
}
