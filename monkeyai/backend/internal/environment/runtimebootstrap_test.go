package environment

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func TestRuntimeBootstrapSurvivesStopAndRestart(t *testing.T) {
	s, user, host := fixture(t)
	ctx := t.Context()
	if _, err := s.pool.Exec(ctx, `INSERT INTO settings(key,value,updated_by_user_id) VALUES('billing','{"environment":{"cpu_credits_per_core_hour":"0","memory_credits_per_gib_hour":"0"}}',$1)`, user); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `UPDATE hosts SET report=report || '{"runtime_protocol":1,"runtime_update_protocol":2}' WHERE id=$1`, host); err != nil {
		t.Fatal(err)
	}
	s.WithRuntime("https://ai.example.com", resource.ID(), &runtimeAuthorizer{})
	s.WithRuntimeCatalog(officialRuntimeCatalog{runtimeCatalogFixture{latest: "26.1105.1"}})
	created, err := s.Create(ctx, user, Creation{testSpecification(), "运行时重试", "bootstrap-create"})
	if err != nil {
		t.Fatal(err)
	}
	pkg := func(out Commands) *RuntimePackage {
		t.Helper()
		for _, raw := range out.Targets {
			var spec Spec
			if err := json.Unmarshal(raw, &spec); err != nil {
				t.Fatal(err)
			}
			if spec.EnvironmentID == created.Environment.ID {
				return spec.RuntimePackage
			}
		}
		t.Fatal("未收到环境命令")
		return nil
	}
	original := pkg(syncState(t, s, host))
	if original == nil || original.Version != "26.1105.1" {
		t.Fatal("首启未收到固定版本的 runtime 包", original)
	}
	s.WithRuntimeCatalog(officialRuntimeCatalog{runtimeCatalogFixture{latest: "26.1105.2"}})
	change := func(env View, desired, request string) View {
		t.Helper()
		result, err := s.Change(ctx, &user, env.ID, desired, Change{env.Generation, request})
		if err != nil {
			t.Fatal(err)
		}
		return result.Environment
	}
	failed := observe(created.Environment, "failed")
	failed.Reason = "apply_failed"
	syncState(t, s, host, failed)
	stopped := change(created.Environment, "stopped", "bootstrap-stop")
	if got := pkg(syncState(t, s, host, observe(stopped, "stopped"))); got != nil {
		t.Fatal("普通停止不应携带升级包", got)
	}
	restarted := change(stopped, "running", "bootstrap-restart")
	if got := pkg(syncState(t, s, host)); !reflect.DeepEqual(got, original) {
		t.Fatalf("重试应下发原始发行包，实际为 %+v", got)
	}
	failed = observe(restarted, "failed")
	failed.Reason, failed.RuntimeVersion = "runtime_failed", original.Version
	syncState(t, s, host, failed)
	stopped = change(restarted, "stopped", "installed-stop")
	syncState(t, s, host, observe(stopped, "stopped"))
	restarted = change(stopped, "running", "installed-restart")
	if got := pkg(syncState(t, s, host)); got != nil {
		t.Fatal("已安装 runtime 的环境不应再次下发补装指令", got)
	}
	stopped = change(restarted, "stopped", "upgrade-stop")
	syncState(t, s, host, observe(stopped, "stopped"))
	if _, err := s.UpdateRuntime(ctx, user, stopped.ID, RuntimeUpdate{Generation: stopped.Generation, RequestKey: "explicit-upgrade"}); err != nil {
		t.Fatal(err)
	}
	if got := pkg(syncState(t, s, host)); got == nil || got.Version != "26.1105.2" {
		t.Fatal("显式升级仍应下发目标版本", got)
	}
}
