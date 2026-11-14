package driver

import (
	"context"
	"errors"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/standalone"
)

func (d *Driver) runtimeFiles(ctx context.Context, spec lifecycle.Spec) (standalone.Files, error) {
	if d.runtimeSource != nil {
		files, err := d.runtimeSource(ctx, spec)
		if err != nil {
			return standalone.Files{}, err
		}
		if files.Binary != "" {
			return files, nil
		}
	}
	image, err := d.image(ctx, spec)
	if err != nil {
		return standalone.Files{}, err
	}
	version := image.Config.Labels["com.chaitin.monkeyai.runtime.version"]
	if !lifecycle.ValidRuntimeVersion(version) {
		version = ""
	}
	return standalone.Files{Binary: standalone.Binary, Engine: standalone.Engine, Version: version}, nil
}
func (d *Driver) UpdateRuntime(ctx context.Context, spec lifecycle.Spec) error {
	if spec.DesiredState != lifecycle.DesiredStopped || spec.RuntimePackage == nil || !spec.PersistentContainer || d.runtimeUpdater == nil {
		return errors.New("runtime 更新需要已停止的持久容器")
	}
	container, err := d.load(ctx, spec, "")
	if err != nil {
		return err
	}
	if container.State.Running || container.State.Paused || container.State.Dead || container.State.Status != "created" && container.State.Status != "exited" {
		return errors.New("容器未确认停止，拒绝更新 runtime")
	}
	return d.runtimeUpdater(ctx, spec)
}

func (d *Driver) RuntimeVersion(ctx context.Context, spec lifecycle.Spec) (string, error) {
	files, err := d.runtimeFiles(ctx, spec)
	return files.Version, err
}
