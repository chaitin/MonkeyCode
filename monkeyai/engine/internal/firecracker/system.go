package firecracker

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/control"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/guest"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/storage"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/vmimage"
)

type NetworkLease struct {
	Namespace string  `json:"namespace"`
	Interface Network `json:"interface"`
	BootArgs  string  `json:"boot_args"`
	UID       uint32  `json:"uid"`
}
type Networking interface {
	Prepare(context.Context, string) (NetworkLease, error)
	Verify(context.Context, string, NetworkLease) error
	Remove(context.Context, string, NetworkLease) error
}
type Artifact struct {
	Path   string `json:"path"`
	Digest string `json:"digest"`
}

func (a Artifact) Verify(ctx context.Context) error { return a.verify(ctx) }

func (a Artifact) verify(ctx context.Context) error {
	if !validPath(a.Path) || len(a.Digest) != 71 || !strings.HasPrefix(a.Digest, "sha256:") {
		return errors.New("内核资源身份无效")
	}
	info, err := os.Lstat(a.Path)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > 512<<20 || info.Mode().Perm()&0022 != 0 {
		return errors.New("内核资源类型、大小或权限无效")
	}
	f, err := os.Open(a.Path)
	if err != nil {
		return err
	}
	defer f.Close()
	h := sha256.New()
	buf := make([]byte, 128<<10)
	var total int64
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		n, err := f.Read(buf)
		total += int64(n)
		if total > info.Size() {
			return errors.New("资源长度发生变化")
		}
		if n > 0 {
			h.Write(buf[:n])
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
	}
	if total != info.Size() || "sha256:"+hex.EncodeToString(h.Sum(nil)) != a.Digest {
		return errors.New("资源摘要不匹配")
	}
	return nil
}

type HostConfig struct {
	Root        string
	SocketRoot  string
	Firecracker vmimage.Tool
	Jailer      vmimage.Tool
	Kernel      Artifact
	OverheadMiB int64
	DiskRate    Rate
	Network     Networking
}
type SystemHost struct {
	config  HostConfig
	command func(context.Context, string, ...string) ([]byte, error)
}
type hostRecord struct {
	ID      string        `json:"id"`
	BootID  string        `json:"boot_id"`
	Network NetworkLease  `json:"network"`
	Binding guest.Binding `json:"binding"`
}

