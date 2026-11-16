package vmhost

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/control"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/storage"
)

type runtimeVersion struct {
	InstanceID string `json:"instance_id"`
	Version    string `json:"version"`
}

func (d *Driver) saveRuntimeVersion(s lifecycle.Spec, version string) error {
	if !lifecycle.ValidRuntimeVersion(version) {
		return errors.New("runtime版本无效")
	}
	root := filepath.Join(d.state, "runtime")
	if err := storage.PrivateDir(root); err != nil {
		return err
	}
	raw, _ := json.Marshal(runtimeVersion{InstanceID: s.InstanceID, Version: version})
	return control.Write(filepath.Join(root, storage.Key(s.EnvironmentID)+".json"), raw, 0600)
}
func (d *Driver) readRuntimeVersion(s lifecycle.Spec) (string, error) {
	path := filepath.Join(d.state, "runtime", storage.Key(s.EnvironmentID)+".json")
	info, err := os.Lstat(path)
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || info.Size() > 1024 {
		return "", errors.New("runtime版本记录类型无效")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	var record runtimeVersion
	if json.Unmarshal(raw, &record) != nil || record.InstanceID != s.InstanceID || !lifecycle.ValidRuntimeVersion(record.Version) {
		return "", errors.New("runtime版本记录与实例不一致")
	}
	return record.Version, nil
}
