package host

import (
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/worker"
	"testing"
)

func TestReadinessRequiresEvidence(t *testing.T) {
	s := lifecycle.State{Spec: lifecycle.Spec{Driver: "firecracker", DesiredState: lifecycle.DesiredRunning, Runtime: &lifecycle.Runtime{}}, Phase: lifecycle.PhaseRunning}
	for _, tc := range []struct {
		obs            *worker.Observation
		guest, runtime string
	}{
		{nil, "unknown", "unknown"}, {&worker.Observation{Phase: "failed", Reason: "runtime_failed", RuntimeVersion: "1.0.0"}, "responsive", "failed"}, {&worker.Observation{Phase: "running"}, "responsive", "ready"}} {
		row := summarize(s, tc.obs)
		if row.Guest != tc.guest || row.Runtime != tc.runtime {
			t.Fatal(row)
		}
	}
	s.Spec.DesiredState = lifecycle.DesiredStopped
	s.Phase = lifecycle.PhaseStopped
	if row := summarize(s, &worker.Observation{Phase: "stopped", RuntimeVersion: "1.0.0"}); row.Guest == "responsive" || row.Runtime == "ready" {
		t.Fatal(row)
	}
}
