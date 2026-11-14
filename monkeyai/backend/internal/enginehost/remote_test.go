package enginehost

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/enginehost/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

func TestVersionState(t *testing.T) {
	for _, tc := range []struct{ current, target, want string }{
		{"v26110401", "v26110402", "available"}, {"v26110399", "v26110401", "available"},
		{"v26123199", "v27010101", "available"}, {"v26110405", "v26110405", "current"},
		{"v26110410", "v26110409", "ahead"}, {"dev", "v26110406", "unknown"},
		{"v26110406", "dev", "unknown"}, {"dev", "dev", "current"},
		{"", "", "unknown"}, {"v26023001", "v26110406", "unknown"},
		{"v26110406-test", "v26110407", "unknown"},
	} {
		if got := versionState(tc.current, tc.target); got != tc.want {
			t.Errorf("%s → %s: %s", tc.current, tc.target, got)
		}
	}
}

func TestRemoteUpgradeLifecycle(t *testing.T) {
	pool := testPool(t)
	root := fixture(t)
	const target = "v26110406"
	if err := os.Rename(filepath.Join(root, "v1"), filepath.Join(root, target)); err != nil {
		t.Fatal(err)
	}
	for _, arch := range []string{"amd64", "arm64"} {
		path := filepath.Join(root, target, arch, "manifest.json")
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		var m manifest
		if err := json.Unmarshal(raw, &m); err != nil {
			t.Fatal(err)
		}
		m.Version = target
		raw, _ = json.Marshal(m)
		if err := os.WriteFile(path, raw, 0600); err != nil {
			t.Fatal(err)
		}
	}
	s := NewService(pool).WithInstallation("https://console.example", root, target)
	r := chi.NewRouter()
	registerAdmin(r, s)
	s.Register(r)
	id := resource.ID()
	public, key, _ := ed25519.GenerateKey(rand.Reader)
	if _, err := pool.Exec(t.Context(), `INSERT INTO hosts(id,user_id,name,architecture,version,status,last_seen_at,report,public_key) VALUES($1,$3,'宿主','amd64','v26110405','active',now(),'{"upgrade_protocol":1}',$2)`, id, []byte(public), testAdmin); err != nil {
		t.Fatal(err)
	}
	request := func(version string) *httptest.ResponseRecorder {
		return call(r, "POST", "/engine-hosts/"+id+"/upgrade", map[string]string{"version": version})
	}
	if response := request("v26110404"); response.Code != 409 {
		t.Fatal(response.Code, response.Body)
	}
	responses := make(chan *httptest.ResponseRecorder, 8)
	var wg sync.WaitGroup
	for range 8 {
		wg.Go(func() { responses <- request(target) })
	}
	wg.Wait()
	close(responses)
	var jobID string
	for response := range responses {
		var job struct{ ID, Version, Status string }
		if response.Code != 202 || json.Unmarshal(response.Body.Bytes(), &job) != nil || job.Status != "pending" || job.ID == "" || job.Version != target {
			t.Fatal(response.Code, response.Body)
		}
		if jobID != "" && jobID != job.ID {
			t.Fatal("并发请求创建了重复任务")
		}
		jobID = job.ID
		if strings.Contains(response.Body.String(), "sha256") {
			t.Fatal("管理接口泄露不必要的发行摘要")
		}
	}
	heartbeat := func(version string, result *upgradeResult, bad bool) *httptest.ResponseRecorder {
		t.Helper()
		report, _ := json.Marshal(map[string]any{"version": 1, "engine_version": version, "upgrade_protocol": 1, "upgrade": result, "workload_verified": false, "prerequisites_met": true, "checks": []any{}})
		body := signedHeartbeat(key, s.server, id, time.Now().UTC(), report)
		if bad {
			body["signature"].([]byte)[0] ^= 0xff
		}
		return call(r, "POST", "/api/host/v1/heartbeat", body)
	}
	response := heartbeat("v26110405", nil, false)
	var offered struct{ Upgrade *upgradeTask }
	if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &offered) != nil || offered.Upgrade == nil || offered.Upgrade.ID != jobID || len(offered.Upgrade.ManifestSHA) != 64 || len(offered.Upgrade.InstallerSHA) != 64 {
		t.Fatal(response.Code, response.Body)
	}
	report := &upgradeResult{jobID, target, "succeeded", ""}
	if response := heartbeat(target, report, true); response.Code != 401 {
		t.Fatal("接受无效签名")
	}
	if response := heartbeat("v26110405", report, false); response.Code != 200 {
		t.Fatal(response.Body)
	}
	q := sqlc.New(pool)
	job, err := q.GetUpgrade(t.Context(), id)
	if err != nil || job.Status != "pending" {
		t.Fatal("接受版本不匹配的成功报告", job, err)
	}
	report.Status = "running"
	if response := heartbeat("v26110405", report, false); response.Code != 200 {
		t.Fatal(response.Body)
	}
	view, err := s.upgradeView(t.Context(), id, "v26110405", []byte(`{"upgrade_protocol":1}`), true)
	if err != nil || view["can_upgrade"] != false {
		t.Fatal(view, err)
	}
	report.Status = "succeeded"
	if response := heartbeat(target, report, false); response.Code != 200 {
		t.Fatal(response.Body)
	}
	job, err = q.GetUpgrade(t.Context(), id)
	if err != nil || job.Status != "succeeded" {
		t.Fatal(job, err)
	}
	if response := request(target); response.Code != 409 {
		t.Fatal("同版本仍允许升级", response.Code)
	}
	report.Status = "running"
	heartbeat(target, report, false)
	job, _ = q.GetUpgrade(t.Context(), id)
	if job.Status != "succeeded" {
		t.Fatal("终态被旧报告覆盖")
	}
	listed := call(r, "GET", "/engine-hosts", nil)
	if listed.Code != 200 || !strings.Contains(listed.Body.String(), `"version_state":"current"`) || !strings.Contains(listed.Body.String(), `"status":"succeeded"`) {
		t.Fatal(listed.Code, listed.Body)
	}

	for _, change := range []string{
		`version='v26110407'`, `version='dev'`, `version='v26110405',report='{}'`,
		`version='v26110405',report='{"upgrade_protocol":1}',last_seen_at=now()-interval '2 minutes'`,
		`status='revoked',last_seen_at=now()`,
	} {
		if _, err := pool.Exec(t.Context(), `UPDATE hosts SET `+change+` WHERE id=$1`, id); err != nil {
			t.Fatal(err)
		}
		if response := request(target); response.Code != 409 {
			t.Fatal(change, response.Code, response.Body)
		}
	}
	if _, err := pool.Exec(t.Context(), `UPDATE hosts SET status='active',version='v26110405',report='{"upgrade_protocol":1}',last_seen_at=now() WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	retry := request(target)
	if retry.Code != 202 {
		t.Fatal(retry.Body)
	}
	var next struct{ ID string }
	_ = json.Unmarshal(retry.Body.Bytes(), &next)
	if next.ID == jobID {
		t.Fatal("重试复用了已结束的任务")
	}
	// 迟到的上一任务不能修改新任务。
	if _, err := s.heartbeatUpgrade(t.Context(), id, "v26110405", &upgradeResult{jobID, target, "failed", "upgrade_failed"}, 1); err != nil {
		t.Fatal(err)
	}
	job, _ = q.GetUpgrade(t.Context(), id)
	if job.Status != "pending" {
		t.Fatal(job)
	}
	if _, err := pool.Exec(t.Context(), `UPDATE host_upgrades SET created_at=created_at-interval '31 minutes' WHERE host_id=$1`, id); err != nil {
		t.Fatal(err)
	}
	offeredTask, err := s.heartbeatUpgrade(t.Context(), id, "v26110405", nil, 1)
	if err != nil || offeredTask != nil {
		t.Fatal(offeredTask, err)
	}
	job, _ = q.GetUpgrade(t.Context(), id)
	if job.Status != "failed" || job.Reason != "upgrade_timeout" {
		t.Fatal(job)
	}
	if response := request(target); response.Code != 202 {
		t.Fatal(response.Body)
	}
	job, _ = q.GetUpgrade(t.Context(), id)
	if _, err := s.heartbeatUpgrade(t.Context(), id, "v26110405", &upgradeResult{job.ID, target, "failed", "upgrade_interrupted"}, 1); err != nil {
		t.Fatal(err)
	}
	job, _ = q.GetUpgrade(t.Context(), id)
	if job.Status != "failed" {
		t.Fatal(job)
	}
	if err := os.Remove(filepath.Join(root, target, "amd64", "installer")); err != nil {
		t.Fatal(err)
	}
	if response := request(target); response.Code != 503 {
		t.Fatal("缺少发行物仍允许升级", response.Code)
	}
	// 迁移重放保留任务记录。
	raw, err := os.ReadFile("../../migrations/000040_cloud_environments.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(t.Context(), string(raw)); err != nil {
		t.Fatal(err)
	}
	kept, _ := q.GetUpgrade(t.Context(), id)
	if kept.ID != job.ID || kept.FromVersion != "v26110405" {
		t.Fatal("迁移重放丢失任务")
	}
}
