package vmhost

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/netip"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/control"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/firecracker"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/guest"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/storage"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/vmdisk"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/vmimage"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/vmnet"
)

type Config struct {
	DiskBytes     int64  `json:"disk_bytes"`
	DefaultBundle string `json:"default_bundle"`

	Bundles         map[string]string     `json:"bundles"`
	GuestPool       string                `json:"guest_pool"`
	LinkPool        string                `json:"link_pool"`
	DNS             []string              `json:"dns"`
	Exceptions      []Exception           `json:"exceptions"`
	LogicalLimit    int64                 `json:"logical_limit"`
	Policy          vmdisk.PressurePolicy `json:"pressure_policy"`
	DiskRate        firecracker.Rate      `json:"disk_rate"`
	NetworkRate     firecracker.Rate      `json:"network_rate"`
	OverheadMiB     int64                 `json:"overhead_mib"`
	ConversionBytes int64                 `json:"conversion_bytes"`
	ConversionFiles int64                 `json:"conversion_files"`
}
type Exception struct {
	IP   string `json:"ip"`
	Port uint16 `json:"port"`
}
type release struct {
	Version int               `json:"version"`
	Files   map[string]string `json:"files"`
}
type Driver struct {
	config      Config
	data, state string
	client      *control.Client
	hostID      string
}

