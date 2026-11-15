package environment

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

type runtimeCatalogFixture struct{ latest string }

func (c runtimeCatalogFixture) Current(arch string) (RuntimePackage, error) {
	return c.Get(c.latest, arch)
}
func (runtimeCatalogFixture) Get(version, arch string) (RuntimePackage, error) {
	if arch != "amd64" || version != "26.1105.1" && version != "26.1105.2" {
		return RuntimePackage{}, fmt.Errorf("missing runtime")
	}
	files := map[string]RuntimeFile{}
	for _, name := range []string{"monkeyai-runtime", "ohmyagent", "LICENSES.txt", "bundle.json"} {
		files[name] = RuntimeFile{SHA256: strings.Repeat("a", 64), Size: 1}
	}
	return RuntimePackage{Version: version, Architecture: arch, Files: files}, nil
}
func TestRuntimeUpgradeKeepsContainerAndIdentity(t *testing.T) {
	service, created, host, authorizer := managedEnvironment(t)
	catalog := runtimeCatalogFixture{latest: "26.1105.2"}
	service.WithRuntimeCatalog(catalog)
	ctx := t.Context()
	env := created.Environment
	binding := runtimeRequest(env)
	if err := service.approveRuntime(ctx, host, binding); err != nil {
		t.Fatal(err)
	}
	if _, err := service.pool.Exec(ctx, `UPDATE hosts SET report=report || '{"environment_protocol":2,"runtime_update_protocol":1}'::jsonb WHERE id=$1`, host); err != nil {
		t.Fatal(err)
	}
	if _, err := service.UpdateRuntime(ctx, env.UserID, env.ID, RuntimeUpdate{Generation: 1, RequestKey: "running-update"}); err == nil {
		t.Fatal("允许更新运行中的环境")
	}
	running := observe(env, "running")
	running.RuntimeVersion = "26.1105.1"
	syncState(t, service, host, running)
	stop, err := service.Change(ctx, &env.UserID, env.ID, "stopped", Change{Generation: 1, RequestKey: "runtime-stop"})
	if err != nil {
		t.Fatal(err)
	}
	stopped := observe(stop.Environment, "stopped")
	stopped.RuntimeVersion = "26.1105.1"
	syncState(t, service, host, stopped)
	input := RuntimeUpdate{Generation: 2, RequestKey: "runtime-update"}
	updated, err := service.UpdateRuntime(ctx, env.UserID, env.ID, input)
	if err != nil || updated.Environment.InstanceID != env.InstanceID || updated.Operation.Kind != "runtime_upgrade" || updated.Operation.TargetVersion != "26.1105.2" {
		t.Fatal(updated, err)
	}
	var spec Spec
	if err := json.Unmarshal(updated.Environment.Spec, &spec); err != nil || spec.RuntimePackage == nil || spec.RuntimePackage.Version != "26.1105.2" {
		t.Fatal(spec, err)
	}
	service.runtimeCatalog = nil
	retry, err := service.UpdateRuntime(ctx, env.UserID, env.ID, input)
	if err != nil || retry.Operation.ID != updated.Operation.ID {
		t.Fatal("配置变化破坏请求重试", retry, err)
	}
	service.runtimeCatalog = catalog
	wrong := observe(updated.Environment, "stopped")
	wrong.RuntimeVersion = "26.1105.1"
	raw, _ := json.Marshal(Exchange{Protocol: 1, Results: []Observation{wrong}})
	if _, err := service.Exchange(ctx, host, raw); err == nil {
		t.Fatal("未安装目标版本却确认更新成功")
	}
	confirmed := wrong
	confirmed.RuntimeVersion = "26.1105.2"
	syncState(t, service, host, confirmed)
	query := sqlc.New(service.pool)
	actual, err := query.GetEnvironment(ctx, sqlc.GetEnvironmentParams{ID: env.ID, UserID: &env.UserID})
	identity, lookupErr := query.GetRuntime(ctx, env.ID)
	if err != nil || lookupErr != nil || identity.RuntimeVersion != "26.1105.2" || actual.InstanceID != env.InstanceID || actual.Phase != "stopped" {
		t.Fatal(actual, err)
	}
	if lookupErr != nil || identity.MachineID == nil || *identity.MachineID != binding.MachineID || authorizer.revoke != 0 {
		t.Fatal("更新改变身份或撤销授权", identity, err)
	}
	rollback, err := service.UpdateRuntime(ctx, env.UserID, env.ID, RuntimeUpdate{Generation: 3, RequestKey: "rollback", Version: "26.1105.1"})
	if err != nil {
		t.Fatal(err)
	}
	failed := observe(rollback.Environment, "failed")
	failed.Reason, failed.RuntimeVersion = "runtime_upgrade_failed", "26.1105.2"
	syncState(t, service, host, failed)
	retried, err := service.UpdateRuntime(ctx, env.UserID, env.ID, RuntimeUpdate{Generation: 4, RequestKey: "rollback-retry", Version: "26.1105.1"})
	if err != nil {
		t.Fatal("更新失败后不能重试", err)
	}
	finished := observe(retried.Environment, "stopped")
	finished.RuntimeVersion = "26.1105.1"
	syncState(t, service, host, finished)
	if _, err := service.UpdateRuntime(ctx, resource.ID(), env.ID, RuntimeUpdate{Generation: 5, RequestKey: "cross-user"}); err == nil {
		t.Fatal("跨用户更新未拒绝")
	}
}
