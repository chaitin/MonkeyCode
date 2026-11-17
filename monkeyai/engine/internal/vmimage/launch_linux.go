//go:build linux

package vmimage

import (
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"syscall"

	"golang.org/x/sys/unix"
)

// ConvertAs仅在受限服务内把可信程序切换到已租用的非root身份；
// 子进程exec后仅保留元数据能力，不携带父进程的SETUID/SETGID能力。
func ConvertAs(ctx context.Context, uid uint32, stderr io.Writer) error {
	if os.Geteuid() != 0 || os.Getenv("INVOCATION_ID") == "" || uid < 61184 || uid > 65519 {
		return errors.New("转换启动器需要隔离服务和已租用的动态UID")
	}
	binary, err := os.Executable()
	if err != nil {
		return err
	}
	command := exec.CommandContext(ctx, binary, "convert", "--request", "/request.json")
	command.Stdout = io.Discard
	command.Stderr = stderr
	command.SysProcAttr = &syscall.SysProcAttr{
		Credential:  &syscall.Credential{Uid: uid, Gid: uid},
		AmbientCaps: []uintptr{unix.CAP_CHOWN, unix.CAP_DAC_OVERRIDE, unix.CAP_FOWNER, unix.CAP_FSETID, unix.CAP_SETFCAP},
	}
	return command.Run()
}