func New(data, state string, raw json.RawMessage, client *control.Client, hostID string) (*Driver, error) {
	if runtime.GOOS != "linux" || os.Geteuid() != 0 {
		return nil, errors.New("Firecracker环境需要Linux root")
	}
	if !filepath.IsAbs(data) || filepath.Clean(data) != data || data == "/" || !filepath.IsAbs(state) || filepath.Clean(state) != state || state == "/" || client == nil || hostID == "" {
		return nil, errors.New("Firecracker执行配置无效")
	}
	var config Config
	if json.Unmarshal(raw, &config) != nil || len(config.Bundles) == 0 || config.LogicalLimit <= 0 || config.ConversionBytes <= 0 || config.ConversionBytes > 16<<40 || config.ConversionFiles <= 0 || config.ConversionFiles > 10000000 || config.OverheadMiB < 64 || config.OverheadMiB > 4096 {
		return nil, errors.New("缺少固定组件、存储池或转换资源配置")
	}
	defaults := lifecycle.VirtualMachine{Architecture: runtime.GOARCH, BundleSHA256: config.DefaultBundle, DiskBytes: config.DiskBytes}
	if err := defaults.Validate(); err != nil {
		return nil, err
	}
	if err := config.Policy.Validate(); err != nil {
		return nil, err
	}
	if err := config.DiskRate.Validate(); err != nil {
		return nil, err
	}
	if err := config.NetworkRate.Validate(); err != nil {
		return nil, err
	}
	for _, p := range []string{data, state} {
		if err := storage.PrivateDir(p); err != nil {
			return nil, err
		}
		info, err := os.Stat(p)
		if err != nil {
			return nil, err
		}
		stat, ok := info.Sys().(*syscall.Stat_t)
		if !ok || stat.Uid != 0 {
			return nil, errors.New("虚拟机管理目录必须由root持有")
		}
	}
	driver := &Driver{config: config, data: data, state: state, client: client, hostID: hostID}
	if _, err := driver.network("public-only"); err != nil {
		return nil, err
	}
	return driver, nil
}
func (d *Driver) Close() error { return nil }
func (d *Driver) components(s lifecycle.Spec) (string, release, error) {
	if err := s.Validate(); err != nil {
		return "", release{}, err
	}
	if s.Driver != "firecracker" || s.VirtualMachine == nil || s.VirtualMachine.Architecture != runtime.GOARCH {
		return "", release{}, errors.New("虚拟机驱动或架构不匹配")
	}
	dir := d.config.Bundles[s.VirtualMachine.BundleSHA256]
	if !filepath.IsAbs(dir) || filepath.Clean(dir) != dir {
		return "", release{}, errors.New("环境固定组件版本未安装，不能自动替换为新版")
	}
	path := filepath.Join(dir, "manifest.json")
	info, err := os.Lstat(path)
	if err != nil {
		return "", release{}, err
	}
	if !info.Mode().IsRegular() || info.Size() > 16<<10 || info.Mode().Perm()&0022 != 0 {
		return "", release{}, errors.New("虚拟机组件清单类型或权限无效")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", release{}, err
	}
	hash := sha256.Sum256(raw)
	if hex.EncodeToString(hash[:]) != s.VirtualMachine.BundleSHA256 {
		return "", release{}, errors.New("虚拟机组件清单摘要变化")
	}
	var r release
	if json.Unmarshal(raw, &r) != nil || r.Version != 1 {
		return "", r, errors.New("虚拟机组件清单版本无效")
	}
	for _, name := range []string{"firecracker", "jailer", "kernel", "umoci", "mke2fs", "monkeyai-guest", "guest-bootstrap", "monkeyai-guest.service"} {
		sum := r.Files[name]
		if len(sum) != 64 || strings.Trim(sum, "0123456789abcdef") != "" {
			return "", r, errors.New("虚拟机组件摘要缺失")
		}
	}
	return dir, r, nil
}
func (d *Driver) pool() (*vmdisk.Pool, error) {
	return vmdisk.NewPool(filepath.Join(d.state, "capacity"), d.data, d.config.LogicalLimit, d.config.Policy)
}
func (d *Driver) stores(s lifecycle.Spec) (*vmdisk.Manager, *firecracker.Manager, *firecracker.SystemHost, error) {
	dir, r, err := d.components(s)
	if err != nil {
		return nil, nil, nil, err
	}
	disks, err := vmdisk.New(filepath.Join(d.data, "disks"))
	if err != nil {
		return nil, nil, nil, err
	}
	network, err := d.network(s.NetworkPolicy)
	if err != nil {
		return nil, nil, nil, err
	}
	tool := func(name string) vmimage.Tool {
		return vmimage.Tool{Path: filepath.Join(dir, name), Digest: "sha256:" + r.Files[name]}
	}
	host, err := firecracker.NewSystemHost(firecracker.HostConfig{Root: filepath.Join(d.data, "host"), SocketRoot: "/run/monkeyai-fc", Firecracker: tool("firecracker"), Jailer: tool("jailer"), Kernel: firecracker.Artifact{Path: filepath.Join(dir, "kernel"), Digest: "sha256:" + r.Files["kernel"]}, OverheadMiB: d.config.OverheadMiB, DiskRate: d.config.DiskRate, Network: network})
	if err != nil {
		return nil, nil, nil, err
	}
	manager, err := firecracker.NewManager(filepath.Join(d.state, "instances"), disks, host)
	return disks, manager, host, err
}
func (d *Driver) nativeSpec(s lifecycle.Spec, template string) firecracker.Spec {
	return firecracker.Spec{Fingerprint: fingerprint(s), Disk: vmdisk.Spec{EnvironmentID: s.EnvironmentID, InstanceID: s.InstanceID, TemplateID: template, DiskBytes: s.VirtualMachine.DiskBytes}, VCPUs: int((s.Resource.CPUMillis + 999) / 1000), CPUMillis: s.Resource.CPUMillis, MemoryMiB: s.Resource.MemoryBytes >> 20, Generation: s.Generation}
}
func (d *Driver) guest(ctx context.Context, s lifecycle.Spec) (*guest.Client, error) {
	_, manager, host, err := d.stores(s)
	if err != nil {
		return nil, err
	}
	actual, err := manager.Inspect(ctx, s.EnvironmentID)
	if err != nil {
		return nil, err
	}
	if actual.Spec.Disk.InstanceID != s.InstanceID || actual.Generation != s.Generation || actual.Phase != "running" || actual.ProtectionGeneration != 0 {
		return nil, errors.New("runtime目标与当前可运行虚拟机不匹配")
	}
	return host.GuestClient(actual.ID)
}

func (d *Driver) network(policy string) (*vmnet.Manager, error) {
	gp, err := netip.ParsePrefix(d.config.GuestPool)
	if err != nil {
		return nil, err
	}
	lp, err := netip.ParsePrefix(d.config.LinkPool)
	if err != nil {
		return nil, err
	}
	cfg := vmnet.Config{Policy: policy, Root: filepath.Join(d.state, "network"), GuestPool: gp, LinkPool: lp, Rate: d.config.NetworkRate}
	for _, raw := range d.config.DNS {
		ip, err := netip.ParseAddr(raw)
		if err != nil {
			return nil, err
		}
		cfg.DNS = append(cfg.DNS, ip)
	}
	for _, ex := range d.config.Exceptions {
		ip, err := netip.ParseAddr(ex.IP)
		if err != nil {
			return nil, err
		}
		cfg.Exceptions = append(cfg.Exceptions, vmnet.Exception{IP: ip, Port: ex.Port})
	}
	return vmnet.New(cfg)
}
