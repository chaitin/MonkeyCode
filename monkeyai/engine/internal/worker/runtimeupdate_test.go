package worker

import (
	"context"
	"errors"
	"runtime"
	"slices"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/control"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
)

type runtimeUpdater struct {
	fakeExecutor
	version string
	fail    bool
	updates int
}

func (e *runtimeUpdater) UpdateRuntime(_ context.Context, spec lifecycle.Spec) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.updates++
	if e.fail {
		return errors.New("download failed")
	}
	e.version = spec.RuntimePackage.Version
	return nil
}
func (e *runtimeUpdater) RuntimeVersion(context.Context, lifecycle.Spec) (string, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.version, nil
}
func runtimeTarget(t *testing.T) lifecycle.Spec {
	spec := target(t)
	spec.PersistentContainer = true
	spec.NetworkPolicy = "public-only"
	spec.Runtime = &lifecycle.Runtime{Server: "https://server.example", ServerID: "server", UserID: "user"}
	spec.DesiredState = lifecycle.DesiredStopped
	return spec
}
func TestOldServerDoesNotReceiveRuntimeVersion(t *testing.T) {
	spec := runtimeTarget(t)
	remote, client := server(t, spec)
	executor := &runtimeUpdater{version: "26.1105.1"}
	worker, err := New(directory(t), executor)
	if err != nil {
		t.Fatal(err)
	}
	defer worker.Close()
	if err := worker.Tick(t.Context(), client, control.Config{HostID: "host"}); err != nil {
		t.Fatal(err)
	}
	wait(t, func() bool {
		worker.mu.Lock()
		defer worker.mu.Unlock()
		return worker.entries[spec.EnvironmentID].Result != nil
	})
	if err := worker.Tick(t.Context(), client, control.Config{HostID: "host"}); err != nil {
		t.Fatal(err)
	}
	remote.mu.Lock()
	defer remote.mu.Unlock()
	if len(remote.reports) != 1 || remote.reports[0].RuntimeVersion != "" {
		t.Fatal("旧server收到了新增字段", remote.reports)
	}
}
func TestRuntimeUpdateFailureNeedsNewGeneration(t *testing.T) {
	spec := runtimeTarget(t)
	files := map[string]lifecycle.RuntimeFile{}
	for _, name := range []string{"monkeyai-runtime", "ohmyagent", "LICENSES.txt", "bundle.json"} {
		files[name] = lifecycle.RuntimeFile{SHA256: strings.Repeat("a", 64), Size: 1}
	}
	spec.RuntimePackage = &lifecycle.RuntimePackage{Version: "26.1105.2", Architecture: runtime.GOARCH, Files: files}
	remote, client := server(t, spec)
	remote.runtimeUpdateProtocol = 1
	executor := &runtimeUpdater{version: "26.1105.1", fail: true}
	worker, err := New(directory(t), executor)
	if err != nil {
		t.Fatal(err)
	}
	defer worker.Close()
	if err := worker.Tick(t.Context(), client, control.Config{HostID: "host"}); err != nil {
		t.Fatal(err)
	}
	wait(t, func() bool {
		worker.mu.Lock()
		defer worker.mu.Unlock()
		return worker.entries[spec.EnvironmentID].Result != nil
	})
	if err := worker.Tick(t.Context(), client, control.Config{HostID: "host"}); err != nil {
		t.Fatal(err)
	}
	remote.mu.Lock()
	reports := slices.Clone(remote.reports)
	remote.target.Generation++
	remote.mu.Unlock()
	if len(reports) != 1 || reports[0].Reason != "runtime_upgrade_failed" || reports[0].RuntimeVersion != "26.1105.1" {
		t.Fatal(reports)
	}
	executor.mu.Lock()
	executor.fail = false
	executor.mu.Unlock()
	if err := worker.Tick(t.Context(), client, control.Config{HostID: "host"}); err != nil {
		t.Fatal(err)
	}
	wait(t, func() bool {
		worker.mu.Lock()
		defer worker.mu.Unlock()
		entry := worker.entries[spec.EnvironmentID]
		return entry.Result != nil && entry.Result.Generation == 2
	})
	if err := worker.Tick(t.Context(), client, control.Config{HostID: "host"}); err != nil {
		t.Fatal(err)
	}
	executor.mu.Lock()
	defer executor.mu.Unlock()
	if executor.updates != 2 || executor.version != "26.1105.2" {
		t.Fatal("更新被自动重试或未执行新代次", executor.updates, executor.version)
	}
}
