package firecracker

import (
	"context"
	"errors"
	"os"
)

// ActiveProcess 仅供停止清理使用，不证明虚拟机或runtime可用。
func (h *SystemHost) ActiveProcess(ctx context.Context, id string) (bool, error) {
	record, err := h.load(id)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	props, err := h.status(ctx, record)
	if err != nil {
		return false, err
	}
	if props["LoadState"] == "not-found" {
		return false, nil
	}
	if props["MainPID"] != "" && props["MainPID"] != "0" {
		return true, nil
	}
	if props["ActiveState"] == "inactive" || props["ActiveState"] == "failed" {
		return false, h.emptyCgroup(id, props["ControlGroup"])
	}
	return false, errors.New("宿主服务仍处于不确定的进程状态")
}
