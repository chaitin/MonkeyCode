package enginehost

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestReleaseComponents(t *testing.T) {
	for _, names := range []map[string]bool{files, legacyFiles} {
		got := make(map[string]string, len(names))
		for name := range names {
			got[name] = strings.Repeat("a", 64)
		}
		if !validReleaseFiles(got) {
			t.Fatal("拒绝完整发行清单")
		}
		delete(got, "runsc")
		if validReleaseFiles(got) {
			t.Fatal("接受缺少隔离组件的清单")
		}
		got["unknown"] = strings.Repeat("a", 64)
		if validReleaseFiles(got) {
			t.Fatal("接受未知组件")
		}
	}
}

func TestHostArchiveRoute(t *testing.T) {
	dir := fixture(t)
	s := NewService(nil).WithInstallation("https://control.example", dir, "v1")
	router := chi.NewRouter()
	s.Register(router)
	path := filepath.Join(dir, "v1", "amd64", "resources.tgz")
	if err := os.WriteFile(path, []byte("host-archive"), 0644); err != nil {
		t.Fatal(err)
	}
	w := call(router, "GET", "/api/host/v1/releases/v1/amd64/resources.tgz", nil)
	if w.Code != 200 || w.Body.String() != "host-archive" || w.Header().Get("Content-Length") != "12" {
		t.Fatalf("资源包下载失败: %d", w.Code)
	}
	if w := call(router, "GET", "/api/host/v1/releases/v1/arm64/resources.tgz", nil); w.Code != 404 {
		t.Fatal("接受不存在的资源包")
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(dir, "v1", "amd64", "runsc"), path); err != nil {
		t.Fatal(err)
	}
	if w := call(router, "GET", "/api/host/v1/releases/v1/amd64/resources.tgz", nil); w.Code != 404 {
		t.Fatal("接受链接资源包")
	}
}

func TestInstallationScriptAndAutomaticIdentity(t *testing.T) {
	pool := testPool(t)
	s := NewService(pool).WithInstallation("https://control.example", fixture(t), "v1")
	router := chi.NewRouter()
	s.RegisterAdmin(router)
	s.Register(router)
	created := call(router, "POST", "/engine-host-enrollments", map[string]string{})
	if created.Code != 201 {
		t.Fatalf("创建失败 %d", created.Code)
	}
	var enrollment struct {
		ID      string `json:"host_id"`
		Command string `json:"command"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &enrollment); err != nil {
		t.Fatal(err)
	}
	if len(enrollment.Command) > 200 || !strings.HasPrefix(enrollment.Command, `sudo bash -c "$(curl -kfsSL `) {
		t.Fatal("命令没有简化")
	}
	secret := token()
	if _, err := pool.Exec(t.Context(), `UPDATE engine_hosts SET enrollment_hash=$2 WHERE id=$1`, enrollment.ID, hash([]byte(secret))); err != nil {
		t.Fatal(err)
	}
	path := "/api/host/v1/install.sh?token=" + url.QueryEscape(secret)
	script := call(router, "GET", path, nil)
	if script.Code != 200 || script.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("脚本不可用或可被缓存")
	}
	body := script.Body.String()
	if !strings.Contains(body, "x86_64|amd64") || !strings.Contains(body, "aarch64|arm64") || strings.Contains(body, "release.monkeycode-ai.com") || !strings.Contains(body, "https://control.example") || !strings.Contains(body, "$1/api/host/v1/releases/$3/$4/$8") {
		t.Fatal("脚本未自动识别架构或依赖外部发行源")
	}
	if !strings.Contains(body, "curl -k --proto") || !strings.Contains(body, "monkeyai-engine install --insecure --server") {
		t.Fatal("未将跳过证书校验传递给组件下载和安装器")
	}
	cmd := exec.Command("bash", "-n")
	cmd.Stdin = strings.NewReader(body)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("脚本语法无效 %v %s", err, out)
	}
	cmd = exec.Command("bash", "-n")
	cmd.Stdin = strings.NewReader(body[:strings.LastIndex(body, "}\ninstall_engine")])
	if cmd.Run() == nil {
		t.Fatal("截断脚本仍可执行")
	}
	pub, key, _ := ed25519.GenerateKey(rand.Reader)
	message := "monkeyai-engine/enroll/v1\nhttps://control.example\n" + secret + "\narm64\nv1\nhost-arm"
	request := map[string]any{"token": secret, "name": "host-arm", "public_key": []byte(pub), "signature": ed25519.Sign(key, []byte(message)), "architecture": "arm64", "version": "v1"}
	for range 2 {
		if w := call(router, "POST", "/api/host/v1/enroll", request); w.Code != 200 {
			t.Fatalf("首次绑定或重试失败 %d", w.Code)
		}
	}
	var name, arch string
	if err := pool.QueryRow(t.Context(), `SELECT name,architecture FROM engine_hosts WHERE id=$1`, enrollment.ID).Scan(&name, &arch); err != nil {
		t.Fatal(err)
	}
	if name != "host-arm" || arch != "arm64" {
		t.Fatal("未保存自动探测信息")
	}
	request["architecture"] = "amd64"
	request["signature"] = ed25519.Sign(key, []byte(strings.Replace(message, "arm64", "amd64", 1)))
	if w := call(router, "POST", "/api/host/v1/enroll", request); w.Code != 401 {
		t.Fatal("已绑定架构被修改")
	}
	if w := call(router, "DELETE", "/engine-hosts/"+enrollment.ID, nil); w.Code != 204 {
		t.Fatal("撤销失败")
	}
	if w := call(router, "GET", path, nil); w.Code != 401 {
		t.Fatal("撤销后仍可获取脚本")
	}
}

func TestShortCommandReturnsFailureWhenDownloadFails(t *testing.T) {
	dir := t.TempDir()
	for name, body := range map[string]string{"curl": "exit 22", "sudo": "exec \"$@\""} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("#!/bin/sh\n"+body+"\n"), 0700); err != nil {
			t.Fatal(err)
		}
	}
	command := `sudo bash -c "$(curl -kfsSL 'https://server.example/api/host/v1/install.sh?token=test' || echo 'exit 1')"`
	cmd := exec.Command("bash", "-c", command)
	cmd.Env = append(os.Environ(), "PATH="+dir+":"+os.Getenv("PATH"))
	if err := cmd.Run(); err == nil {
		t.Fatal("下载失败却报告安装成功")
	}
}
