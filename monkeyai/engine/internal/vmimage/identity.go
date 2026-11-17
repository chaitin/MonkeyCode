package vmimage

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

// DynamicUser强制禁止恢复SUID/SGID。独立的已退出服务保留动态身份，
// 转换器以该非root UID运行，直到写入进程组确认退出才释放身份。
func reserveConversionIdentity(ctx context.Context, stage, unit string) (uint32, error) {
	path := filepath.Join(stage, "identity.uid")
	id := "/usr/bin/id"
	if _, err := os.Stat(id); errors.Is(err, os.ErrNotExist) {
		id = "/bin/id"
	}
	args := []string{
		"--quiet", "--unit=" + identityUnit(unit), "--service-type=oneshot",
		"--property=RemainAfterExit=yes", "--property=DynamicUser=yes",
		"--property=User=" + strings.TrimSuffix(unit, ".service"),
		"--property=PrivateNetwork=yes", "--property=PrivateDevices=yes",
		"--property=ProtectSystem=strict", "--property=ProtectHome=yes", "--property=NoNewPrivileges=yes",
		"--property=CapabilityBoundingSet=", "--property=TasksMax=8", "--property=MemoryMax=32M",
		"--property=TimeoutStartSec=10s", "--property=TimeoutStopSec=5s",
		"--property=StandardOutput=file:" + path, "--property=StandardError=null", "--", id, "-u",
	}
	command := exec.CommandContext(ctx, "systemd-run", args...)
	command.Env = []string{"PATH=/usr/sbin:/usr/bin:/sbin:/bin", "LC_ALL=C"}
	if err := command.Run(); err != nil {
		return 0, fmt.Errorf("创建隔离转换动态身份失败: %w", err)
	}
	info, err := os.Lstat(path)
	if err != nil {
		return 0, err
	}
	if !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > 32 {
		return 0, errors.New("隔离转换动态身份记录无效")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}
	uid, err := strconv.ParseUint(strings.TrimSpace(string(raw)), 10, 32)
	if err != nil || uid < 61184 || uid > 65519 {
		return 0, errors.New("隔离转换UID不在systemd动态身份范围内")
	}
	return uint32(uid), nil
}
