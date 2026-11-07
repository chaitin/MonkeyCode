package enginehost

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("MONKEYAI_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("设置 MONKEYAI_TEST_DATABASE_URL 运行宿主数据库测试")
	}
	root, err := pgxpool.New(t.Context(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	schema := "engine_test_" + strings.ReplaceAll(resource.ID(), "-", "")
	if _, err := root.Exec(t.Context(), "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = root.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE"); root.Close() })
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(t.Context(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	files, err := filepath.Glob("../../migrations/*.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range files {
		raw, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(t.Context(), string(raw)); err != nil {
			t.Fatalf("%s: %v", file, err)
		}
	}
	return pool
}
func fixture(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	for _, arch := range []string{"amd64", "arm64"} {
		target := filepath.Join(dir, "v1", arch)
		if err := os.MkdirAll(target, 0755); err != nil {
			t.Fatal(err)
		}
		m := manifest{Version: "v1", Architecture: arch, Files: map[string]string{}}
		for name := range files {
			raw := []byte("fixture-" + name)
			m.Files[name] = hash(raw)
			if err := os.WriteFile(filepath.Join(target, name), raw, 0700); err != nil {
				t.Fatal(err)
			}
		}
		raw, _ := json.Marshal(m)
		if err := os.WriteFile(filepath.Join(target, "manifest.json"), raw, 0600); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}
func call(router *chi.Mux, method, path string, body any) *httptest.ResponseRecorder {
	raw, _ := json.Marshal(body)
	w := httptest.NewRecorder()
	r := httptest.NewRequest(method, path, strings.NewReader(string(raw)))
	r.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(w, r)
	return w
}
func TestEnrollmentHeartbeatAndRevocation(t *testing.T) {
	pool := testPool(t)
	s := NewService(pool).WithInstallation("https://console.example", fixture(t), "v1")
	router := chi.NewRouter()
	s.RegisterAdmin(router)
	s.Register(router)
	created := call(router, "POST", "/engine-host-enrollments", map[string]string{})
	if created.Code != 201 {
		t.Fatalf("创建失败: %d %s", created.Code, created.Body)
	}
	var enrollment struct {
		HostID         string `json:"host_id"`
		Command        string `json:"command"`
		OfflineCommand string `json:"offline_command"`
		Version        string `json:"version"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &enrollment); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(enrollment.Command, "sudo bash -c ") || !strings.Contains(enrollment.Command, "curl -kfsSL") {
		t.Fatal("安装命令不完整")
	}
	if enrollment.OfflineCommand != "" || enrollment.Version != "v1" {
		t.Fatal("离线命令或固定版本缺失")
	}
	// 换成已知的测试令牌，不从命令中提取或打印真实凭据。
	secret := token()
	if _, err := pool.Exec(t.Context(), `UPDATE engine_hosts SET enrollment_hash=$2 WHERE id=$1`, enrollment.HostID, hash([]byte(secret))); err != nil {
		t.Fatal(err)
	}
	pub, key, _ := ed25519.GenerateKey(rand.Reader)
	request := func(k ed25519.PrivateKey) map[string]any {
		return map[string]any{"token": secret, "public_key": []byte(k.Public().(ed25519.PublicKey)), "architecture": "amd64", "version": "v1", "signature": ed25519.Sign(k, []byte("monkeyai-engine/enroll/v1\nhttps://console.example\n"+secret+"\namd64\nv1"))}
	}
	for range 2 {
		w := call(router, "POST", "/api/host/v1/enroll", request(key))
		if w.Code != 200 {
			t.Fatalf("同密钥注册重试失败: %d", w.Code)
		}
	}
	_, other, _ := ed25519.GenerateKey(rand.Reader)
	if w := call(router, "POST", "/api/host/v1/enroll", request(other)); w.Code != 401 {
		t.Fatalf("其他密钥复用令牌: %d", w.Code)
	}
	bad := request(key)
	bad["signature"] = []byte("bad")
	if w := call(router, "POST", "/api/host/v1/enroll", bad); w.Code != 401 {
		t.Fatalf("接受无效签名: %d", w.Code)
	}
	challenge := call(router, "POST", "/api/host/v1/challenges", map[string]string{"host_id": enrollment.HostID})
	var out struct {
		Challenge string `json:"challenge"`
	}
	if err := json.Unmarshal(challenge.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	report := json.RawMessage(`{"engine_version":"v2","version":1,"prerequisites_met":false,"workload_verified":false,"checks":[],"system":{"hostname":"engine-test","private_ips":["10.0.0.8"],"network":{"receive_bytes_per_second":1234,"transmit_bytes_per_second":5678},"disk_io":{"read_bytes_per_second":9876,"write_bytes_per_second":5432},"os_name":"Ubuntu 24.04 LTS","kernel_version":"6.8.0","cpu":{"model":"Test CPU","logical_cores":8,"usage_percent":25},"memory":{"total_bytes":16000,"used_bytes":4000,"available_bytes":12000},"disk":{"path":"/var/lib/monkeyai-engine/data","total_bytes":100000,"used_bytes":40000,"available_bytes":50000}}}`)
	signed := map[string]any{"host_id": enrollment.HostID, "challenge": out.Challenge, "report": report, "signature": ed25519.Sign(key, []byte("monkeyai-engine/heartbeat/v1\nhttps://console.example\n"+enrollment.HostID+"\n"+out.Challenge+"\n"+hash(report)))}
	var wg sync.WaitGroup
	codes := make(chan int, 2)
	for range 2 {
		wg.Go(func() { codes <- call(router, "POST", "/api/host/v1/heartbeat", signed).Code })
	}
	wg.Wait()
	close(codes)
	accepted := 0
	for code := range codes {
		if code == 200 {
			accepted++
		} else if code != 401 {
			t.Fatalf("意外心跳状态: %d", code)
		}
	}
	if accepted != 1 {
		t.Fatalf("同一挑战消费次数: %d", accepted)
	}
	var reportedVersion string
	if err := pool.QueryRow(t.Context(), `SELECT version FROM engine_hosts WHERE id=$1`, enrollment.HostID).Scan(&reportedVersion); err != nil || reportedVersion != "v2" {
		t.Fatal("心跳未更新 engine 版本", reportedVersion, err)
	}
	listed := call(router, "GET", "/engine-hosts", nil)
	if listed.Code != 200 || !strings.Contains(listed.Body.String(), `"online":true`) || strings.Contains(listed.Body.String(), secret) || strings.Contains(listed.Body.String(), "public_key") {
		t.Fatalf("列表状态或凭据过滤错误: %d", listed.Code)
	}
	var response struct {
		Items []struct {
			Report struct {
				System *systemReport `json:"system"`
			} `json:"report"`
		} `json:"items"`
	}
	if err := json.Unmarshal(listed.Body.Bytes(), &response); err != nil || len(response.Items) != 1 || response.Items[0].Report.System == nil || response.Items[0].Report.System.Hostname != "engine-test" || response.Items[0].Report.System.CPU == nil || *response.Items[0].Report.System.CPU.UsagePercent != 25 || response.Items[0].Report.System.Disk == nil || response.Items[0].Report.System.Disk.AvailableBytes != 50000 {
		t.Fatalf("签名心跳的宿主信息未完整保存或返回: %v", err)
	}
	if ips := response.Items[0].Report.System.PrivateIPs; len(ips) != 1 || ips[0] != "10.0.0.8" {
		t.Fatal("内网地址未保存", ips)
	}
	if ips := response.Items[0].Report.System.PublicIPs; len(ips) != 1 || ips[0] != "192.0.2.1" {
		t.Fatal("未合并连接来源地址", ips)
	}
	metrics := response.Items[0].Report.System
	if metrics.Network == nil || metrics.Network.ReceiveBytesPerSecond != 1234 || metrics.Network.TransmitBytesPerSecond != 5678 || metrics.DiskIO == nil || metrics.DiskIO.ReadBytesPerSecond != 9876 || metrics.DiskIO.WriteBytesPerSecond != 5432 {
		t.Fatal("心跳读写速率未完整保存", metrics)
	}
	_ = pub
	if w := call(router, "DELETE", "/engine-hosts/"+enrollment.HostID, nil); w.Code != 204 {
		t.Fatalf("撤销失败: %d", w.Code)
	}
	if w := call(router, "POST", "/api/host/v1/challenges", map[string]string{"host_id": enrollment.HostID}); w.Code != 401 {
		t.Fatalf("撤销后仍获挑战: %d", w.Code)
	}
	if w := call(router, "POST", "/api/host/v1/enroll", request(key)); w.Code != 401 {
		t.Fatalf("撤销后重新激活: %d", w.Code)
	}
}
func TestExpiredEnrollmentAndMissingRelease(t *testing.T) {
	pool := testPool(t)
	s := NewService(pool).WithInstallation("https://console.example", fixture(t), "v1")
	r := chi.NewRouter()
	s.RegisterAdmin(r)
	s.Register(r)
	missing := filepath.Join(s.releases, "v1", "arm64", "runsc")
	if err := os.Remove(missing); err != nil {
		t.Fatal(err)
	}
	if w := call(r, "POST", "/engine-host-enrollments", map[string]string{}); w.Code != 503 {
		t.Fatalf("缺少双架构发行物仍创建: %d", w.Code)
	}
	secret := token()
	var id string
	if err := pool.QueryRow(t.Context(), `INSERT INTO engine_hosts(name,architecture,version,enrollment_hash,enrollment_expires_at) VALUES('过期','amd64','v1',$1,now()-interval '1 second') RETURNING id::text`, hash([]byte(secret))).Scan(&id); err != nil {
		t.Fatal(err)
	}
	pub, key, _ := ed25519.GenerateKey(rand.Reader)
	w := call(r, "POST", "/api/host/v1/enroll", map[string]any{"token": secret, "public_key": []byte(pub), "architecture": "amd64", "version": "v1", "signature": ed25519.Sign(key, []byte("monkeyai-engine/enroll/v1\nhttps://console.example\n"+secret+"\namd64\nv1"))})
	if w.Code != 401 {
		t.Fatalf("过期令牌被接受: %d", w.Code)
	}
	s.server = "http://console.example"
	if w := call(r, "POST", "/engine-host-enrollments", map[string]string{}); w.Code != 503 {
		t.Fatalf("允许不安全安装: %d", w.Code)
	}
}
func TestReleaseEndpointsAndLimits(t *testing.T) {
	s := NewService(nil).WithInstallation("https://console.example", fixture(t), "v1")
	r := chi.NewRouter()
	s.Register(r)
	for _, path := range []string{"/api/host/v1/releases/v1/amd64/manifest.json", "/api/host/v1/releases/v1/amd64/monkeyai-engine"} {
		if w := call(r, "GET", path, nil); w.Code != 200 {
			t.Fatalf("发行物不可读: %s %d", path, w.Code)
		}
	}
	if w := call(r, "GET", "/api/host/v1/install.sh?token=", nil); w.Code != 401 {
		t.Fatal("无凭据获取脚本")
	}
	if w := call(r, "GET", "/api/host/v1/releases/v1/amd64/identity.key", nil); w.Code != 404 {
		t.Fatal("任意文件暴露")
	}
	if w := call(r, "POST", "/api/host/v1/enroll", map[string]string{"token": strings.Repeat("x", 70<<10)}); w.Code != 400 {
		t.Fatal("未限制请求大小")
	}
}

func TestAdminRequiresAuthentication(t *testing.T) {
	r := chi.NewRouter()
	r.Use(identity.NewService(nil, nil, "https://console.example").RequireAdmin)
	NewService(nil).RegisterAdmin(r)
	for _, request := range []struct{ method, path string }{{"GET", "/engine-hosts"}, {"POST", "/engine-host-enrollments"}, {"DELETE", "/engine-hosts/00000000-0000-0000-0000-000000000001"}, {"DELETE", "/engine-hosts/00000000-0000-0000-0000-000000000001/record"}} {
		w := call(r, request.method, request.path, map[string]string{})
		if w.Code != 401 {
			t.Fatalf("未登录访问宿主管理: %s %d", request.path, w.Code)
		}
	}
}
