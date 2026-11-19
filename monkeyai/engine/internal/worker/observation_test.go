package worker

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestLastObservationMatchesInstanceAndGeneration(t *testing.T) {
	dir := t.TempDir()
	s := target(t)
	result := &Observation{EnvironmentID: s.EnvironmentID, InstanceID: s.InstanceID, Generation: s.Generation, Phase: "running"}
	raw, err := json.Marshal(entry{Target: s, Result: result})
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(dir, s.EnvironmentID+".json"), raw, 0600); err != nil {
		t.Fatal(err)
	}
	if got, err := LastObservation(dir, s); err != nil || got == nil {
		t.Fatal(got, err)
	}
	old := s
	old.InstanceID = "other"
	if got, err := LastObservation(dir, old); err != nil || got != nil {
		t.Fatal(got, err)
	}
	s.Generation++
	if got, err := LastObservation(dir, s); err != nil || got != nil {
		t.Fatal(got, err)
	}
}
