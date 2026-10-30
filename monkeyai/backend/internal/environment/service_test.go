package environment

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func pool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("MONKEYAI_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("设置 MONKEYAI_TEST_DATABASE_URL 运行环境事务测试")
	}
	root, err := pgxpool.New(t.Context(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	schema := "environment_test_" + strings.ReplaceAll(resource.ID(), "-", "")
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
	if _, err := db.Exec(t.Context(), "CREATE TABLE users(id uuid PRIMARY KEY,status text NOT NULL DEFAULT 'active')"); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"000035_engine_hosts", "000036_environment_control", "000037_environment_runtime"} {
		raw, err := os.ReadFile("../../migrations/" + name + ".up.sql")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(t.Context(), string(raw)); err != nil {
			t.Fatal(err)
		}
	}
	return db
}
func profile() Profile {
	return Profile{Architecture: "amd64", Image: "example.com/image@sha256:" + strings.Repeat("a", 64), NetworkPolicy: "isolated", Resource: Resources{CPUMillis: 1000, MemoryBytes: 512 << 20, HostTasks: 512, TemporaryBytes: 64 << 20}, Storage: Storage{WorkspaceBytes: 1 << 30, HomeBytes: 1 << 30, RuntimeBytes: 1 << 30, Inodes: 10000}}
}
func fixture(t *testing.T) (*Service, string, string, string) {
	t.Helper()
	db := pool(t)
	user, host := resource.ID(), resource.ID()
	if _, err := db.Exec(t.Context(), "INSERT INTO users(id) VALUES($1)", user); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(t.Context(), `INSERT INTO engine_hosts(id,name,architecture,version,status,enrollment_hash,enrollment_expires_at,last_seen_at,report) VALUES($1::uuid,'test','amd64','v1','active',$1::text,now()+interval '1 hour',now(),'{"prerequisites_met":true}')`, host); err != nil {
		t.Fatal(err)
	}
	q := sqlc.New(db)
	if err := q.TouchHost(t.Context(), host); err != nil {
		t.Fatal(err)
	}
	if _, err := q.SetHost(t.Context(), sqlc.SetHostParams{HostID: host, Enabled: true, CpuMillis: 8000, MemoryBytes: 16 << 30, StorageBytes: 100 << 30, MaxEnvironments: 10}); err != nil {
		t.Fatal(err)
	}
	p := profile()
	raw, _ := json.Marshal(p)
	preset, err := q.CreatePreset(t.Context(), sqlc.CreatePresetParams{Name: "测试预设", Architecture: p.Architecture, Configuration: raw, CpuMillis: p.Resource.CPUMillis, MemoryBytes: p.Resource.MemoryBytes, StorageBytes: p.Storage.Bytes()})
	if err != nil {
		t.Fatal(err)
	}
	return NewService(db), user, host, preset.ID
}
func syncState(t *testing.T, s *Service, host string, observations ...Observation) Commands {
	t.Helper()
	raw, _ := json.Marshal(Exchange{Protocol: 1, Results: observations})
	out, err := s.Exchange(t.Context(), host, raw)
	if err != nil {
		t.Fatal(err)
	}
	return out.(Commands)
}
func observe(e View, phase string) Observation {
	return Observation{EnvironmentID: e.ID, InstanceID: e.InstanceID, Generation: e.Generation, Phase: phase}
}
func TestLifecycleReservationsAndStaleReports(t *testing.T) {
	s, user, host, preset := fixture(t)
	in := Creation{preset, "项目 A", "create-1"}
	created, err := s.Create(t.Context(), user, in)
	if err != nil {
		t.Fatal(err)
	}
	retry, err := s.Create(t.Context(), user, in)
	if err != nil || retry.Environment.ID != created.Environment.ID || retry.Operation.ID != created.Operation.ID {
		t.Fatalf("创建重试不幂等：%v", err)
	}
	in.Name = "不同名称"
	if _, err := s.Create(t.Context(), user, in); err == nil {
		t.Fatal("接受幂等键冲突")
	}
	out := syncState(t, s, host)
	if len(out.Targets) != 1 {
		t.Fatal("未返回分配目标")
	}
	syncState(t, s, host, observe(created.Environment, "running"))
	stopped, err := s.Change(t.Context(), &user, created.Environment.ID, "stopped", Change{1, "stop-1"})
	if err != nil {
		t.Fatal(err)
	}
	syncState(t, s, host, observe(created.Environment, "running"))
	q := sqlc.New(s.pool)
	current, _ := q.GetEnvironment(t.Context(), sqlc.GetEnvironmentParams{ID: created.Environment.ID, UserID: &user})
	if current.Generation != 2 || current.ObservedGeneration != 1 || !current.ComputeReserved {
		t.Fatal("旧报告覆盖新代次或过早释放预留")
	}
	if _, err := s.Change(t.Context(), &user, current.ID, "running", Change{2, "early-start"}); err == nil {
		t.Fatal("未确认停止就启动")
	}
	syncState(t, s, host, observe(stopped.Environment, "stopped"))
	usage, _ := q.UserUsage(t.Context(), user)
	if usage.Running != 0 || usage.StorageBytes != 3<<30 {
		t.Fatal("停止未释放计算或误释放存储")
	}
	started, err := s.Change(t.Context(), &user, current.ID, "running", Change{2, "start-2"})
	if err != nil {
		t.Fatal(err)
	}
	if started.Environment.InstanceID == created.Environment.InstanceID {
		t.Fatal("重建复用旧实例")
	}
	var before, after Spec
	json.Unmarshal(created.Environment.Spec, &before)
	json.Unmarshal(started.Environment.Spec, &after)
	if hash(before.Volumes) != hash(after.Volumes) {
		t.Fatal("重建更换持久卷")
	}
	deleted, err := s.Change(t.Context(), &user, current.ID, "deleted", Change{3, "delete-1"})
	if err != nil {
		t.Fatal(err)
	}
	out = syncState(t, s, host, observe(deleted.Environment, "deleted"))
	if len(out.Targets) != 0 {
		t.Fatal("已删除环境仍下发")
	}
	usage, _ = q.UserUsage(t.Context(), user)
	if usage.Running != 0 || usage.StorageBytes != 3<<30 {
		t.Fatal("删除未保留存储预留")
	}
	if _, err := s.Change(t.Context(), &user, current.ID, "running", Change{4, "restart-deleted"}); err == nil {
		t.Fatal("已删除环境复活")
	}
	other := resource.ID()
	if _, err := s.Change(t.Context(), &other, current.ID, "stopped", Change{4, "cross-user"}); !errors.Is(err, notFound) {
		t.Fatal("跨用户操作未拒绝")
	}
}
func TestConcurrentCreationCannotOversubscribe(t *testing.T) {
	s, user, _, preset := fixture(t)
	q := sqlc.New(s.pool)
	if _, err := q.SetQuota(t.Context(), sqlc.SetQuotaParams{UserID: user, MaxEnvironments: 3, MaxRunning: 1, CpuMillis: 1000, MemoryBytes: 512 << 20, StorageBytes: 100 << 30}); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	results := make(chan error, 8)
	for i := range 8 {
		wg.Go(func() {
			_, err := s.Create(t.Context(), user, Creation{preset, "项目", resource.ID()})
			_ = i
			results <- err
		})
	}
	wg.Wait()
	close(results)
	success := 0
	for err := range results {
		if err == nil {
			success++
		} else {
			var e *failure
			if !errors.As(err, &e) || e.code != "quota_exceeded" {
				t.Fatal(err)
			}
		}
	}
	if success != 1 {
		t.Fatalf("成功数量 %d", success)
	}
}
func TestReportsAreBoundToHostAndDesiredState(t *testing.T) {
	s, user, host, preset := fixture(t)
	created, err := s.Create(t.Context(), user, Creation{preset, "项目", "one"})
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(Exchange{Protocol: 1, Results: []Observation{observe(created.Environment, "stopped")}})
	if _, err := s.Exchange(t.Context(), host, raw); err == nil {
		t.Fatal("运行目标被停止报告释放额度")
	}
	raw, _ = json.Marshal(Exchange{Protocol: 1, Results: []Observation{{EnvironmentID: resource.ID(), InstanceID: created.Environment.InstanceID, Generation: 1, Phase: "running"}}})
	if _, err := s.Exchange(t.Context(), host, raw); err == nil {
		t.Fatal("接受未知环境报告")
	}
	if _, err := s.pool.Exec(t.Context(), "UPDATE users SET status='disabled' WHERE id=$1", user); err != nil {
		t.Fatal(err)
	}
	out := syncState(t, s, host)
	var target Spec
	json.Unmarshal(out.Targets[0], &target)
	if target.DesiredState != "stopped" || target.Generation != 2 {
		t.Fatal("禁用用户未转入停止目标")
	}
}
func TestAgentEndpointsRequireExplicitScopes(t *testing.T) {
	router := chi.NewRouter()
	NewService(nil).RegisterAgent(router)
	for _, route := range []struct{ method, path string }{{"GET", "/environment-quota"}, {"GET", "/environment-presets"}, {"GET", "/environments"}, {"GET", "/environments/x"}, {"GET", "/environments/x/operations"}, {"POST", "/environments"}, {"POST", "/environments/x/start"}, {"POST", "/environments/x/stop"}, {"DELETE", "/environments/x"}} {
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest(route.method, route.path, nil))
		if w.Code != 403 {
			t.Fatalf("%s 未拒绝缺少 scope：%d", route.path, w.Code)
		}
	}
}
func TestProfileRejectsUnsupportedPoliciesAndUnboundedStorage(t *testing.T) {
	p := profile()
	if err := p.Validate(); err != nil {
		t.Fatal(err)
	}
	p.NetworkPolicy = "host"
	if p.Validate() == nil {
		t.Fatal("接受未实现网络策略")
	}
	p = profile()
	p.Storage.WorkspaceBytes = 0
	if p.Validate() == nil {
		t.Fatal("接受无界存储")
	}
	p = profile()
	p.Image = "example.com/image:latest"
	if p.Validate() == nil {
		t.Fatal("接受浮动镜像")
	}
}

