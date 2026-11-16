//go:build !linux

package guest

import (
	"context"
	"errors"
	"os/exec"
)

func runtimeCommand(context.Context, []string) (*exec.Cmd, error) {
	return nil, errors.New("虚拟机运行时仅支持Linux")
}
func shutdownVM(context.Context) error { return errors.New("虚拟机关机仅支持Linux") }
