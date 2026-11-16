//go:build linux

package guest

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"

	"golang.org/x/sys/unix"
)

func releaseRuntime(ctx context.Context, payload, version, digest string) (engine string, cleanup func(), err error) {
	root, err := os.MkdirTemp("/run", "monkeyai-runtime-prepare-")
	if err != nil {
		return "", nil, err
	}
	if err := os.Chmod(root, 0755); err != nil {
		return "", nil, err
	}
	mounts := []string{}
	dispose := func() {
		for i := len(mounts) - 1; i >= 0; i-- {
			if unix.Unmount(mounts[i], 0) != nil {
				return
			}
		}
		os.RemoveAll(root)
	}
	complete := false
	defer func() {
		if !complete {
			dispose()
		}
	}()
	for _, name := range []string{"payload", "etc/systemd/system", "proc", "dev", "tmp", "home/monkey", "usr/local/bin", "var/lib", "opt", "run", "root"} {
		if err := os.MkdirAll(filepath.Join(root, name), 0755); err != nil {
			return "", nil, err
		}
	}
	for name, value := range map[string]string{"passwd": "root:x:0:0:root:/root:/bin/sh\nmonkey:x:1000:1000:monkey:/home/monkey:/bin/sh\n", "group": "root:x:0:\nmonkey:x:1000:\n"} {
		if err := os.WriteFile(filepath.Join(root, "etc", name), []byte(value), 0644); err != nil {
			return "", nil, err
		}
	}
	if err := unix.Mount("proc", filepath.Join(root, "proc"), "proc", unix.MS_NOSUID|unix.MS_NODEV|unix.MS_NOEXEC|unix.MS_RDONLY, ""); err != nil {
		return "", nil, fmt.Errorf("临时根目录proc挂载失败: %w", err)
	}
	mounts = append(mounts, filepath.Join(root, "proc"))
	for _, source := range []string{"/bin", "/sbin", "/usr/bin", "/usr/sbin", "/lib", "/lib64"} {
		info, err := os.Stat(source)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil || !info.IsDir() {
			return "", nil, errors.New("虚拟机系统工具目录无效")
		}
		target := filepath.Join(root, source)
		if err := os.MkdirAll(target, 0755); err != nil {
			return "", nil, err
		}
		if err := unix.Mount(source, target, "", unix.MS_BIND, ""); err != nil {
			return "", nil, err
		}
		mounts = append(mounts, target)
		if err := unix.Mount("", target, "", unix.MS_BIND|unix.MS_REMOUNT|unix.MS_RDONLY|unix.MS_NOSUID|unix.MS_NODEV, ""); err != nil {
			return "", nil, err
		}
	}
	if err := unix.Mknod(filepath.Join(root, "dev/null"), unix.S_IFCHR|0666, int(unix.Mkdev(1, 3))); err != nil {
		return "", nil, fmt.Errorf("临时根目录null设备创建失败: %w", err)
	}
	in, err := os.Open(payload)
	if err != nil {
		return "", nil, err
	}
	defer in.Close()
	out, err := os.OpenFile(filepath.Join(root, "payload/runtime"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0755)
	if err != nil {
		return "", nil, err
	}
	_, copyErr := io.Copy(out, in)
	if err := errors.Join(copyErr, out.Sync(), out.Close()); err != nil {
		return "", nil, err
	}
	cmd := exec.CommandContext(ctx, "/payload/runtime", "setup", "--install-only", "--run-as", "monkey", "--json")
	cmd.SysProcAttr = &syscall.SysProcAttr{Chroot: root, Pdeathsig: syscall.SIGKILL}
	cmd.Dir = "/"
	cmd.Env = []string{"PATH=/bin:/usr/bin:/sbin:/usr/sbin", "HOME=/root", "USER=root", "LANG=C.UTF-8"}
	if err := cmd.Run(); err != nil {
		return "", nil, fmt.Errorf("虚拟机内临时根目录无法释放runtime资源: %w", err)
	}
	complete = true
	return filepath.Join(root, "opt/monkeyai-runtime/versions", version+"-"+digest[:12], "ohmyagent"), dispose, nil
}
