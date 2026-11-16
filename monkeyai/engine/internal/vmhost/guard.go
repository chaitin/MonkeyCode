package vmhost

import (
	"context"
	"errors"
	"fmt"
	"os"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/vmdisk"
)

func (d *Driver) Guard(ctx context.Context, store lifecycle.FileStore) error {
	pool, err := d.pool()
	if err != nil {
		return err
	}
	pressure, refreshErr := pool.Refresh(ctx)
	if pressure != vmdisk.PressureCritical {
		if refreshErr != nil {
			return refreshErr
		}
		if pressure == vmdisk.PressureWarning {
			_, cleanupErr := d.Cache(ctx, true)
			recovered, err := pool.Refresh(ctx)
			if err == nil && recovered == vmdisk.PressureNormal {
				return nil
			}
			return errors.Join(errors.New("磁盘容量达到告警水位，阻止新虚拟机分配"), cleanupErr, err)
		}
		return nil
	}
	problems := []error{refreshErr}
	states, err := store.List()
	if err != nil {
		return errors.Join(refreshErr, err)
	}
	for _, state := range states {
		if state.Spec.Driver != "firecracker" || state.Phase == lifecycle.PhaseDeleted {
			continue
		}
		_, manager, _, err := d.stores(state.Spec)
		if err != nil {
			problems = append(problems, err)
			continue
		}
		actual, inspectErr := manager.Inspect(ctx, state.Spec.EnvironmentID)
		if errors.Is(inspectErr, os.ErrNotExist) {
			continue
		}
		if actual.ID == "" {
			problems = append(problems, inspectErr)
			continue
		}
		if err := validate(state.Spec, actual, state.ProviderRef); err != nil {
			problems = append(problems, err)
			continue
		}
		if actual.Phase == "paused" || actual.Phase == "stopped" || actual.Phase == "retained" || actual.Phase == "created" {
			continue
		}
		if _, err := manager.Protect(ctx, state.Spec.EnvironmentID); err != nil {
			problems = append(problems, fmt.Errorf("环境%s保护失败: %w", state.Spec.EnvironmentID, err))
		}
	}
	// 先保护活动写入者，再尝试回收无引用模板；恢复空间也不会解除实例锁定。
	_, cleanupErr := d.Cache(ctx, true)
	problems = append(problems, cleanupErr)
	problems = append(problems, errors.New("磁盘容量达到危险水位，已触发本地存储保护；需要显式恢复"))
	return errors.Join(problems...)
}
