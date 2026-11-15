package host

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/cache"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/control"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/driver"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/runtimeupdate"
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
	volumes, err := storage.New(cfg.DataDir)
	if err != nil {
		return nil, err
	}
	if _, err := os.Lstat(control.KeyPath); err != nil {
		return nil, err
	}
	key, err := control.Key(control.KeyPath)
	if err != nil {
		return nil, err
	}
	client, err := control.New(cfg.Server, key)
	if err != nil {
		return nil, err
	}
	client.WithInsecure(cfg.Insecure)
	d, err := driver.New("/var/run/docker.sock", filepath.Join(root, "instances"), volumes)
	if err != nil {
		return nil, err
	}
	manager := func(ctx context.Context, spec lifecycle.Spec) (*runtimeupdate.Manager, error) {
		mounts, err := volumes.Ensure(ctx, spec)
		if err != nil {
			return nil, err
		}
		for _, mount := range mounts {
			if mount.Target == "/var/lib/monkeyai" {
				return runtimeupdate.New(mount.Source, client).WithPreparer(func(ctx context.Context, payload, destination string, release lifecycle.RuntimePackage, reuse []string) (lifecycle.RuntimePackage, error) {
					return d.PrepareRuntime(ctx, spec, payload, destination, release, reuse)
				}), nil
			}
		}
		return nil, errors.New("runtime 持久目录缺失")
	}
	d.WithRuntimeSource(func(ctx context.Context, spec lifecycle.Spec) (standalone.Files, error) {
		current, err := manager(ctx, spec)
		if err != nil {
			return standalone.Files{}, err
		}
		return current.Current()
	})
	d.WithRuntimeUpdater(func(ctx context.Context, spec lifecycle.Spec) error {
		current, err := manager(ctx, spec)
		if err != nil {
			return err
		}
		return current.Update(ctx, *spec.RuntimePackage)
	})
	return d.WithRegistry(func(reference string) (string, error) { return client.RegistryAuth(cfg.HostID, reference) }), nil
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

func (Executor) UpdateRuntime(ctx context.Context, s lifecycle.Spec) error {
	unlock, err := control.Lock(filepath.Join(root, "locks", storage.Key(s.EnvironmentID)+".lock"))
	if err != nil {
		return err
	}
	defer unlock()
	state, err := (lifecycle.FileStore{Root: filepath.Join(root, "states")}).Load(s.EnvironmentID)
	if err != nil {
		return err
	}
	if state.Spec.Generation != s.Generation || state.Spec.InstanceID != s.InstanceID || state.Phase != lifecycle.PhaseStopped {
		return errors.New("runtime 更新与已停止环境不一致")
	}
	d, err := open()
	if err != nil {
		return err
	}
	defer d.Close()
	return d.UpdateRuntime(ctx, s)
}
func (Executor) RuntimeVersion(ctx context.Context, s lifecycle.Spec) (string, error) {
	d, err := open()
	if err != nil {
		return "", err
	}
	defer d.Close()
	return d.RuntimeVersion(ctx, s)
}

func (Executor) Usage(ctx context.Context, s lifecycle.Spec) (*lifecycle.Usage, error) {
	d, err := open()
	if err != nil {
		return nil, err
	}
	defer d.Close()
	return d.Usage(ctx, s, "")
}

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
		slog.Error("云环境运行时初始化失败", "environment_id", s.EnvironmentID, "generation", s.Generation, "error", err)
		saveErr := (lifecycle.FileStore{Root: filepath.Join(root, "states")}).Save(s.EnvironmentID, state)
		return errors.Join(err, saveErr)
	}
	return nil
}