func TestHostCapacityAcrossUsers(t *testing.T) {
	s, _, host, preset := fixture(t)
	q := sqlc.New(s.pool)
	if _, err := q.SetHost(t.Context(), sqlc.SetHostParams{HostID: host, Enabled: true, CpuMillis: 1000, MemoryBytes: 512 << 20, StorageBytes: 100 << 30, MaxEnvironments: 10}); err != nil {
		t.Fatal(err)
	}
	users := make([]string, 8)
	for i := range users {
		users[i] = resource.ID()
		if _, err := s.pool.Exec(t.Context(), "INSERT INTO users(id) VALUES($1)", users[i]); err != nil {
			t.Fatal(err)
		}
	}
	var wg sync.WaitGroup
	results := make(chan error, len(users))
	for _, user := range users {
		wg.Go(func() {
			_, err := s.Create(t.Context(), user, Creation{preset, "项目", resource.ID()})
			results <- err
		})
	}
	wg.Wait()
	close(results)
	success := 0
	for err := range results {
		if err == nil {
			success++
		} else {
			var e *failure
			if !errors.As(err, &e) || e.code != "capacity_unavailable" {
				t.Fatal(err)
			}
		}
	}
	if success != 1 {
		t.Fatalf("宿主并发创建成功数量 %d", success)
	}
}

