package preflight

import (
	"strconv"
	"strings"
)

type System struct {
	Network       *Network `json:"network,omitempty"`
	DiskIO        *DiskIO  `json:"disk_io,omitempty"`
	throughput    throughput
	PrivateIPs    []string `json:"private_ips,omitempty"`
	PublicIPs     []string `json:"public_ips,omitempty"`
	Hostname      string   `json:"hostname"`
	OSName        string   `json:"os_name"`
	KernelVersion string   `json:"kernel_version"`
	CPU           *CPU     `json:"cpu,omitempty"`
	Memory        *Memory  `json:"memory,omitempty"`
	Disk          *Disk    `json:"disk,omitempty"`
}

type CPU struct {
	Model        string   `json:"model"`
	LogicalCores int      `json:"logical_cores"`
	UsagePercent *float64 `json:"usage_percent,omitempty"`
}

type Memory struct {
	TotalBytes     uint64 `json:"total_bytes"`
	UsedBytes      uint64 `json:"used_bytes"`
	AvailableBytes uint64 `json:"available_bytes"`
}

type Disk struct {
	Path           string `json:"path"`
	TotalBytes     uint64 `json:"total_bytes"`
	UsedBytes      uint64 `json:"used_bytes"`
	AvailableBytes uint64 `json:"available_bytes"`
}

type cpuTimes struct{ total, idle uint64 }

func cpuUsage(previous, current cpuTimes) *float64 {
	if previous.total == 0 || current.total <= previous.total || current.idle < previous.idle {
		return nil
	}
	total, idle := current.total-previous.total, current.idle-previous.idle
	if idle > total {
		return nil
	}
	return new(float64(total-idle) * 100 / float64(total))
}

func parseCPU(data string) (cpuTimes, int) {
	var result cpuTimes
	cores := 0
	for line := range strings.SplitSeq(data, "\n") {
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		if strings.HasPrefix(fields[0], "cpu") && fields[0] != "cpu" {
			if _, err := strconv.ParseUint(strings.TrimPrefix(fields[0], "cpu"), 10, 32); err == nil {
				cores++
			}
		}
		if fields[0] != "cpu" || len(fields) < 5 {
			continue
		}
		// guest 与 guest_nice 已包含在 user 和 nice 中，不重复计入。
		for index, value := range fields[1:min(len(fields), 9)] {
			n, err := strconv.ParseUint(value, 10, 64)
			if err != nil || n > ^uint64(0)-result.total {
				return cpuTimes{}, 0
			}
			result.total += n
			if index == 3 || index == 4 {
				result.idle += n
			}
		}
	}
	return result, cores
}

func parseMemory(data string) *Memory {
	values := make(map[string]uint64)
	for line := range strings.SplitSeq(data, "\n") {
		fields := strings.Fields(line)
		if len(fields) != 3 || fields[2] != "kB" || (fields[0] != "MemTotal:" && fields[0] != "MemAvailable:") {
			continue
		}
		n, err := strconv.ParseUint(fields[1], 10, 64)
		if err != nil || n > ^uint64(0)/1024 {
			return nil
		}
		values[fields[0]] = n * 1024
	}
	total := values["MemTotal:"]
	available, ok := values["MemAvailable:"]
	if !ok || total == 0 || available > total {
		return nil
	}
	return &Memory{TotalBytes: total, UsedBytes: total - available, AvailableBytes: available}
}

func cpuModel(data string) string {
	for _, key := range []string{"model name", "Processor", "Hardware"} {
		for line := range strings.SplitSeq(data, "\n") {
			name, value, ok := strings.Cut(line, ":")
			if ok && strings.TrimSpace(name) == key {
				return strings.TrimSpace(value)
			}
		}
	}
	return ""
}

func osName(data string) string {
	values := make(map[string]string)
	for line := range strings.SplitSeq(data, "\n") {
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		value = strings.TrimSpace(value)
		if unquoted, err := strconv.Unquote(value); err == nil {
			value = unquoted
		} else {
			value = strings.Trim(value, "\"'")
		}
		values[strings.TrimSpace(key)] = value
	}
	if name, version := values["NAME"], values["VERSION_ID"]; name != "" && version != "" {
		if values["ID"] == "centos" && name == "CentOS Linux" {
			name = "CentOS"
		}
		return name + " " + version
	}
	return values["PRETTY_NAME"]
}
