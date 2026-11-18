//go:build linux

package guest

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"syscall"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/runtimeupdate"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/standalone"
	"golang.org/x/sys/unix"
)

func runtimeCommand(ctx context.Context, args []string) (*exec.Cmd, error) {
	if os.Geteuid() != 0 {
		return nil, errors.New("虚拟机管理服务需要root以切换到开发用户")
	}
	if !rootDiskReady() {
		return nil, errors.New("持久根磁盘未就绪，禁止初始化或执行runtime")
	}
	binary := standalone.Binary
	files, err := runtimeupdate.New("/var/lib/monkeyai", nil).Current()
	if err != nil {
		return nil, err
	}
	if files.Binary != "" {
		binary = files.Binary
		args = append([]string(nil), args...)
		for i := 0; i+1 < len(args); i++ {
			if args[i] == "--engine-bin" {
				args[i+1] = files.Engine
			}
		}
	}
	command := exec.CommandContext(ctx, binary, args...)
	command.Dir = "/workspace"
	command.Env = []string{"PATH=/opt/monkeyai:/usr/local/bin:/usr/bin:/bin", "HOME=/home/monkey", "USER=monkey", "LOGNAME=monkey", "LANG=C.UTF-8"}
	command.SysProcAttr = &syscall.SysProcAttr{Credential: &syscall.Credential{Uid: 1000, Gid: 1000, Groups: []uint32{1000}}, Setpgid: true, Pdeathsig: syscall.SIGKILL}
	return command, nil
}
func rootDiskReady() bool {
	raw, err := os.ReadFile("/proc/cmdline")
	if err != nil {
		return false
	}
	if _, err := ParseBinding(string(raw)); err != nil {
		return false
	}
	var base, state unix.Stat_t
	if unix.Stat("/", &base) != nil || unix.Stat("/var/lib/monkeyai", &state) != nil || base.Dev != state.Dev {
		return false
	}
	var fs unix.Statfs_t
	if unix.Statfs("/", &fs) != nil || fs.Type != unix.EXT4_SUPER_MAGIC || fs.Flags&unix.ST_RDONLY != 0 {
		return false
	}
	for _, path := range []string{"/workspace", "/home/monkey", "/var/lib/monkeyai/state"} {
		var st unix.Stat_t
		if unix.Lstat(path, &st) != nil || st.Mode&unix.S_IFMT != unix.S_IFDIR || st.Dev != state.Dev {
			return false
		}
	}
	return true
}
func shutdownVM(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if !rootDiskReady() {
		return errors.New("未确认虚拟机持久根盘身份，拒绝关机")
	}
	unix.Sync()
	return unix.Reboot(unix.LINUX_REBOOT_CMD_POWER_OFF)
}
