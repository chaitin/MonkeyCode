package environment

import (
	"encoding/json"
	"errors"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
	"github.com/go-chi/chi/v5"
)

func setupFixture(t *testing.T) (*Service, string, string, Setup) {
	t.Helper()
	s, user, host, _ := fixture(t)
	if _, err := s.pool.Exec(t.Context(), `UPDATE engine_hosts SET report=report || '{"prerequisites_met":true,"network_policies":["public-only"]}' WHERE id=$1`, host); err != nil {
		t.Fatal(err)
	}
	p := profile()
	p.NetworkPolicy = "public-only"
	p.Storage = Storage{}
	return s, user, host, Setup{Preset: SetupPreset{Name: "共享环境", Configuration: p}, Quota: DefaultQuota{MaxEnvironments: 3, MaxRunning: 2, CPUMillis: 2000, MemoryBytes: 2 << 30}}
}
func TestSetupDefaultsAndImmutablePreset(t *testing.T) {
	s, user, host, in := setupFixture(t)
	ctx := t.Context()
	q := sqlc.New(s.pool)
	first, err := s.saveSetup(ctx, host, in)
	if err != nil {
		t.Fatal(err)
	}
	defaults, _ := q.GetDefaults(ctx)
	id := *defaults.PresetID
	limits, err := quota(ctx, q, user)
	if err != nil || limits.CpuMillis != 2000 {
		t.Fatal(limits, err)
	}
	again, err := s.saveSetup(ctx, host, in)
	if err != nil || again.Revision != first.Revision {
		t.Fatal("重试不应创建新预设", again, err)
	}
	if _, err = q.SetQuota(ctx, sqlc.SetQuotaParams{UserID: user, MaxEnvironments: 4, MaxRunning: 3, CpuMillis: 6000, MemoryBytes: 6 << 30}); err != nil {
		t.Fatal(err)
	}
	// 保留已有实例规格，更新只影响后续创建。
	created, err := s.Create(ctx, user, Creation{Name: "原环境", RequestKey: "before"})
	if err != nil {
		t.Fatal(err)
	}
	in.Revision = first.Revision
	in.Preset.Configuration.Resource.CPUMillis = 1500
	in.Quota.CPUMillis = 3000
	next, err := s.saveSetup(ctx, host, in)
	if err != nil {
		t.Fatal(err)
	}
	if next.Revision != first.Revision+1 {
		t.Fatal(next)
	}
	old, _ := q.GetPreset(ctx, id)
	if old.Enabled {
		t.Fatal("旧共享预设没有停用")
	}
	limits, err = quota(ctx, q, user)
	if err != nil || limits.CpuMillis != 6000 {
		t.Fatal("个人覆盖被修改", limits, err)
	}
	env, err := q.GetEnvironment(ctx, sqlc.GetEnvironmentParams{ID: created.Environment.ID, UserID: &user})
	if err != nil || env.CpuMillis != 1000 {
		t.Fatal("已有规格被修改", env, err)
	}
	current, _ := q.GetDefaults(ctx)
	if *current.PresetID == id {
		t.Fatal("新规格必须新建预设")
	}
	// 重放迁移不能覆盖管理员配置。
	raw, err := os.ReadFile("../../migrations/000041_environment_defaults.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.pool.Exec(ctx, string(raw)); err != nil {
		t.Fatal(err)
	}
	replay, _ := q.GetDefaults(ctx)
	if replay.Revision != current.Revision || *replay.PresetID != *current.PresetID {
		t.Fatal(replay)
	}
}
func TestSetupRejectsPartialAndConcurrentChanges(t *testing.T) {
	s, user, host, in := setupFixture(t)
	ctx := t.Context()
	q := sqlc.New(s.pool)
	first, err := s.saveSetup(ctx, host, in)
	if err != nil {
		t.Fatal(err)
	}
	for i := range 2 {
		if _, err = s.Create(ctx, user, Creation{Name: "占用", RequestKey: string(rune('a' + i))}); err != nil {
			t.Fatal(err)
		}
	}
	in.Revision = first.Revision
	before, _ := q.GetHost(ctx, host)
	bad := in
	bad.Quota.MaxRunning = 1
	bad.Preset.Name = "不能落盘"
	if _, err = s.saveSetup(ctx, host, bad); err == nil {
		t.Fatal("降低已有占用未拒绝")
	}
	after, _ := q.GetHost(ctx, host)
	unchanged, _ := q.GetDefaults(ctx)
	if after.CpuMillis != before.CpuMillis || unchanged.Revision != first.Revision {
		t.Fatal("失败产生部分更新")
	}
	var count int
	if err = s.pool.QueryRow(ctx, "SELECT count(*) FROM environment_presets WHERE name='不能落盘'").Scan(&count); err != nil || count != 0 {
		t.Fatal(count, err)
	}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for i := range 2 {
		wg.Go(func() {
			next := in
			next.Quota.MaxEnvironments += int32(i + 1)
			_, err := s.saveSetup(ctx, host, next)
			results <- err
		})
	}
	wg.Wait()
	close(results)
	successes, conflicts := 0, 0
	for err := range results {
		if err == nil {
			successes++
			continue
		}
		var e *failure
		if errors.As(err, &e) && e.code == "configuration_conflict" {
			conflicts++
		} else {
			t.Fatal(err)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatal(successes, conflicts)
	}
}
func TestSetupRoutesAndValidation(t *testing.T) {
	s, _, host, in := setupFixture(t)
	router := chi.NewRouter()
	s.RegisterAdmin(router)
	get := httptest.NewRecorder()
	router.ServeHTTP(get, httptest.NewRequest("GET", "/environment-hosts/"+host+"/setup", nil))
	if get.Code != 200 || get.Header().Get("Cache-Control") != "no-store" {
		t.Fatal(get.Code, get.Body.String())
	}
	for _, change := range []func(*Setup){
		func(v *Setup) { v.Preset.Configuration.Architecture = "arm64" },
		func(v *Setup) { v.Preset.Configuration.NetworkPolicy = "isolated" },
		func(v *Setup) { v.Quota.CPUMillis = 100 },
	} {
		bad := in
		change(&bad)
		raw, _ := json.Marshal(bad)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest("PUT", "/environment-hosts/"+host+"/setup", strings.NewReader(string(raw))))
		if rec.Code != 400 {
			t.Fatal(rec.Code, rec.Body.String())
		}
	}
	if _, err := s.pool.Exec(t.Context(), "UPDATE engine_hosts SET status='revoked' WHERE id=$1", host); err != nil {
		t.Fatal(err)
	}
	if _, err := s.saveSetup(t.Context(), host, in); err == nil {
		t.Fatal("撤销宿主允许配置")
	}
}
