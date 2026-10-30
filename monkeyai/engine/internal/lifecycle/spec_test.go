package lifecycle

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestDecodeRejectsAmbiguousOrUnsupportedSpecifications(t *testing.T) {
	raw, _ := json.Marshal(testSpec())
	if _, err := Decode(strings.NewReader(string(raw))); err != nil {
		t.Fatal(err)
	}
	for _, text := range []string{
		strings.Replace(string(raw), `"generation":1`, `"generation":1,"generation":2`, 1),
		strings.Replace(string(raw), `"generation":1`, `"Generation":1`, 1),
		strings.Replace(string(raw), `"host_tasks":256`, `"sandbox_tasks":256`, 1),
		strings.Replace(string(raw), `"network_policy":"isolated"`, `"network_policy":"host"`, 1),
		string(raw) + `{}`, strings.Repeat(" ", 65<<10),
	} {
		if _, err := Decode(strings.NewReader(text)); err == nil {
			t.Fatal("接受含混、超限或不支持的规格")
		}
	}
}
func TestPersistentVolumeTargetsAndQuotaAreBounded(t *testing.T) {
	for _, mutate := range []func(*Spec){
		func(s *Spec) { s.Volumes[0].Purpose = "../../etc" },
		func(s *Spec) { s.Volumes[0].ID = s.Volumes[1].ID },
		func(s *Spec) { s.Volumes[0].Bytes = 0 },
		func(s *Spec) { s.Resource.TemporaryBytes = s.Resource.MemoryBytes },
		func(s *Spec) { s.Image = "registry.example/image:latest" },
	} {
		s := testSpec()
		mutate(&s)
		if s.Validate() == nil {
			t.Fatal("接受不安全规格")
		}
	}
}
