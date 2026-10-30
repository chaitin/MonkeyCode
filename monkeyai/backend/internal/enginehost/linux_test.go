package enginehost

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/enginehost/sqlc"
	"github.com/go-chi/chi/v5"
)

// 显式启用后仅操作专用 Colima 测试机；管理入口通过进程内请求调用，不对网络开放。
func TestLinuxInstallation(t *testing.T) {
	if os.Getenv("MONKEYAI_TEST_LINUX_INSTALL") != "1" {
		t.Skip("设置 MONKEYAI_TEST_LINUX_INSTALL=1，在专用 engine-installer-test VM 验收")
	}
	releases, version := os.Getenv("MONKEYAI_TEST_RELEASE_DIR"), os.Getenv("MONKEYAI_TEST_RELEASE_VERSION")
	if releases == "" || version == "" {
		t.Fatal("需要真实发行目录与版本")
	}
	pool := testPool(t)
	vm := func(script string) (string, error) {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()
		cmd := exec.CommandContext(ctx, "colima", "-p", "engine-installer-test", "ssh", "--", "sh", "-s")
		cmd.Stdin = strings.NewReader("set -eu\n" + script + "\n")
		out, err := cmd.CombinedOutput()
		return strings.TrimSpace(string(out)), err
	}
	run := func(script string) string {
		t.Helper()
		out, err := vm(script)
		if err != nil {
			t.Fatalf("测试机命令失败：%v\n%s", err, out)
		}
		return out
	}
	run("sudo test ! -e /etc/monkeyai-engine; sudo test ! -e /opt/monkeyai-engine; sudo test ! -e /var/lib/monkeyai-engine")
	run("sudo systemctl start containerd")
	original := run("sudo sha256sum /usr/local/bin/containerd /etc/containerd/config.toml; sudo systemctl is-active containerd; sudo test -S /run/containerd/containerd.sock")
	arch := run("uname -m")
	switch arch {
	case "aarch64":
		arch = "arm64"
	case "x86_64":
		arch = "amd64"
	default:
		t.Fatalf("未知架构：%s", arch)
	}
	t.Cleanup(func() {
		if t.Failed() {
			out, _ := vm("sudo journalctl -u monkeyai-engine -u monkeyai-containerd -n 60 --no-pager")
			t.Log(out)
		}
		_, err := vm(`sudo systemctl disable --now monkeyai-engine monkeyai-containerd || true
sudo rm -f /etc/systemd/system/monkeyai-engine.service /etc/systemd/system/monkeyai-containerd.service
sudo rm -rf /etc/monkeyai-engine /opt/monkeyai-engine /var/lib/monkeyai-engine
sudo rm -f /usr/local/share/ca-certificates/monkeyai-engine-test.crt
sudo sed -i '/# monkeyai-engine-test$/d' /etc/hosts
sudo update-ca-certificates >/dev/null
sudo systemctl daemon-reload`)
		if err != nil {
			t.Errorf("专用测试机清理失败：%v", err)
		}
	})
	// Colima 继承宿主代理；.local 使用其默认直连规则，避免测试 HTTPS 绕经代理。
	run(`getent hosts host.lima.internal | awk '{print $1 " monkeyai-engine-test.local # monkeyai-engine-test"}' | sudo tee -a /etc/hosts >/dev/null`)
	pub, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	cert := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "MonkeyAI 临时测试 CA"}, DNSNames: []string{"monkeyai-engine-test.local"}, NotBefore: time.Now().Add(-time.Minute), NotAfter: time.Now().Add(time.Hour), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	der, err := x509.CreateCertificate(rand.Reader, cert, cert, pub, key)
	if err != nil {
		t.Fatal(err)
	}
	ca := string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}))
	run("sudo tee /usr/local/share/ca-certificates/monkeyai-engine-test.crt >/dev/null <<'CA'\n" + ca + "CA\nsudo update-ca-certificates >/dev/null")
	listener, err := net.Listen("tcp4", "0.0.0.0:0")
	if err != nil {
		t.Fatal(err)
	}
	serverURL := fmt.Sprintf("https://monkeyai-engine-test.local:%d", listener.Addr().(*net.TCPAddr).Port)
	s := NewService(pool).WithInstallation(serverURL, releases, version)
	admin, host := chi.NewRouter(), chi.NewRouter()
	s.RegisterAdmin(admin)
	s.Register(host)
	var reject atomic.Bool
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if reject.Load() && strings.HasSuffix(r.URL.Path, "/heartbeat") {
			http.Error(w, "临时故障", 503)
			return
		}
		host.ServeHTTP(w, r)
	}))
	server.Listener.Close()
	server.Listener = listener
	server.TLS = &tls.Config{Certificates: []tls.Certificate{{Certificate: [][]byte{der}, PrivateKey: key}}, MinVersion: tls.VersionTLS12}
	server.StartTLS()
	defer server.Close()
	response := call(admin, "POST", "/engine-host-enrollments", map[string]string{"name": "Linux 安装验收", "architecture": arch})
	if response.Code != 201 {
		t.Fatalf("生成命令失败：%d %s", response.Code, response.Body)
	}
	var enrollment struct {
		HostID  string `json:"host_id"`
		Command string `json:"command"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &enrollment); err != nil {
		t.Fatal(err)
	}
	lastSeen := func() time.Time {
		t.Helper()
		rows, err := sqlc.New(pool).ListHosts(t.Context(), sqlc.ListHostsParams{Limit: 10})
		if err != nil || len(rows) != 1 || rows[0].LastSeenAt == nil {
			t.Fatalf("未收到签名心跳：%v", err)
		}
		return *rows[0].LastSeenAt
	}
	waitHeartbeat := func(after time.Time) {
		t.Helper()
		deadline := time.Now().Add(90 * time.Second)
		for time.Now().Before(deadline) {
			if lastSeen().After(after) {
				return
			}
			time.Sleep(time.Second)
		}
		t.Fatal("未恢复心跳")
	}
	t.Log("执行后台生成的完整安装命令")
	output := run(enrollment.Command)
	if !strings.Contains(output, "安装并接入成功") {
		t.Fatal("安装未报告成功")
	}
	lastSeen()
	identity := run("sudo sha256sum /var/lib/monkeyai-engine/control/identity.key; sudo stat -c %a /var/lib/monkeyai-engine/control/identity.key; sudo cat /etc/monkeyai-engine/config.json")
	if !strings.Contains(identity, enrollment.HostID) || !strings.Contains(identity, "\n600\n") {
		t.Fatal("身份或权限错误")
	}
	t.Log("验证相同命令重试与身份保持")
	run(enrollment.Command)
	if run("sudo sha256sum /var/lib/monkeyai-engine/control/identity.key; sudo stat -c %a /var/lib/monkeyai-engine/control/identity.key; sudo cat /etc/monkeyai-engine/config.json") != identity {
		t.Fatal("重试改变宿主身份")
	}
	t.Log("注入上报故障，验证安装失败后恢复既有服务")
	reject.Store(true)
	if out, err := vm(enrollment.Command); err == nil || !strings.Contains(out, "503") {
		t.Fatalf("未覆盖心跳失败：%v %s", err, out)
	}
	run("sudo systemctl is-active --quiet monkeyai-engine monkeyai-containerd")
	reject.Store(false)
	waitHeartbeat(time.Now())
	t.Log("验证服务重启")
	before := time.Now()
	run("sudo systemctl restart monkeyai-containerd monkeyai-engine")
	waitHeartbeat(before)
	if after := run("sudo sha256sum /usr/local/bin/containerd /etc/containerd/config.toml; sudo systemctl is-active containerd; sudo test -S /run/containerd/containerd.sock"); after != original {
		t.Fatal("安装或服务重启影响原有 containerd")
	}
	t.Log("验证 VM 重启与自动接入")
	boot := run("cat /proc/sys/kernel/random/boot_id")
	before = time.Now()
	run("sudo systemctl reboot --no-block")
	rebooted := false
	for deadline := time.Now().Add(2 * time.Minute); time.Now().Before(deadline); {
		time.Sleep(2 * time.Second)
		if out, err := vm("cat /proc/sys/kernel/random/boot_id; sudo systemctl is-active --quiet monkeyai-engine monkeyai-containerd"); err == nil && out != boot {
			rebooted = true
			break
		}
	}
	if !rebooted {
		t.Fatal("VM 重启后服务未恢复")
	}
	waitHeartbeat(before)
	// Colima 的启动脚本显式停止自身 containerd，平时由 macOS 端重新启动；这里恢复该测试基线。
	run("sudo systemctl start containerd")
	if after := run("sudo sha256sum /usr/local/bin/containerd /etc/containerd/config.toml; sudo systemctl is-active containerd; sudo test -S /run/containerd/containerd.sock"); after != original {
		t.Fatal("原有 containerd 被修改或不可用")
	}
	t.Log(run("sudo /opt/monkeyai-engine/current/bin/containerd --version; sudo /opt/monkeyai-engine/current/bin/runsc --version"))
	listed := call(admin, "GET", "/engine-hosts", nil)
	var hosts struct {
		Items []struct {
			Online bool `json:"online"`
			Report struct {
				Checks []struct {
					Name   string `json:"name"`
					Passed bool   `json:"passed"`
				} `json:"checks"`
			} `json:"report"`
		} `json:"items"`
	}
	if json.Unmarshal(listed.Body.Bytes(), &hosts) != nil || len(hosts.Items) != 1 || !hosts.Items[0].Online {
		t.Fatalf("在线或配额预检结果异常：%s", listed.Body)
	}
	quotaMissing := false
	for _, check := range hosts.Items[0].Report.Checks {
		if check.Name == "xfs_project_quota" && !check.Passed {
			quotaMissing = true
		} else if !check.Passed {
			t.Errorf("除配额外的预检失败：%s", check.Name)
		}
	}
	if !quotaMissing {
		t.Fatal("未检测到测试机缺少 XFS 项目配额")
	}
	t.Log("验证后台撤销后拒绝接入")
	if w := call(admin, "DELETE", "/engine-hosts/"+enrollment.HostID, nil); w.Code != 204 {
		t.Fatalf("撤销失败：%d", w.Code)
	}
	if out, err := vm(enrollment.Command); err == nil || !strings.Contains(out, "宿主认证失效或已被撤销") {
		t.Fatalf("撤销后安装未拒绝：%v %s", err, out)
	}
	if w := call(admin, "GET", "/engine-hosts", nil); strings.Contains(w.Body.String(), `"online":true`) || !strings.Contains(w.Body.String(), `"status":"revoked"`) {
		t.Fatal("撤销后仍显示在线")
	}
}