func TestHostAdmission(t *testing.T) {
	for name, query := range map[string]string{
		"disabled":         "UPDATE environment_hosts SET enabled=false",
		"protocol":         "UPDATE environment_hosts SET protocol=0",
		"sync_stale":       "UPDATE environment_hosts SET sync_at=now()-interval '2 minutes'",
		"heartbeat_stale":  "UPDATE engine_hosts SET last_seen_at=now()-interval '2 minutes'",
		"preflight_failed": `UPDATE engine_hosts SET report='{"prerequisites_met":false}'`,
		"revoked":          "UPDATE engine_hosts SET status='revoked'",
		"architecture":     "UPDATE engine_hosts SET architecture='arm64'",
	} {
		t.Run(name, func(t *testing.T) {
			s, user, _, preset := fixture(t)
			if _, err := s.pool.Exec(t.Context(), query); err != nil {
				t.Fatal(err)
			}
			_, err := s.Create(t.Context(), user, Creation{preset, "项目", "one"})
			var e *failure
			if !errors.As(err, &e) || e.code != "capacity_unavailable" {
				t.Fatalf("不满足准入条件仍调度：%v", err)
			}
		})
	}
}

func TestFailedDeletionCanBeRetried(t *testing.T) {
	s, user, host, preset := fixture(t)
	created, err := s.Create(t.Context(), user, Creation{preset, "项目", "create"})
	if err != nil {
		t.Fatal(err)
	}
	deleted, err := s.Change(t.Context(), &user, created.Environment.ID, "deleted", Change{1, "delete"})
	if err != nil {
		t.Fatal(err)
	}
	failed := observe(deleted.Environment, "failed")
	failed.Reason = "apply_failed"
	syncState(t, s, host, failed)
	retried, err := s.Change(t.Context(), &user, created.Environment.ID, "deleted", Change{2, "retry-delete"})
	if err != nil {
		t.Fatal(err)
	}
	if retried.Environment.Generation != 3 || !retried.Environment.ComputeReserved {
		t.Fatal("删除重试未保留资源或递增代次")
	}
	syncState(t, s, host, observe(retried.Environment, "deleted"))
	usage, err := sqlc.New(s.pool).UserUsage(t.Context(), user)
	if err != nil || usage.Running != 0 || usage.StorageBytes != 3<<30 {
		t.Fatalf("删除重试未正确完成：%+v %v", usage, err)
	}
}

