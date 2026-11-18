package vmhost

import (
	"context"
	"errors"
	"os"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/firecracker"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
)

func (d *Driver) DiskState(ctx context.Context, s lifecycle.Spec) (firecracker.State, error) {
	_, manager, _, err := d.stores(s)
	if err != nil {
		return firecracker.State{}, err
	}
	state, err := manager.Inspect(ctx, s.EnvironmentID)
	if err != nil {
		return state, err
	}
	return state, validate(s, state, "")
}
func (d *Driver) DestroyDisks(ctx context.Context, s lifecycle.Spec, confirmed bool) error {
	if !confirmed || s.DesiredState != lifecycle.DesiredDeleted {
		return errors.New("永久销毁必须独立确认已删除环境")
	}
	disks, manager, _, err := d.stores(s)
	if err != nil {
		return err
	}
	state, err := manager.Inspect(ctx, s.EnvironmentID)
	if err != nil {
		return err
	}
	if err := validate(s, state, ""); err != nil {
		return err
	}
	if _, err := manager.Destroy(ctx, s.EnvironmentID, true); err != nil {
		return err
	}
	pool, err := d.pool()
	if err != nil {
		return err
	}
	return pool.Release(ctx, s.EnvironmentID, func(context.Context) (bool, error) {
		record, err := disks.Load(s.EnvironmentID)
		if err != nil {
			return false, err
		}
		if record.State != "destroyed" {
			return false, nil
		}
		if _, err := os.Lstat(record.Path); !errors.Is(err, os.ErrNotExist) {
			return false, errors.New("磁盘文件仍存在或无法核对")
		}
		return true, nil
	})
}
