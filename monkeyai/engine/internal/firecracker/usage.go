package firecracker

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type Sample struct {
	BootID  string    `json:"boot_id"`
	At      time.Time `json:"at"`
	CPUUsec uint64    `json:"cpu_usec"`
	Memory  uint64    `json:"memory"`
}

func (h *SystemHost) Sample(ctx context.Context, id string) (Sample, error) {
	record, err := h.load(id)
	if err != nil {
		return Sample{}, err
	}
	props, err := h.status(ctx, record)
	if err != nil {
		return Sample{}, err
	}
	group := "/system.slice/" + h.unit(id)
	if props["ActiveState"] != "active" || props["ControlGroup"] != group {
		return Sample{}, errors.New("无法核验资源指标所属的运行实例")
	}
	path := "/sys/fs/cgroup" + group
	memory, err := os.ReadFile(filepath.Join(path, "memory.current"))
	if err != nil {
		return Sample{}, err
	}
	used, err := strconv.ParseUint(strings.TrimSpace(string(memory)), 10, 64)
	if err != nil {
		return Sample{}, errors.New("虚拟机内存指标无效")
	}
	cpu, err := os.ReadFile(filepath.Join(path, "cpu.stat"))
	if err != nil {
		return Sample{}, err
	}
	cumulative, err := parseCPU(string(cpu))
	if err != nil {
		return Sample{}, err
	}
	return Sample{BootID: record.BootID, At: time.Now().UTC(), CPUUsec: cumulative, Memory: used}, nil
}
func parseCPU(raw string) (uint64, error) {
	found := false
	var used uint64
	for _, line := range strings.Split(raw, "\n") {
		fields := strings.Fields(line)
		if len(fields) == 0 || fields[0] != "usage_usec" {
			continue
		}
		if found || len(fields) != 2 {
			return 0, errors.New("虚拟机CPU指标重复或格式无效")
		}
		value, err := strconv.ParseUint(fields[1], 10, 64)
		if err != nil {
			return 0, errors.New("虚拟机CPU计数无效")
		}
		used = value
		found = true
	}
	if !found {
		return 0, errors.New("虚拟机CPU指标缺失")
	}
	return used, nil
}
