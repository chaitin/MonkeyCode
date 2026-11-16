package host

import (
	"context"
	"path/filepath"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/control"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/preflight"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/vmhost"
)

func Report(ctx context.Context, cfg control.Config) (preflight.Report, error) {
	key, err := control.Key(control.KeyPath)
	if err != nil {
		return preflight.Report{}, err
	}
	client, err := control.New(cfg.Server, key)
	if err != nil {
		return preflight.Report{}, err
	}
	client.WithInsecure(cfg.Insecure)
	native, err := vmhost.New(filepath.Join(cfg.DataDir, "firecracker"), filepath.Join(root, "firecracker"), cfg.Firecracker, client, cfg.HostID)
	if err != nil {
		return preflight.Report{}, err
	}
	defer native.Close()
	return native.Report(ctx, cfg)
}
func (Executor) Report(ctx context.Context, cfg control.Config) (preflight.Report, error) {
	return Report(ctx, cfg)
}
