package enginehost

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const testAdmin = "00000000-0000-0000-0000-000000000001"
const testCookie = "engine-test-admin"

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
	t.Cleanup(func() { root.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE"); root.Close() })
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	db, err := pgxpool.NewWithConfig(t.Context(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	files, err := filepath.Glob("../../migrations/*.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range files {
		raw, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = db.Exec(t.Context(), string(raw)); err != nil {
			t.Fatal(file, err)
		}
	}
	if _, err := db.Exec(t.Context(), `INSERT INTO users(id,name,email,role) VALUES($1,'admin','engine-admin@example.test','admin')`, testAdmin); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(t.Context(), `INSERT INTO browser_sessions(token_hash,user_id,authentication_method,expires_at) VALUES($1,$2,'password',now()+interval '1 hour')`, hash([]byte(testCookie)), testAdmin); err != nil {
		t.Fatal(err)
	}
	return db
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
func registerAdmin(router *chi.Mux, s *Service) {
	s.WithEnrollmentKey(bytes.Repeat([]byte{7}, 32))
	if s.pool == nil {
		s.RegisterAdmin(router)
		return
	}
	router.Group(func(r chi.Router) { r.Use(identity.NewService(s.pool, nil, s.server).RequireAdmin); s.RegisterAdmin(r) })
}
func call(router *chi.Mux, method, path string, body any) *httptest.ResponseRecorder {
	raw, _ := json.Marshal(body)
	w := httptest.NewRecorder()
	r := httptest.NewRequest(method, path, strings.NewReader(string(raw)))
	r.Header.Set("Content-Type", "application/json")
	if !strings.HasPrefix(path, "/api/host/") {
		r.AddCookie(&http.Cookie{Name: "monkeyai_session", Value: testCookie})
	}
	router.ServeHTTP(w, r)
	return w
}
func signedHeartbeat(key ed25519.PrivateKey, server, id string, at time.Time, report json.RawMessage) map[string]any {
	message := []byte("monkeyai-engine/heartbeat/v2\n" + server + "\n" + id + "\n" + at.UTC().Format(time.RFC3339Nano) + "\n" + hash(report))
	return map[string]any{"host_id": id, "at": at, "report": report, "signature": ed25519.Sign(key, message)}
}
func TestEnrollmentHeartbeatAndRevocation(t *testing.T) {
	db := testPool(t)
	s := NewService(db).WithInstallation("https://console.example", fixture(t), "v1")
	router := chi.NewRouter()
	registerAdmin(router, s)
	s.Register(router)
	created := call(router, "POST", "/engine-host-enrollments", map[string]any{})
	if created.Code != 201 {
		t.Fatal(created.Code, created.Body.String())
	}
	var enrollment struct {
		HostID    string    `json:"host_id"`
		Command   string    `json:"command"`
		ExpiresAt time.Time `json:"expires_at"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &enrollment); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(enrollment.Command, "curl -kfsSL") || !enrollment.ExpiresAt.After(time.Now()) {
		t.Fatal("安装命令缺少内容或有效期")
	}
	secret, err := s.credential(enrollment.HostID, "v1", time.Now().Add(30*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	_, key, _ := ed25519.GenerateKey(rand.Reader)
	request := func(k ed25519.PrivateKey) map[string]any {
		return map[string]any{"token": secret, "public_key": []byte(k.Public().(ed25519.PublicKey)), "architecture": "amd64", "version": "v1", "signature": ed25519.Sign(k, []byte("monkeyai-engine/enroll/v1\n"+s.server+"\n"+secret+"\namd64\nv1"))}
	}
	for range 2 {
		w := call(router, "POST", "/api/host/v1/enroll", request(key))
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	_, other, _ := ed25519.GenerateKey(rand.Reader)
	if w := call(router, "POST", "/api/host/v1/enroll", request(other)); w.Code != 401 {
		t.Fatal("其他公钥复用凭证", w.Code)
	}
	var activated time.Time
	var creator string
	if err := db.QueryRow(t.Context(), "SELECT activated_at,user_id FROM hosts WHERE id=$1", enrollment.HostID).Scan(&activated, &creator); err != nil || creator != testAdmin {
		t.Fatal("创建者或激活时间错误", err)
	}
	report := json.RawMessage(`{"engine_version":"v2","version":1,"prerequisites_met":false,"workload_verified":false,"checks":[],"system":{"hostname":"engine-test","private_ips":["10.0.0.8"],"network":{"receive_bytes_per_second":1234,"transmit_bytes_per_second":5678},"disk_io":{"read_bytes_per_second":9876,"write_bytes_per_second":5432},"os_name":"Ubuntu 24.04 LTS","kernel_version":"6.8.0","cpu":{"model":"Test CPU","logical_cores":8,"usage_percent":25},"memory":{"total_bytes":16000,"used_bytes":4000,"available_bytes":12000},"disk":{"path":"/var/lib/monkeyai-engine/data","total_bytes":100000,"used_bytes":40000,"available_bytes":50000}}}`)
	body := signedHeartbeat(key, s.server, enrollment.HostID, time.Now().UTC(), report)
	var wg sync.WaitGroup
	codes := make(chan int, 2)
	for range 2 {
		wg.Go(func() { codes <- call(router, "POST", "/api/host/v1/heartbeat", body).Code })
	}
	wg.Wait()
	close(codes)
	accepted := 0
	for code := range codes {
		if code == 200 {
			accepted++
		} else if code != 409 {
			t.Fatal("重复报告应被拒绝", code)
		}
	}
	if accepted != 1 {
		t.Fatal("报告重复生效", accepted)
	}
	listed := call(router, "GET", "/engine-hosts", nil)
	if listed.Code != 200 || !strings.Contains(listed.Body.String(), `"online":true`) || strings.Contains(listed.Body.String(), secret) || strings.Contains(listed.Body.String(), "public_key") {
		t.Fatal(listed.Code, listed.Body.String())
	}
	var current time.Time
	if err := db.QueryRow(t.Context(), "SELECT activated_at FROM hosts WHERE id=$1", enrollment.HostID).Scan(&current); err != nil || !current.Equal(activated) {
		t.Fatal("心跳覆盖首次激活时间", err)
	}
	if w := call(router, "DELETE", "/engine-hosts/"+enrollment.HostID, nil); w.Code != 204 {
		t.Fatal(w.Code)
	}
	if w := call(router, "POST", "/api/host/v1/heartbeat", signedHeartbeat(key, s.server, enrollment.HostID, time.Now().UTC(), report)); w.Code != 401 {
		t.Fatal("撤销后仍接受报告", w.Code)
	}
	if w := call(router, "POST", "/api/host/v1/enroll", request(key)); w.Code != 401 {
		t.Fatal("撤销后重新激活", w.Code)
	}
}
func TestExpiredEnrollmentAndMissingRelease(t *testing.T) {
	db := testPool(t)
	s := NewService(db).WithInstallation("https://console.example", fixture(t), "v1")
	router := chi.NewRouter()
	registerAdmin(router, s)
	s.Register(router)
	id := resource.ID()
	if _, err := db.Exec(t.Context(), "INSERT INTO hosts(id,user_id,name,architecture,version) VALUES($1,$2,'pending','amd64','v1')", id, testAdmin); err != nil {
		t.Fatal(err)
	}
	secret, err := s.credential(id, "v1", time.Now().Add(-time.Second))
	if err != nil {
		t.Fatal(err)
	}
	pub, key, _ := ed25519.GenerateKey(rand.Reader)
	body := map[string]any{"token": secret, "public_key": []byte(pub), "architecture": "amd64", "version": "v1", "signature": ed25519.Sign(key, []byte("monkeyai-engine/enroll/v1\n"+s.server+"\n"+secret+"\namd64\nv1"))}
	if w := call(router, "POST", "/api/host/v1/enroll", body); w.Code != 401 {
		t.Fatal("接受过期凭证", w.Code)
	}
	if err := os.Remove(filepath.Join(s.releases, "v1", "arm64", "runsc")); err != nil {
		t.Fatal(err)
	}
	if w := call(router, "POST", "/engine-host-enrollments", map[string]any{}); w.Code != 503 {
		t.Fatal("缺少双架构资源仍创建", w.Code)
	}
}
func TestReleaseEndpointsAndLimits(t *testing.T) {
	s := NewService(nil).WithInstallation("https://console.example", fixture(t), "v1")
	router := chi.NewRouter()
	s.Register(router)
	for _, path := range []string{"/api/host/v1/releases/v1/amd64/manifest.json", "/api/host/v1/releases/v1/amd64/monkeyai-engine"} {
		if w := call(router, "GET", path, nil); w.Code != 200 {
			t.Fatal(path, w.Code)
		}
	}
	if w := call(router, "GET", "/api/host/v1/install.sh?token=", nil); w.Code != 401 {
		t.Fatal(w.Code)
	}
	if w := call(router, "GET", "/api/host/v1/releases/v1/amd64/identity.key", nil); w.Code != 404 {
		t.Fatal("暴露任意文件")
	}
	if w := call(router, "POST", "/api/host/v1/enroll", map[string]string{"token": strings.Repeat("x", 70<<10)}); w.Code != 400 {
		t.Fatal("未限制报文大小")
	}
	if w := call(router, "POST", "/api/host/v1/challenges", map[string]any{}); w.Code != 404 {
		t.Fatal("仍保留挑战接口")
	}
}
func TestAdminRequiresAuthentication(t *testing.T) {
	router := chi.NewRouter()
	router.Use(identity.NewService(nil, nil, "https://console.example").RequireAdmin)
	NewService(nil).RegisterAdmin(router)
	for _, req := range []struct{ method, path string }{{"GET", "/engine-hosts"}, {"POST", "/engine-host-enrollments"}, {"DELETE", "/engine-hosts/" + testAdmin}} {
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest(req.method, req.path, strings.NewReader(`{}`)))
		if w.Code != 401 {
			t.Fatal(req.path, w.Code)
		}
	}
}
