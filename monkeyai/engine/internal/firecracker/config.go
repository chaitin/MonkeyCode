package firecracker

import (
	"errors"
	"net"
	"path/filepath"
	"regexp"
	"strings"
)

var identifier = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$`)

type Machine struct {
	VCPUCount int   `json:"vcpu_count"`
	MemoryMiB int64 `json:"mem_size_mib"`
	SMT       bool  `json:"smt"`
}
type Boot struct {
	Kernel string `json:"kernel_image_path"`
	Args   string `json:"boot_args"`
}
type Bucket struct {
	Size     uint64 `json:"size"`
	RefillMS uint64 `json:"refill_time"`
}
type Rate struct {
	Bandwidth  Bucket `json:"bandwidth"`
	Operations Bucket `json:"ops"`
}
type Drive struct {
	ID       string `json:"drive_id"`
	Path     string `json:"path_on_host"`
	Root     bool   `json:"is_root_device"`
	ReadOnly bool   `json:"is_read_only"`
	Cache    string `json:"cache_type"`
	IOEngine string `json:"io_engine"`
	Rate     Rate   `json:"rate_limiter"`
}
type Vsock struct {
	ID   string `json:"vsock_id"`
	CID  uint32 `json:"guest_cid"`
	Path string `json:"uds_path"`
}
type Network struct {
	ID  string `json:"iface_id"`
	TAP string `json:"host_dev_name"`
	MAC string `json:"guest_mac"`
	RX  Rate   `json:"rx_rate_limiter"`
	TX  Rate   `json:"tx_rate_limiter"`
}
type Config struct {
	ID      string
	Machine Machine
	Boot    Boot
	Disk    Drive
	Vsock   Vsock
	Network *Network
}

func validPath(path string) bool {
	return filepath.IsAbs(path) && filepath.Clean(path) == path && !strings.ContainsAny(path, "\x00\r\n")
}
func (r Rate) Validate() error {
	for _, b := range []Bucket{r.Bandwidth, r.Operations} {
		if b.Size == 0 || b.RefillMS == 0 || b.RefillMS > 60000 {
			return errors.New("必须配置有界的 I/O 和带宽限速")
		}
	}
	return nil
}
func (c Config) Validate() error {
	if !identifier.MatchString(c.ID) {
		return errors.New("虚拟机实例标识无效")
	}
	if c.Machine.VCPUCount < 1 || c.Machine.VCPUCount > 32 || c.Machine.MemoryMiB < 256 || c.Machine.MemoryMiB > 1048576 || c.Machine.SMT {
		return errors.New("虚拟机 CPU、内存或 SMT 配置无效")
	}
	if !validPath(c.Boot.Kernel) || len(c.Boot.Args) > 2048 || c.Boot.Args == "" || strings.ContainsAny(c.Boot.Args, "\x00\r\n") {
		return errors.New("虚拟机启动配置无效")
	}
	if c.Disk.ID != "root" || !c.Disk.Root {
		return errors.New("虚拟磁盘绑定无效")
	}
	if !validPath(c.Disk.Path) || c.Disk.ReadOnly || c.Disk.Cache != "Writeback" || c.Disk.IOEngine != "Sync" {
		return errors.New("持久盘必须可写并支持flush，使用Sync IO")
	}
	if err := c.Disk.Rate.Validate(); err != nil {
		return err
	}
	if c.Vsock.ID != "management" || c.Vsock.CID < 3 || c.Vsock.CID == ^uint32(0) || !validPath(c.Vsock.Path) {
		return errors.New("虚拟机管理通道配置无效")
	}
	if c.Network != nil {
		n := c.Network
		mac, err := net.ParseMAC(n.MAC)
		if n.ID != "eth0" || !identifier.MatchString(n.TAP) || len(n.TAP) > 15 || err != nil || len(mac) != 6 || mac[0]&1 != 0 {
			return errors.New("虚拟机网络配置无效")
		}
		if err := n.RX.Validate(); err != nil {
			return err
		}
		if err := n.TX.Validate(); err != nil {
			return err
		}
	}
	return nil
}
