package vmhost

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/control"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/firecracker"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/storage"
)

func (d *Driver) Usage(ctx context.Context, s lifecycle.Spec, ref string) (*lifecycle.Usage, error) {
	_, manager, host, err := d.stores(s)
	if err != nil {
		return nil, err
	}
	actual, err := manager.Inspect(ctx, s.EnvironmentID)
	if err != nil {
		return nil, err
	}
	if err := validate(s, actual, ref); err != nil {
		return nil, err
	}
	if actual.Phase != "running" || actual.ProtectionGeneration != 0 {
		return nil, errors.New("虚拟机当前状态不能采集运行指标")
	}
	sample, err := host.Sample(ctx, actual.ID)
	if err != nil {
		return nil, err
	}
	root := filepath.Join(d.state, "usage")
	if err := storage.PrivateDir(root); err != nil {
		return nil, err
	}
	path := filepath.Join(root, actual.ID+".json")
	var previous firecracker.Sample
	info, err := os.Lstat(path)
	if err == nil {
		if !info.Mode().IsRegular() || info.Size() > 4096 || info.Mode().Perm() != 0600 {
			return nil, errors.New("资源采样记录无效")
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		if json.Unmarshal(raw, &previous) != nil {
			return nil, errors.New("资源采样记录损坏")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	result := usage(sample, previous)
	raw, _ := json.Marshal(sample)
	if err := control.Write(path, raw, 0600); err != nil {
		return nil, err
	}
	return result, nil
}
func usage(current, previous firecracker.Sample) *lifecycle.Usage {
	result := &lifecycle.Usage{At: current.At, MemoryBytes: &current.Memory}
	elapsed := current.At.Sub(previous.At)
	if current.BootID == previous.BootID && previous.BootID != "" && current.CPUUsec >= previous.CPUUsec && elapsed >= time.Second && elapsed <= 5*time.Minute {
		cores := float64(current.CPUUsec-previous.CPUUsec) / float64(elapsed.Microseconds())
		result.CPUCores = &cores
	}
	return result
}
