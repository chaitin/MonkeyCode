package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"unsafe"

	"golang.org/x/sys/unix"
)

type XFS struct{}

func run(ctx context.Context, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Env = append(os.Environ(), "LC_ALL=C")
	var out bounded
	cmd.Stdout = &out
	cmd.Stderr = &out
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("%s 失败: %w", name, err)
	}
	return string(out), nil
}

type bounded []byte

func (b *bounded) Write(p []byte) (int, error) {
	n := len(p)
	if len(*b) < 64<<10 {
		*b = append(*b, p[:min(n, (64<<10)-len(*b))]...)
	}
	return n, nil
}
func (XFS) Check(ctx context.Context, root string) error {
	raw, err := run(ctx, "findmnt", "--json", "--target", root, "--output", "FSTYPE,OPTIONS")
	if err != nil {
		return err
	}
	var result struct {
		Filesystems []struct {
			Type    string `json:"fstype"`
			Options string `json:"options"`
		} `json:"filesystems"`
	}
	if json.Unmarshal([]byte(raw), &result) != nil || len(result.Filesystems) != 1 || result.Filesystems[0].Type != "xfs" {
		return errors.New("持久卷需要专用 XFS 文件系统")
	}
	opts := "," + result.Filesystems[0].Options + ","
	if !strings.Contains(opts, ",rw,") || strings.Contains(opts, ",pqnoenforce,") || (!strings.Contains(opts, ",prjquota,") && !strings.Contains(opts, ",pquota,")) {
		return errors.New("XFS 项目配额未启用")
	}
	state, err := run(ctx, "xfs_quota", "-x", "-c", "state", root)
	if err != nil {
		return err
	}
	project, on := false, 0
	for line := range strings.SplitSeq(state, "\n") {
		line = strings.TrimSpace(line)
		if strings.Contains(line, "quota state on") {
			project = strings.HasPrefix(line, "Project quota state on")
			continue
		}
		if project && (line == "Accounting: ON" || line == "Enforcement: ON") {
			on++
		}
	}
	if on != 2 {
		return errors.New("项目配额记账或强制执行未开启")
	}
	return nil
}

// Linux fsxattr 的布局与 FS_IOC_FSGETXATTR / FS_IOC_FSSETXATTR ABI 一致。
type fsxattr struct {
	Flags, Extent, Nextents, Project, CoW uint32
	Pad                                   [8]byte
}

func attr(fd int, request uintptr, value *fsxattr) error {
	_, _, errno := unix.Syscall(unix.SYS_IOCTL, uintptr(fd), request, uintptr(unsafe.Pointer(value)))
	if errno != 0 {
		return errno
	}
	return nil
}
func (XFS) Assign(_ context.Context, path string, project uint32) error {
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return err
	}
	defer unix.Close(fd)
	var a fsxattr
	if err := attr(fd, 0x801c581f, &a); err != nil {
		return err
	}
	if a.Project != 0 && a.Project != project {
		return errors.New("卷目录已属于另一个 XFS 项目")
	}
	if a.Project == 0 {
		// 只允许接管空目录，不递归改写既有用户数据的项目归属。
		entries, err := os.ReadDir(path)
		if err != nil {
			return err
		}
		if len(entries) != 0 {
			return errors.New("未分配项目的卷目录不是空目录")
		}
	}
	a.Project = project
	a.Flags |= 0x200 // FS_XFLAG_PROJINHERIT
	if err := attr(fd, 0x401c5820, &a); err != nil {
		return err
	}
	var checked fsxattr
	if err := attr(fd, 0x801c581f, &checked); err != nil {
		return err
	}
	if checked.Project != project || checked.Flags&0x200 == 0 {
		return errors.New("项目 ID 或继承标记设置失败")
	}
	if err := unix.Fchown(fd, 1000, 1000); err != nil {
		return err
	}
	return unix.Fchmod(fd, 0700)
}
func (XFS) Limit(ctx context.Context, root string, id uint32, bytes, inodes int64) error {
	if id < 10000 || bytes <= 0 || bytes%1024 != 0 || inodes <= 0 {
		return errors.New("配额参数无效")
	}
	_, err := run(ctx, "xfs_quota", "-x", "-c", fmt.Sprintf("limit -p bsoft=%dk bhard=%dk isoft=%d ihard=%d %d", bytes/1024, bytes/1024, inodes, inodes, id), root)
	if err != nil {
		return err
	}
	q, err := readQuota(root, id)
	if err != nil {
		return err
	}
	if q.ID != id || q.BlockHard != uint64(bytes/512) || q.InodeHard != uint64(inodes) {
		return errors.New("XFS 实际硬配额与请求不一致")
	}
	return nil
}

// fs_disk_quota_t 的固定 Linux UAPI 布局（112 字节）。
type diskQuota struct {
	Version, Flags                                             int8
	Mask                                                       uint16
	ID                                                         uint32
	BlockHard, BlockSoft, InodeHard, InodeSoft, Blocks, Inodes uint64
	ITimer, BTimer                                             int32
	IWarn, BWarn                                               uint16
	IHigh, BHigh, RHigh, Pad                                   int8
	RHard, RSoft, RCount                                       uint64
	RTimer                                                     int32
	RWarn                                                      uint16
	Pad3                                                       int16
	Pad4                                                       [8]byte
}

func readQuota(root string, id uint32) (diskQuota, error) {
	var q diskQuota
	fd, err := unix.Open(root, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return q, err
	}
	defer unix.Close(fd)
	_, _, errno := unix.Syscall6(unix.SYS_QUOTACTL_FD, uintptr(fd), uintptr((0x5803<<8)|2), uintptr(id), uintptr(unsafe.Pointer(&q)), 0, 0)
	if errno != 0 {
		return q, errno
	}
	return q, nil
}
func (XFS) Available(_ context.Context, root string, id uint32) (bool, error) {
	q, err := readQuota(root, id)
	if errors.Is(err, unix.ENOENT) || errors.Is(err, unix.ESRCH) {
		return true, nil
	}
	if err != nil {
		return false, err
	}
	return q.BlockHard == 0 && q.BlockSoft == 0 && q.InodeHard == 0 && q.InodeSoft == 0 && q.Blocks == 0 && q.Inodes == 0, nil
}
func (XFS) Reserve(_ context.Context, root string, total, delta int64) error {
	var stat unix.Statfs_t
	if err := unix.Statfs(root, &stat); err != nil {
		return err
	}
	capacity := int64(stat.Blocks) * stat.Bsize
	free := int64(stat.Bavail) * stat.Bsize
	reserve := max(capacity/10, int64(1<<30))
	if total < 0 || delta < 0 || total > capacity-reserve || (delta > 0 && delta > free-reserve) {
		return errors.New("持久存储预留超过数据盘容量或安全余量")
	}
	return nil
}
