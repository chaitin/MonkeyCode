package worker

import (
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/control"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
)

func TestOldBackendSandboxIdentitySurvivesRestart(t *testing.T) {
	for _, existing := range []bool{false, true} {
		s := target(t)
		s.PersistentContainer = true
		root := directory(t)
		if existing {
			old, err := New(root, &fakeExecutor{})
			if err != nil {
				t.Fatal(err)
			}
			if err := old.writeEntry(entry{Target: s}); err != nil {
				t.Fatal(err)
			}
			old.Close()
		}
		remote, client := server(t, s)
		for _, desired := range []lifecycle.DesiredState{"running", "running", "stopped", "running"} {
			remote.mu.Lock()
			if remote.target.DesiredState != desired {
				remote.target.Generation++
				remote.target.DesiredState = desired
			}
			remote.mu.Unlock()
			w, err := New(root, &fakeExecutor{})
			if err != nil {
				t.Fatal(err)
			}
			err = w.Tick(t.Context(), client, control.Config{HostID: "test"})
			w.Close()
			if err != nil {
				t.Fatal(err)
			}
			if got := w.entries[s.EnvironmentID].Target.SandboxRoot; got == existing {
				t.Fatalf("已有=%t 状态=%s：sandbox_root=%t", existing, desired, got)
			}
		}
	}
}

func TestNewTargetSandboxDefaults(t *testing.T) {
	for _, tc := range []struct {
		raw        string
		persistent bool
		generation int64
		desired    lifecycle.DesiredState
		invalid    bool
	}{
		{`{"sandbox_root":false}`, true, 1, "running", false},
		{`{"sandbox_root":null}`, true, 1, "running", true},
		{"{}", false, 1, "running", false}, {"{}", true, 2, "running", false}, {"{}", true, 1, "deleted", false},
	} {
		s := target(t)
		s.PersistentContainer, s.Generation, s.DesiredState = tc.persistent, tc.generation, tc.desired
		err := resolveSandboxRoot(&s, []byte(tc.raw), lifecycle.Spec{})
		if (err != nil) != tc.invalid || s.SandboxRoot {
			t.Fatalf("%+v: root=%t err=%v", tc, s.SandboxRoot, err)
		}
	}
}
