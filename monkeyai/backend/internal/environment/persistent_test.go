package environment

import (
	"encoding/json"
	"testing"
)

func TestSandboxRootNeedsCapableHost(t *testing.T) {
	s, user, host := fixture(t)
	if _, err := s.pool.Exec(t.Context(), "UPDATE hosts SET report=report-'sandbox_root' WHERE id=$1", host); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Create(t.Context(), user, Creation{SpecificationSelection: testSpecification(), Name: "受限环境", RequestKey: "root-host"}); err == nil {
		t.Fatal("将 root 环境调度到旧宿主")
	}
}

func TestPersistentContainerRestartKeepsInstance(t *testing.T) {
	service, user, host := fixture(t)
	if _, err := service.pool.Exec(t.Context(), `UPDATE hosts SET report=report || '{"environment_protocol":2}'::jsonb WHERE id=$1`, host); err != nil {
		t.Fatal(err)
	}
	created, err := service.Create(t.Context(), user, Creation{SpecificationSelection: testSpecification(), Name: "持久系统", RequestKey: "persistent-create"})
	if err != nil {
		t.Fatal(err)
	}
	var spec Spec
	if err := json.Unmarshal(created.Environment.Spec, &spec); err != nil || !spec.PersistentContainer || !spec.SandboxRoot {
		t.Fatal("新版宿主未启用容器持久化", spec, err)
	}
	syncState(t, service, host, observe(created.Environment, "running"))
	stopped, err := service.Change(t.Context(), &user, created.Environment.ID, "stopped", Change{Generation: 1, RequestKey: "persistent-stop"})
	if err != nil {
		t.Fatal(err)
	}
	syncState(t, service, host, observe(stopped.Environment, "stopped"))
	started, err := service.Change(t.Context(), &user, created.Environment.ID, "running", Change{Generation: 2, RequestKey: "persistent-start"})
	if err != nil || started.Environment.InstanceID != created.Environment.InstanceID || started.Environment.Generation != 3 {
		t.Fatal("启动没有保留容器身份或更新代次", started, err)
	}
}

func TestLegacyContainerCanEnterPersistentStop(t *testing.T) {
	service, user, host := fixture(t)
	created, err := service.Create(t.Context(), user, Creation{SpecificationSelection: testSpecification(), Name: "旧环境", RequestKey: "legacy-create"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.pool.Exec(t.Context(), "UPDATE environments SET spec=spec-'persistent_container'-'sandbox_root' WHERE id=$1", created.Environment.ID); err != nil {
		t.Fatal(err)
	}
	syncState(t, service, host, observe(created.Environment, "running"))
	if _, err := service.pool.Exec(t.Context(), `UPDATE hosts SET report=report || '{"environment_protocol":2}'::jsonb WHERE id=$1`, host); err != nil {
		t.Fatal(err)
	}
	stopped, err := service.Change(t.Context(), &user, created.Environment.ID, "stopped", Change{Generation: 1, RequestKey: "legacy-stop"})
	if err != nil {
		t.Fatal(err)
	}
	var spec Spec
	if err := json.Unmarshal(stopped.Environment.Spec, &spec); err != nil || !spec.PersistentContainer || spec.SandboxRoot || stopped.Environment.InstanceID != created.Environment.InstanceID {
		t.Fatal("旧容器未以原身份进入持久停止", spec, err)
	}
}
