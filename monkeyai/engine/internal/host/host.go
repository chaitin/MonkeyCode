package host

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/cache"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/control"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/driver"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/standalone"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/storage"
)

const root = "/var/lib/monkeyai-engine/control/environments"

func open() (*driver.Driver, error) {
	if runtime.GOOS != "linux" || os.Geteuid() != 0 {
		return nil, errors.New("环境操作需要 Linux root")
	}
	raw, err := os.ReadFile(control.ConfigPath)
	if err != nil {
		return nil, err
	}
	var cfg control.Config
	if json.Unmarshal(raw, &cfg) != nil || cfg.HostID == "" || cfg.Architecture != runtime.GOARCH {
		return nil, errors.New("宿主安装配置无效")
	}
	volumes, err := storage.New(cfg.DataDir, storage.XFS{})
	if err != nil {
		return nil, err
	}
	return driver.New("/run/monkeyai-engine/containerd.sock", filepath.Join(root, "instances"), volumes)
}
func Apply(ctx context.Context, s lifecycle.Spec) (lifecycle.State, error) {
	if err := s.Validate(); err != nil {
		return lifecycle.State{}, err
	}
	if runtime.GOOS != "linux" || os.Geteuid() != 0 {
		return lifecycle.State{}, errors.New("环境操作需要 Linux root")
	}
	locks := filepath.Join(root, "locks")
	if err := storage.PrivateDir(locks); err != nil {
		return lifecycle.State{}, err
	}
	unlock, err := control.Lock(filepath.Join(locks, storage.Key(s.EnvironmentID)+".lock"))
	if err != nil {
		return lifecycle.State{}, err
	}
	defer unlock()
	d, err := open()
	if err != nil {
		return lifecycle.State{}, err
	}
	defer d.Close()
	coordinator, err := lifecycle.NewCoordinator(lifecycle.FileStore{Root: filepath.Join(root, "states")}, d)
	if err != nil {
		return lifecycle.State{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Minute)
	defer cancel()
	return coordinator.Apply(ctx, s)
}

type Status struct {
	State            lifecycle.State    `json:"state"`
	Instance         lifecycle.Instance `json:"instance"`
	WorkloadVerified bool               `json:"workload_verified"`
}

func Inspect(ctx context.Context, id string) (Status, error) {
	if runtime.GOOS != "linux" || os.Geteuid() != 0 {
		return Status{}, errors.New("环境操作需要 Linux root")
	}
	locks := filepath.Join(root, "locks")
	if err := storage.PrivateDir(locks); err != nil {
		return Status{}, err
	}
	unlock, err := control.Lock(filepath.Join(locks, storage.Key(id)+".lock"))
	if err != nil {
		return Status{}, err
	}
	defer unlock()
	state, err := (lifecycle.FileStore{Root: filepath.Join(root, "states")}).Load(id)
	if err != nil {
		return Status{}, err
	}
	d, err := open()
	if err != nil {
		return Status{}, err
	}
	defer d.Close()
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	actual, err := d.Inspect(ctx, state.Spec, state.ProviderRef)
	return Status{State: state, Instance: actual}, err
}

type Executor struct{}

func (Executor) Apply(ctx context.Context, s lifecycle.Spec) (lifecycle.State, error) {
	return Apply(ctx, s)
}
func (Executor) Inspect(ctx context.Context, id string) (lifecycle.State, lifecycle.Instance, error) {
	out, err := Inspect(ctx, id)
	return out.State, out.Instance, err
}

func Cache(ctx context.Context, prune bool) (cache.Report, error) {
	d, err := open()
	if err != nil {
		return cache.Report{}, err
	}
	defer d.Close()
	return d.Cache(ctx, prune)
}

func (Executor) Runtime(ctx context.Context, s lifecycle.Spec, approve standalone.Approve, observe bool) error {
	unlock, err := control.Lock(filepath.Join(root, "locks", storage.Key(s.EnvironmentID)+".lock"))
	if err != nil {
		return err
	}
	defer unlock()
	state, err := (lifecycle.FileStore{Root: filepath.Join(root, "states")}).Load(s.EnvironmentID)
	if err != nil {
		return err
	}
	if state.Spec.Generation != s.Generation || state.Spec.InstanceID != s.InstanceID || state.Phase != lifecycle.PhaseRunning {
		return errors.New("运行时目标与当前实例不一致")
	}
	d, err := open()
	if err != nil {
		return err
	}
	defer d.Close()
	ctx, cancel := context.WithTimeout(ctx, 12*time.Minute)
	defer cancel()
	if err := standalone.Ensure(ctx, s, d, approve, observe); err != nil {
		if ctx.Err() != nil {
			return err
		}
		state.Phase = lifecycle.PhaseFailed
		state.Reason = "runtime_failed"
		saveErr := (lifecycle.FileStore{Root: filepath.Join(root, "states")}).Save(s.EnvironmentID, state)
		return errors.Join(err, saveErr)
	}
	return nil
}
