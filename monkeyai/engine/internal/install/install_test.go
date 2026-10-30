package install

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/control"
)

func TestManifestRejectsTamperingMissingFilesAndArchitecture(t *testing.T) {
	m := Manifest{Version: "v1", Architecture: "amd64", Files: map[string]string{}}
	for name := range targets {
		m.Files[name] = strings.Repeat("a", 64)
	}
	raw, _ := json.Marshal(m)
	c := Config{Release: "v1", Architecture: "amd64", ManifestSHA: control.Digest(raw)}
	if _, err := ParseManifest(raw, c); err != nil {
		t.Fatal(err)
	}
	if _, err := ParseManifest(append(raw, ' '), c); err == nil {
		t.Fatal("接受清单篡改")
	}
	c.Architecture = "arm64"
	if _, err := ParseManifest(raw, c); err == nil {
		t.Fatal("接受错误架构")
	}
	c.Architecture = "amd64"
	delete(m.Files, "runsc")
	raw, _ = json.Marshal(m)
	c.ManifestSHA = control.Digest(raw)
	if _, err := ParseManifest(raw, c); err == nil {
		t.Fatal("接受缺失组件")
	}
}
func TestConfigurationRejectsUnsafePaths(t *testing.T) {
	c := Config{Server: "https://console.example", Enrollment: strings.Repeat("a", 43), Release: "v1", Architecture: "amd64", ManifestSHA: strings.Repeat("a", 64), DataDir: "/var/lib/monkeyai-engine/data"}
	if err := c.Validate(); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/", "/data/../etc", "/data//test", "/data;reboot", "relative"} {
		c.DataDir = path
		if err := c.Validate(); err == nil {
			t.Fatalf("接受不安全路径 %s", path)
		}
	}
}
func TestBootstrapStopsBeforeExecutionOnChecksumFailure(t *testing.T) {
	root := t.TempDir()
	bin := filepath.Join(root, "bin")
	if err := os.Mkdir(bin, 0700); err != nil {
		t.Fatal(err)
	}
	// 替身只模拟系统探测与损坏下载，不操作真实宿主。
	scripts := map[string]string{
		"uname":     "case \"$1\" in -s) echo Linux;; -m) echo x86_64;; esac",
		"id":        "echo 0",
		"systemctl": "exit 0",
		"curl":      "while [ \"$#\" -gt 0 ]; do if [ \"$1\" = -o ]; then shift; printf '#!/bin/sh\\ntouch %s\\n' \"$MARKER\" > \"$1\"; exit 0; fi; shift; done; exit 1",
	}
	for name, script := range scripts {
		if err := os.WriteFile(filepath.Join(bin, name), []byte("#!/bin/sh\n"+script+"\n"), 0700); err != nil {
			t.Fatal(err)
		}
	}
	raw, err := os.ReadFile("../../../backend/internal/enginehost/install.sh")
	if err != nil {
		t.Fatal(err)
	}
	// 本机无 systemd，只移除只读目录存在检查以覆盖下载失败路径。
	script := strings.Replace(string(raw), "[ -d /run/systemd/system ] || fail '宿主需要运行 systemd'", "true", 1)
	path := filepath.Join(root, "install.sh")
	if err := os.WriteFile(path, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(root, "executed")
	cmd := exec.Command("sh", path, "https://example.com", strings.Repeat("x", 43), "v1", "amd64", strings.Repeat("0", 64), strings.Repeat("1", 64), "/data/engine")
	cmd.Env = append(os.Environ(), "PATH="+bin+":"+os.Getenv("PATH"), "MARKER="+marker)
	output, err := cmd.CombinedOutput()
	if err == nil || !strings.Contains(string(output), "安装器校验失败") {
		t.Fatalf("未覆盖校验失败路径: %v %s", err, output)
	}
	if _, err := os.Stat(marker); !os.IsNotExist(err) {
		t.Fatal("校验失败后仍执行下载的二进制")
	}
}
