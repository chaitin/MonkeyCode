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
	"strings"
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
	for _, name := range []string{"payload", "etc", "etc/systemd", "etc/systemd/system", "proc", "dev", "tmp", "home", "home/monkey", "usr", "usr/local", "usr/local/bin", "var", "var/lib", "opt", "run", "root"} {
		path := filepath.Join(root, name)
		if err := os.MkdirAll(path, 0755); err != nil {
			return "", nil, err
		}
		if err := os.Chmod(path, 0755); err != nil {
			return "", nil, err
		}
	}
	if err := os.Chmod(filepath.Join(root, "tmp"), os.ModeSticky|0777); err != nil {
		return "", nil, err
	}
	if err := os.Chown(filepath.Join(root, "home/monkey"), 1000, 1000); err != nil {
		return "", nil, err
	}
	for name, value := range map[string]string{"passwd": "root:x:0:0:root:/root:/bin/sh\nmonkey:x:1000:1000:monkey:/home/monkey:/bin/sh\n", "group": "root:x:0:\nmonkey:x:1000:\n"} {
		path := filepath.Join(root, "etc", name)
		if err := os.WriteFile(path, []byte(value), 0644); err != nil {
			return "", nil, err
		}
		if err := os.Chmod(path, 0644); err != nil {
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
	null := filepath.Join(root, "dev/null")
	placeholder, err := os.OpenFile(null, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return "", nil, err
	}
	if err := placeholder.Close(); err != nil {
		return "", nil, err
	}
	// /run通常带nodev，不能在临时根目录mknod后使用设备。
	if err := unix.Mount("/dev/null", null, "", unix.MS_BIND, ""); err != nil {
		return "", nil, fmt.Errorf("临时根目录null设备绑定失败: %w", err)
	}
	mounts = append(mounts, null)
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
	if err := errors.Join(copyErr, out.Chmod(0755), out.Sync(), out.Close()); err != nil {
		return "", nil, err
	}
	cmd := exec.CommandContext(ctx, "/bin/sh", "-c", "umask 022; exec /payload/runtime setup --install-only --run-as monkey --json")
	cmd.SysProcAttr = &syscall.SysProcAttr{Chroot: root, Pdeathsig: syscall.SIGKILL}
	cmd.Dir = "/"
	cmd.Env = []string{"PATH=/bin:/usr/bin:/sbin:/usr/sbin", "HOME=/root", "USER=root", "LANG=C.UTF-8"}
	var output boundedArtifact
	cmd.Stdout, cmd.Stderr = &output, &output
	if err := cmd.Run(); err != nil {
		detail := strings.TrimSpace(string(output.data))
		if len(detail) > 4096 {
			detail = strings.ToValidUTF8(detail[len(detail)-4096:], "")
		}
		return "", nil, fmt.Errorf("虚拟机内临时根目录无法释放runtime资源: %w: %s", err, detail)
	}
	complete = true
	return filepath.Join(root, "opt/monkeyai-runtime/versions", version+"-"+digest[:12], "ohmyagent"), dispose, nil
}
