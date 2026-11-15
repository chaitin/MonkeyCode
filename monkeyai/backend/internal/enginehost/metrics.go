package enginehost

import (
	"math"
	"net/netip"
	"strings"
)

type networkReportRates struct {
	ReceiveBytesPerSecond  float64 `json:"receive_bytes_per_second"`
	TransmitBytesPerSecond float64 `json:"transmit_bytes_per_second"`
}

type diskReportRates struct {
	ReadBytesPerSecond  float64 `json:"read_bytes_per_second"`
	WriteBytesPerSecond float64 `json:"write_bytes_per_second"`
}

type systemReport struct {
	Network       *networkReportRates `json:"network,omitempty"`
	DiskIO        *diskReportRates    `json:"disk_io,omitempty"`
	PrivateIPs    []string            `json:"private_ips,omitempty"`
	PublicIPs     []string            `json:"public_ips,omitempty"`
	Hostname      string              `json:"hostname"`
	OSName        string              `json:"os_name"`
	KernelVersion string              `json:"kernel_version"`
	CPU           *cpuReport          `json:"cpu"`
	Memory        *memoryReport       `json:"memory"`
	Disk          *diskReport         `json:"disk"`
}

type cpuReport struct {
	Model        string   `json:"model"`
	LogicalCores int      `json:"logical_cores"`
	UsagePercent *float64 `json:"usage_percent"`
}

type memoryReport struct {
	TotalBytes     uint64 `json:"total_bytes"`
	UsedBytes      uint64 `json:"used_bytes"`
	AvailableBytes uint64 `json:"available_bytes"`
}

type diskReport struct {
	Path string `json:"path"`
	memoryReport
}

func validSystem(s *systemReport) bool {
	if s == nil {
		return true
	}
	for _, group := range []struct {
		ips     []string
		private bool
	}{{s.PrivateIPs, true}, {s.PublicIPs, false}} {
		if len(group.ips) > 64 {
			return false
		}
		for _, value := range group.ips {
			ip, err := netip.ParseAddr(value)
			if err != nil || ip.Zone() != "" || !ip.IsGlobalUnicast() || ip.IsLoopback() || privateIP(ip.Unmap()) != group.private {
				return false
			}
		}
	}
	validRate := func(v float64) bool { return v >= 0 && !math.IsNaN(v) && !math.IsInf(v, 0) }
	if s.Network != nil && (!validRate(s.Network.ReceiveBytesPerSecond) || !validRate(s.Network.TransmitBytesPerSecond)) {
		return false
	}
	if s.DiskIO != nil && (!validRate(s.DiskIO.ReadBytesPerSecond) || !validRate(s.DiskIO.WriteBytesPerSecond)) {
		return false
	}
	text := func(value string, limit int) bool {
		return len(value) <= limit && !strings.ContainsAny(value, "\x00\r\n")
	}
	if !text(s.Hostname, 255) || !text(s.OSName, 256) || !text(s.KernelVersion, 256) {
		return false
	}
	if cpu := s.CPU; cpu != nil {
		if !text(cpu.Model, 512) || cpu.LogicalCores < 1 || cpu.LogicalCores > 1<<20 {
			return false
		}
		if cpu.UsagePercent != nil && (math.IsNaN(*cpu.UsagePercent) || math.IsInf(*cpu.UsagePercent, 0) || *cpu.UsagePercent < 0 || *cpu.UsagePercent > 100) {
			return false
		}
	}
	validMemory := func(m *memoryReport) bool {
		return m == nil || (m.TotalBytes > 0 && m.UsedBytes <= m.TotalBytes && m.AvailableBytes <= m.TotalBytes-m.UsedBytes)
	}
	if !validMemory(s.Memory) {
		return false
	}
	return s.Disk == nil || (text(s.Disk.Path, 4096) && strings.HasPrefix(s.Disk.Path, "/") && validMemory(&s.Disk.memoryReport))
}
