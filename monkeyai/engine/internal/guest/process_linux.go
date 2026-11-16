//go:build linux

package guest

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"syscall"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/standalone"
	"golang.org/x/sys/unix"
)

func runtimeCommand(ctx context.Context, args []string) (*exec.Cmd, error) {
	if os.Geteuid() != 0 {
		return nil, errors.New("虚拟机管理服务需要root以切换到开发用户")
	}
	if !dataMounted() {
		return nil, errors.New("持久数据盘未挂载，禁止初始化或执行 runtime")
	}
	command := exec.CommandContext(ctx, standalone.Binary, args...)
	command.Dir = "/workspace"
	command.Env = []string{"PATH=/opt/monkeyai:/usr/local/bin:/usr/bin:/bin", "HOME=/home/monkey", "USER=monkey", "LOGNAME=monkey", "LANG=C.UTF-8"}
	command.SysProcAttr = &syscall.SysProcAttr{Credential: &syscall.Credential{Uid: 1000, Gid: 1000, Groups: []uint32{1000}}, Setpgid: true, Pdeathsig: syscall.SIGKILL}
	return command, nil
}
func dataMounted() bool {
	raw, err := os.ReadFile("/proc/cmdline")
	if err != nil {
		return false
	}
	if _, err := ParseBinding(string(raw)); err != nil {
		return false
	}
	var base, state unix.Stat_t
	if unix.Stat("/", &base) != nil || unix.Stat("/var/lib/monkeyai", &state) != nil || base.Dev == state.Dev {
		return false
	}
	for _, path := range []string{"/workspace", "/home/monkey", "/var/lib/monkeyai/state"} {
		var st unix.Stat_t
		if unix.Stat(path, &st) != nil || st.Dev != state.Dev {
			return false
		}
	}
	return true
}
func shutdownVM(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if !dataMounted() {
		return errors.New("未确认虚拟机持久卷身份，拒绝关机")
	}
	unix.Sync()
	return unix.Reboot(unix.LINUX_REBOOT_CMD_POWER_OFF)
}