func NewSystemHost(c HostConfig) (*SystemHost, error) {
	if !validPath(c.Root) || c.Root == "/" || !validPath(c.SocketRoot) || c.SocketRoot == "/" || len(c.SocketRoot) > 40 || filepath.Base(c.Firecracker.Path) != "firecracker" || c.OverheadMiB < 64 || c.OverheadMiB > 4096 || c.Network == nil {
		return nil, errors.New("宿主执行配置不完整")
	}
	if err := c.DiskRate.Validate(); err != nil {
		return nil, err
	}
	if err := storage.PrivateDir(c.SocketRoot); err != nil {
		return nil, err
	}
	if err := storage.PrivateDir(c.Root); err != nil {
		return nil, err
	}
	if err := storage.PrivateDir(filepath.Join(c.Root, "records")); err != nil {
		return nil, err
	}
	return &SystemHost{config: c, command: hostCommand}, nil
}
func hostCommand(ctx context.Context, name string, args ...string) ([]byte, error) {
	command := exec.CommandContext(ctx, name, args...)
	command.Env = []string{"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "LC_ALL=C"}
	var out boundedOutput
	command.Stdout = &out
	command.Stderr = io.Discard
	err := command.Run()
	if err != nil {
		return nil, fmt.Errorf("宿主命令 %s 失败: %w", filepath.Base(name), err)
	}
	if out.exceeded {
		return nil, errors.New("宿主命令输出超限")
	}
	return out.data, nil
}

type boundedOutput struct {
	data     []byte
	exceeded bool
}

func (b *boundedOutput) Write(p []byte) (int, error) {
	n := len(p)
	left := (64 << 10) - len(b.data)
	if len(p) > left {
		b.exceeded = true
		p = p[:left]
	}
	b.data = append(b.data, p...)
	return n, nil
}
func (h *SystemHost) recordPath(id string) string {
	return filepath.Join(h.config.Root, "records", id+".json")
}
func (h *SystemHost) jail(id string) string {
	return filepath.Join(h.config.Root, "jailer", "firecracker", id, "root")
}
func (h *SystemHost) socketDir(id string) string { return filepath.Join(h.config.SocketRoot, id[:16]) }
func (h *SystemHost) socket(id string) string {
	return filepath.Join(h.socketDir(id), "firecracker.socket")
}
func (h *SystemHost) unit(id string) string { return "monkeyai-fc-" + id + ".service" }
func (h *SystemHost) load(id string) (hostRecord, error) {
	if len(id) != 64 {
		return hostRecord{}, errors.New("宿主虚拟机ID无效")
	}
	if _, err := hex.DecodeString(id); err != nil {
		return hostRecord{}, err
	}
	path := h.recordPath(id)
	info, err := os.Lstat(path)
	if err != nil {
		return hostRecord{}, err
	}
	if !info.Mode().IsRegular() || info.Size() > 64<<10 || info.Mode().Perm()&0077 != 0 {
		return hostRecord{}, errors.New("宿主实例记录不安全")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return hostRecord{}, err
	}
	var record hostRecord
	if json.Unmarshal(raw, &record) != nil || record.ID != id || record.Binding.BootID != record.BootID || record.Binding.Validate() != nil || record.Network.UID < 100000 {
		return hostRecord{}, errors.New("宿主实例记录损坏")
	}
	return record, nil
}
func (h *SystemHost) status(ctx context.Context, record hostRecord) (map[string]string, error) {
	out, err := h.command(ctx, "systemctl", "show", h.unit(record.ID), "--property=LoadState,ActiveState,SubState,Description,MainPID,ControlGroup")
	if err != nil {
		return nil, err
	}
	props := map[string]string{}
	for _, line := range strings.Split(string(out), "\n") {
		key, value, ok := strings.Cut(line, "=")
		if ok {
			props[key] = value
		}
	}
	if props["LoadState"] == "not-found" {
		return props, nil
	}
	if props["LoadState"] != "loaded" || props["Description"] != "MonkeyAI Firecracker "+record.BootID {
		return nil, errors.New("拒绝操作归属不符的systemd实例")
	}
	return props, nil
}
func (h *SystemHost) Running(ctx context.Context, id string) (bool, error) {
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
	switch props["ActiveState"] {
	case "inactive", "failed":
		if props["MainPID"] != "0" {
			return false, errors.New("已退出服务仍有主进程")
		}
		return false, h.emptyCgroup(props["ControlGroup"])
	case "active":
		client, err := NewClient(h.socket(id))
		if err != nil {
			return false, err
		}
		defer client.Close()
		info, err := client.Info(ctx)
		if err != nil {
			return false, err
		}
		if info.ID != id {
			return false, errors.New("Firecracker API实例身份不符")
		}
		return info.State == "Running" || info.State == "Paused", nil
	default:
		return false, errors.New("虚拟机服务仍在启动或退出中")
	}
}
func (h *SystemHost) emptyCgroup(group string) error {
	if group == "" {
		return nil
	}
	if !strings.HasPrefix(group, "/system.slice/monkeyai-fc-") || filepath.Clean(group) != group {
		return errors.New("虚拟机cgroup归属异常")
	}
	path := "/sys/fs/cgroup" + group
	info, err := os.Stat(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return errors.New("cgroup不是目录")
	}
	return filepath.WalkDir(path, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.Name() != "cgroup.procs" {
			return nil
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if strings.TrimSpace(string(raw)) != "" {
			return errors.New("虚拟机cgroup仍有辅助进程")
		}
		return nil
	})
}
func (h *SystemHost) Start(ctx context.Context, l Launch) (result error) {
	if l.ID != storage.Key(l.Binding.EnvironmentID) || l.Binding.BootID != l.BootID || l.Binding.InstanceID != l.Disks.Spec.InstanceID || l.Disks.Lease == "" {
		return errors.New("启动身份与磁盘占用不匹配")
	}
	if l.CPUMillis < 0 || l.CPUMillis > int64(l.VCPUs)*1000 || l.CPUMillis > 32000 {
		return errors.New("虚拟机CPU配额无效")
	}
	if err := l.Binding.Validate(); err != nil {
		return err
	}
	for _, tool := range []vmimage.Tool{h.config.Firecracker, h.config.Jailer} {
		if err := tool.Verify(ctx); err != nil {
			return err
		}
	}
	if err := h.config.Kernel.verify(ctx); err != nil {
		return err
	}
	if existing, err := h.load(l.ID); err == nil {
		props, err := h.status(ctx, existing)
		if err != nil {
			return err
		}
		if props["LoadState"] != "not-found" && props["ActiveState"] != "inactive" && props["ActiveState"] != "failed" {
			return errors.New("不能覆盖仍活跃的虚拟机服务")
		}
		if err := h.emptyCgroup(props["ControlGroup"]); err != nil {
			return err
		}
		if err := h.Remove(ctx, l.ID); err != nil {
			return err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	lease, err := h.config.Network.Prepare(ctx, l.ID)
	if err != nil {
		return err
	}
	if lease.UID < 100000 || !validPath(lease.Namespace) || len(lease.BootArgs) > 512 || strings.ContainsAny(lease.BootArgs, "\r\n\x00") {
		return errors.New("隔离网络返回了无效参数")
	}
	record := hostRecord{ID: l.ID, BootID: l.BootID, Network: lease, Binding: l.Binding}
	raw, _ := json.Marshal(record)
	if err := control.Write(h.recordPath(l.ID), raw, 0600); err != nil {
		return err
	}
	if err := h.config.Network.Verify(ctx, l.ID, lease); err != nil {
		return err
	}
	root := h.jail(l.ID)
	for _, dir := range []string{root, filepath.Join(root, "run")} {
		if err := storage.PrivateDir(dir); err != nil {
			return err
		}
	}
	// 目录仅授予对应VMM用户；磁盘硬链接只指向该环境的独立盘，不链接模板。
	if err := os.Chown(root, int(lease.UID), int(lease.UID)); err != nil {
		return err
	}
	if err := os.Chown(filepath.Join(root, "run"), int(lease.UID), int(lease.UID)); err != nil {
		return err
	}
	for _, disk := range []struct{ source, name string }{{l.Disks.System, "system.ext4"}, {l.Disks.Data, "data.ext4"}} {
		info, err := os.Lstat(disk.source)
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return errors.New("磁盘不是普通文件")
		}
		if err := os.Link(disk.source, filepath.Join(root, disk.name)); err != nil {
			return err
		}
		if err := os.Chown(filepath.Join(root, disk.name), int(lease.UID), int(lease.UID)); err != nil {
			return err
		}
	}
	if err := os.Symlink(filepath.Join(root, "run"), h.socketDir(l.ID)); err != nil {
		return err
	}
	if err := copyKernel(ctx, h.config.Kernel.Path, filepath.Join(root, "kernel")); err != nil {
		return err
	}
	init := "/sbin/init"
	extra := ""
	if l.Maintenance {
		extra = "monkeyai.maintenance=1 systemd.unit=monkeyai-maintenance.target "
	}
	if l.SelfTest {
		init = "/monkeyai-selftest"
		extra = "monkeyai.selftest=1 "
	}
	console := "console=ttyS0 "
	if runtime.GOARCH == "arm64" {
		console = "console=ttyAMA0 keep_bootcon "
	}
	args := console + "reboot=k panic=1 pci=off root=/dev/vda rw rootfstype=ext4 init=" + init + " " + extra + lease.BootArgs + " monkeyai.guest=1 monkeyai.environment=" + l.Binding.EnvironmentID + " monkeyai.instance=" + l.Binding.InstanceID + " monkeyai.boot=" + l.BootID
	config := Config{ID: l.ID, Machine: Machine{VCPUCount: l.VCPUs, MemoryMiB: l.MemoryMiB}, Boot: Boot{Kernel: "/kernel", Args: args}, System: Drive{ID: "system", Path: "/system.ext4", Root: true, Cache: "Writeback", IOEngine: "Sync", Rate: h.config.DiskRate}, Data: Drive{ID: "data", Path: "/data.ext4", Cache: "Writeback", IOEngine: "Sync", Rate: h.config.DiskRate}, Vsock: Vsock{ID: "management", CID: 3, Path: "/run/guest.sock"}, Network: &lease.Interface}
	if err := config.Validate(); err != nil {
		return err
	}
	if len(h.socket(l.ID)) > 100 {
		return errors.New("jailer数据路径超过Unix socket长度限制")
	}
	command := []string{"--unit=" + h.unit(l.ID), "--description=MonkeyAI Firecracker " + l.BootID, "--service-type=exec", "--property=Restart=no", "--property=KillMode=control-group", "--property=TimeoutStopSec=25s", "--property=MemoryMax=" + strconv.FormatInt(l.MemoryMiB+h.config.OverheadMiB, 10) + "M", "--property=MemorySwapMax=0", "--property=CPUQuota=" + cpuQuota(l), "--property=TasksMax=512", "--property=LimitNOFILE=4096", "--property=StandardOutput=null", "--property=StandardError=null", "--", h.config.Jailer.Path, "--id", l.ID, "--exec-file", h.config.Firecracker.Path, "--uid", strconv.FormatUint(uint64(lease.UID), 10), "--gid", strconv.FormatUint(uint64(lease.UID), 10), "--chroot-base-dir", filepath.Join(h.config.Root, "jailer"), "--netns", lease.Namespace, "--", "--api-sock", "/run/firecracker.socket", "--id", l.ID}
	if _, err := h.command(ctx, "systemd-run", command...); err != nil {
		return err
	}
	client, err := NewClient(h.socket(l.ID))
	if err != nil {
		return err
	}
	defer client.Close()
	ready, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	for {
		if _, err := client.Info(ready); err == nil {
			break
		}
		select {
		case <-ready.Done():
			return errors.New("Firecracker API启动超时")
		case <-time.After(50 * time.Millisecond):
		}
	}
	if err := client.Configure(ctx, config); err != nil {
		return err
	}
	return client.Start(ctx, l.ID)
}
func copyKernel(ctx context.Context, source, target string) error {
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0444)
	if err != nil {
		return err
	}
	var result error
	buf := make([]byte, 128<<10)
	for {
		if err := ctx.Err(); err != nil {
			result = err
			break
		}
		n, err := in.Read(buf)
		if n > 0 {
			if _, e := out.Write(buf[:n]); e != nil {
				result = e
				break
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			result = err
			break
		}
	}
	return errors.Join(result, out.Sync(), out.Close())
}
func cpuQuota(l Launch) string {
	if l.CPUMillis > 0 {
		return fmt.Sprintf("%d.%d%%", l.CPUMillis/10, l.CPUMillis%10)
	}
	return strconv.Itoa(l.VCPUs*100) + "%"
}

func (h *SystemHost) GuestClient(id string) (*guest.Client, error) {
	record, err := h.load(id)
	if err != nil {
		return nil, err
	}
	return guest.NewClient(record.Binding, guest.Dial(filepath.Join(h.socketDir(id), "guest.sock"), guest.Port))
}

func (h *SystemHost) Pause(ctx context.Context, id string) error {
	record, err := h.load(id)
	if err != nil {
		return err
	}
	if _, err := h.status(ctx, record); err != nil {
		return err
	}
	client, err := NewClient(h.socket(id))
	if err != nil {
		return err
	}
	defer client.Close()
	return client.Pause(ctx, id)
}
func (h *SystemHost) Stop(ctx context.Context, id string) error {
	record, err := h.load(id)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	props, err := h.status(ctx, record)
	if err != nil {
		return err
	}
	if props["LoadState"] == "not-found" {
		return nil
	}
	if props["ActiveState"] == "active" {
		client, err := guest.NewClient(record.Binding, guest.Dial(filepath.Join(h.socketDir(id), "guest.sock"), guest.Port))
		if err == nil {
			grace, cancel := context.WithTimeout(ctx, 10*time.Second)
			_ = client.Shutdown(grace)
			cancel()
			client.Close()
		}
	}
	if _, err := h.command(ctx, "systemctl", "stop", h.unit(id)); err != nil {
		return err
	}
	props, err = h.status(ctx, record)
	if err != nil {
		return err
	}
	if props["LoadState"] != "not-found" && (props["MainPID"] != "0" || props["ActiveState"] != "inactive" && props["ActiveState"] != "failed") {
		return errors.New("虚拟机仍未确认退出")
	}
	return h.emptyCgroup(props["ControlGroup"])
}
func (h *SystemHost) Remove(ctx context.Context, id string) error {
	record, err := h.load(id)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	running, err := h.Running(ctx, id)
	if err != nil {
		return err
	}
	if running {
		return errors.New("运行中的虚拟机不能删除")
	}
	if err := h.config.Network.Remove(ctx, id, record.Network); err != nil {
		return err
	}
	// unlink jailer对环境盘的引用，保留vmdisk目录中的原盘。
	if err := os.RemoveAll(filepath.Dir(h.jail(id))); err != nil {
		return err
	}
	if target, err := os.Readlink(h.socketDir(id)); err == nil {
		if target != filepath.Join(h.jail(id), "run") {
			return errors.New("socket别名归属异常")
		}
		if err := os.Remove(h.socketDir(id)); err != nil {
			return err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return os.Remove(h.recordPath(id))
}
