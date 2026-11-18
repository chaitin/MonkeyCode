package host

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/control"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/firecracker"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/storage"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/vmhost"
)

func Retained(ctx context.Context) ([]firecracker.State, error) {
	if runtime.GOOS != "linux" || os.Geteuid() != 0 {
		return nil, errors.New("磁盘管理需要Linux root")
	}
	states, err := (lifecycle.FileStore{Root: filepath.Join(root, "states")}).List()
	if err != nil {
		return nil, err
	}
	var native *vmhost.Driver
	out := []firecracker.State{}
	for _, state := range states {
		if state.Spec.Driver != "firecracker" || state.Phase != lifecycle.PhaseDeleted {
			continue
		}
		if native == nil {
			executor, err := open("firecracker")
			if err != nil {
				return nil, err
			}
			defer executor.Close()
			var ok bool
			native, ok = executor.(*vmhost.Driver)
			if !ok {
				return nil, errors.New("虚拟机磁盘执行器不匹配")
			}
		}
		disks, err := native.DiskState(ctx, state.Spec)
		if err != nil {
			return nil, err
		}
		if disks.Phase == "retained" {
			out = append(out, disks)
		}
	}
	return out, nil
}
func DestroyDisks(ctx context.Context, id, confirmedID string) error {
	if id == "" || id != confirmedID {
		return errors.New("永久销毁必须使用环境ID独立确认")
	}
	unlock, err := control.Lock(filepath.Join(root, "locks", storage.Key(id)+".lock"))
	if err != nil {
		return err
	}
	defer unlock()
	state, err := (lifecycle.FileStore{Root: filepath.Join(root, "states")}).Load(id)
	if err != nil {
		return err
	}
	if state.Spec.Driver != "firecracker" || state.Phase != lifecycle.PhaseDeleted {
		return errors.New("仅允许永久销毁已删除虚拟机的保留磁盘")
	}
	executor, err := open("firecracker")
	if err != nil {
		return err
	}
	defer executor.Close()
	native, ok := executor.(*vmhost.Driver)
	if !ok {
		return errors.New("虚拟机磁盘执行器不匹配")
	}
	return native.DestroyDisks(ctx, state.Spec, true)
}
