package vmhost

import (
	"context"
	"errors"
	"os"
	"path/filepath"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/control"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/storage"
)

func (d *Driver) CleanupPreparation(ctx context.Context, s lifecycle.Spec) error {
	unlock, err := control.Lock(filepath.Join(d.state, "cache.lock"))
	if err != nil {
		return err
	}
	defer unlock()
	return d.releasePreparation(ctx, s)
}

func (d *Driver) releasePreparation(ctx context.Context, s lifecycle.Spec) error {
	pool, err := d.pool()
	if err != nil {
		return err
	}
	return pool.Cancel(ctx, s.EnvironmentID, func(ctx context.Context) (bool, error) {
		if err := ctx.Err(); err != nil {
			return false, err
		}
		key := storage.Key(s.EnvironmentID)
		for _, path := range []string{
			filepath.Join(d.data, "disks", "records", key+".json"),
			filepath.Join(d.data, "disks", "disks", key),
			filepath.Join(d.data, "host", "records", key+".json"),
			filepath.Join(d.data, "host", "jailer", "firecracker", key),
			filepath.Join(d.state, "instances", key+".json"),
		} {
			if _, err := os.Lstat(path); !errors.Is(err, os.ErrNotExist) {
				return false, err
			}
		}
		for _, pattern := range []string{
			filepath.Join(d.data, "templates", "templates", ".convert-*"),
			filepath.Join(d.data, "fetches", ".prepare-*"),
		} {
			pending, err := filepath.Glob(pattern)
			if err != nil || len(pending) > 0 {
				return false, err
			}
		}
		network, err := d.network(s.NetworkPolicy)
		if err != nil {
			return false, err
		}
		present, err := network.HasAllocation(key)
		return !present, err
	})
}
