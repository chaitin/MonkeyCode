package preflight

import (
	"io"
	"os"
	"strings"

	"golang.org/x/sys/unix"
)

func systemInfo(dataDir string) (*System, cpuTimes) {
	read := func(path string) string {
		file, err := os.Open(path)
		if err != nil {
			return ""
		}
		defer file.Close()
		raw, err := io.ReadAll(io.LimitReader(file, 1<<20))
		if err != nil {
			return ""
		}
		return string(raw)
	}
	hostname, _ := os.Hostname()
	release := read("/etc/os-release")
	if release == "" {
		release = read("/usr/lib/os-release")
	}
	system := &System{
		Hostname: hostname, OSName: osName(release),
		KernelVersion: strings.TrimSpace(read("/proc/sys/kernel/osrelease")),
		Memory:        parseMemory(read("/proc/meminfo")),
	}
	system.PrivateIPs, system.PublicIPs = networkIPs()
	times, cores := parseCPU(read("/proc/stat"))
	if cores > 0 {
		system.CPU = &CPU{Model: cpuModel(read("/proc/cpuinfo")), LogicalCores: cores}
	}
	var stat unix.Statfs_t
	if err := unix.Statfs(dataDir, &stat); err == nil && stat.Bsize > 0 && stat.Blocks > 0 && stat.Bfree <= stat.Blocks && stat.Bavail <= stat.Bfree && stat.Blocks <= ^uint64(0)/uint64(stat.Bsize) {
		block := uint64(stat.Bsize)
		system.Disk = &Disk{Path: dataDir, TotalBytes: stat.Blocks * block, UsedBytes: (stat.Blocks - stat.Bfree) * block, AvailableBytes: stat.Bavail * block}
	}
	system.throughput = throughputInfo(dataDir)
	return system, times
}
