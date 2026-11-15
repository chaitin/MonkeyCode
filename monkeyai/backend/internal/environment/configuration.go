package environment

import (
	"encoding/json"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
)

type executionConfig struct {
	Driver              string          `json:"driver"`
	Image               string          `json:"image"`
	ImageDigest         string          `json:"image_digest"`
	PersistentContainer bool            `json:"persistent_container,omitempty"`
	HostTasks           int64           `json:"host_tasks"`
	TemporaryBytes      int64           `json:"temporary_bytes"`
	Volumes             []Volume        `json:"volumes"`
	NetworkPolicy       string          `json:"network_policy"`
	Runtime             *Runtime        `json:"runtime,omitempty"`
	RuntimePackage      *RuntimePackage `json:"runtime_package,omitempty"`
}

func saveSpec(s Spec) []byte {
	raw, _ := json.Marshal(executionConfig{Driver: s.Driver, Image: s.Image, ImageDigest: s.ImageDigest, PersistentContainer: s.PersistentContainer, HostTasks: s.Resource.HostTasks, TemporaryBytes: s.Resource.TemporaryBytes, Volumes: s.Volumes, NetworkPolicy: s.NetworkPolicy, Runtime: s.Runtime, RuntimePackage: s.RuntimePackage})
	return raw
}
func executionSpec(e sqlc.Environment) (Spec, error) {
	var c executionConfig
	if err := json.Unmarshal(e.Spec, &c); err != nil {
		return Spec{}, err
	}
	return Spec{EnvironmentID: e.ID, InstanceID: e.InstanceID, Generation: e.Generation, DesiredState: e.Desired, Driver: c.Driver, Image: c.Image, ImageDigest: c.ImageDigest, PersistentContainer: c.PersistentContainer, Resource: Resources{CPUMillis: e.CpuMillis, MemoryBytes: e.MemoryBytes, HostTasks: c.HostTasks, TemporaryBytes: c.TemporaryBytes}, Volumes: c.Volumes, NetworkPolicy: c.NetworkPolicy, Runtime: c.Runtime, RuntimePackage: c.RuntimePackage}, nil
}
func wireSpec(e sqlc.Environment) json.RawMessage {
	spec, err := executionSpec(e)
	if err != nil {
		return nil
	}
	raw, _ := json.Marshal(spec)
	return raw
}
