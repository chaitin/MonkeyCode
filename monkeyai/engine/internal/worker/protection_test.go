package worker

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
)

type protectedExecutor struct {
	s lifecycle.Spec
	p *lifecycle.Protection
}

func (e protectedExecutor) Apply(context.Context, lifecycle.Spec) (lifecycle.State, error) {
	return lifecycle.State{Spec: e.s, Phase: lifecycle.PhaseRunning}, nil
}
func (e protectedExecutor) Inspect(context.Context, string) (lifecycle.State, lifecycle.Instance, error) {
	return lifecycle.State{Spec: e.s, Phase: lifecycle.PhaseRunning}, lifecycle.Instance{Ref: e.s.InstanceID, Phase: lifecycle.InstancePaused, Protection: e.p}, nil
}
func TestWorkerPersistsProtectionAndNeverTreatsPauseAsExit(t *testing.T) {
	s := target(t)
	s.Driver = "firecracker"
	s.PersistentContainer = false
	s.VirtualMachine = &lifecycle.VirtualMachine{Architecture: "amd64", BundleSHA256: strings.Repeat("a", 64), SystemBytes: 1 << 30, DataBytes: 1 << 30}
	p := &lifecycle.Protection{ID: "11111111-1111-4111-8111-111111111111", At: time.Now().UTC(), Generation: s.Generation, Reason: "storage_pressure"}
	base, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(base, "worker")
	w, err := New(root, protectedExecutor{s, p})
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	e := entry{Target: s, Result: &Observation{EnvironmentID: s.EnvironmentID, InstanceID: s.InstanceID, Generation: s.Generation, Phase: "running"}}
	if err := w.save(e); err != nil {
		t.Fatal(err)
	}
	w.execute(t.Context(), e, false)
	result := w.entries[s.EnvironmentID].Result
	if result == nil || result.Phase != "protected" || result.Protection == nil || result.Protection.ID != p.ID {
		t.Fatal(result)
	}
	replay, err := New(root, protectedExecutor{s, p})
	if err != nil {
		t.Fatal(err)
	}
	defer replay.Close()
	if result := replay.entries[s.EnvironmentID].Result; result == nil || result.Phase != "protected" || result.Protection.ID != p.ID {
		t.Fatal("重启丢失保护事件", result)
	}
	legacy := w.wireObservation(*result)
	if legacy.Protection != nil || legacy.ObservedAt != nil || legacy.Phase != "failed" {
		t.Fatal("旧协议收到新字段", legacy)
	}
	w.protection = true
	current := w.wireObservation(*result)
	if current.Phase != "protected" || current.Protection == nil {
		t.Fatal(current)
	}
}
