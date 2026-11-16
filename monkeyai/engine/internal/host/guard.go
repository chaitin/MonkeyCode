package host

import (
	"context"
	"path/filepath"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/control"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/vmhost"
)

func (Executor) Guard(ctx context.Context, cfg control.Config) error {
	if len(cfg.Firecracker) == 0 {
		return nil
	}
	key, err := control.Key(control.KeyPath)
	if err != nil {
		return err
	}
	client, err := control.New(cfg.Server, key)
	if err != nil {
		return err
	}
	client.WithInsecure(cfg.Insecure)
	native, err := vmhost.New(filepath.Join(cfg.DataDir, "firecracker"), filepath.Join(root, "firecracker"), cfg.Firecracker, client, cfg.HostID)
	if err != nil {
		return err
	}
	defer native.Close()
	return native.Guard(ctx, lifecycle.FileStore{Root: filepath.Join(root, "states")})
}