func TestSpecMatchesEngineContract(t *testing.T) {
	raw, err := os.ReadFile("../../../engine/examples/environment.json")
	if err != nil {
		t.Fatal(err)
	}
	var expected Spec
	d := json.NewDecoder(strings.NewReader(string(raw)))
	d.DisallowUnknownFields()
	if err := d.Decode(&expected); err != nil {
		t.Fatal(err)
	}
	p := Profile{Architecture: "amd64", Image: expected.Image, NetworkPolicy: expected.NetworkPolicy, Resource: expected.Resource,
		Storage: Storage{WorkspaceBytes: expected.Volumes[0].Bytes, HomeBytes: expected.Volumes[1].Bytes, RuntimeBytes: expected.Volumes[2].Bytes, Inodes: expected.Volumes[0].Inodes}}
	if err := p.Validate(); err != nil {
		t.Fatal(err)
	}
	actual := p.Spec(expected.EnvironmentID)
	actual.InstanceID = expected.InstanceID
	for i := range actual.Volumes {
		actual.Volumes[i].ID = expected.Volumes[i].ID
	}
	if hash(actual) != hash(expected) {
		t.Fatal("后台规格与 engine 使用的规范化协议不一致")
	}
}

func TestNetworkCapabilityRequiredForCreateAndRestart(t *testing.T) {
	s, user, host, _ := fixture(t)
	p := profile()
	p.NetworkPolicy = "public-only"
	raw, _ := json.Marshal(p)
	q := sqlc.New(s.pool)
	preset, err := q.CreatePreset(t.Context(), sqlc.CreatePresetParams{Name: "公网预设", Architecture: p.Architecture, Configuration: raw, CpuMillis: p.Resource.CPUMillis, MemoryBytes: p.Resource.MemoryBytes, StorageBytes: p.Storage.Bytes()})
	if err != nil {
		t.Fatal(err)
	}
	creation := Creation{preset.ID, "联网项目", "network-create"}
	setReport := func(report string) {
		t.Helper()
		if _, err := s.pool.Exec(t.Context(), "UPDATE engine_hosts SET report=$2 WHERE id=$1", host, report); err != nil {
			t.Fatal(err)
		}
	}
	for _, report := range []string{`{"prerequisites_met":true}`, `{"prerequisites_met":true,"network_policies":["isolated"]}`, `{"prerequisites_met":true,"network_policies":{"public-only":true}}`, `{"prerequisites_met":true,"network_policies":"public-only"}`} {
		setReport(report)
		if _, err := s.Create(t.Context(), user, creation); err == nil {
			t.Fatal("向不支持公网策略的宿主分配了环境")
		}
		usage, err := q.UserUsage(t.Context(), user)
		if err != nil || usage.Running != 0 || usage.StorageBytes != 0 {
			t.Fatal("分配失败遗留资源预留", usage, err)
		}
	}
	setReport(`{"prerequisites_met":true,"network_policies":["isolated","public-only"]}`)
	created, err := s.Create(t.Context(), user, creation)
	if err != nil {
		t.Fatal(err)
	}
	stopped, err := s.Change(t.Context(), &user, created.Environment.ID, "stopped", Change{1, "network-stop"})
	if err != nil {
		t.Fatal(err)
	}
	syncState(t, s, host, observe(stopped.Environment, "stopped"))
	setReport(`{"prerequisites_met":true,"network_policies":["isolated"]}`)
	if _, err := s.Change(t.Context(), &user, created.Environment.ID, "running", Change{2, "network-restart"}); err == nil {
		t.Fatal("网络能力丢失仍允许重新启动")
	}
	setReport(`{"prerequisites_met":true,"network_policies":["public-only"]}`)
	if _, err := s.Change(t.Context(), &user, created.Environment.ID, "running", Change{2, "network-restart"}); err != nil {
		t.Fatal(err)
	}
}
