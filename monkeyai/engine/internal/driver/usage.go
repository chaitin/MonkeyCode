package driver

import (
	"context"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/lifecycle"
)

type cpuStats struct {
	Usage struct {
		Total uint64 `json:"total_usage"`
	} `json:"cpu_usage"`
	System uint64 `json:"system_cpu_usage"`
	Online uint64 `json:"online_cpus"`
}

type containerStats struct {
	Read        time.Time `json:"read"`
	CPU         cpuStats  `json:"cpu_stats"`
	PreviousCPU cpuStats  `json:"precpu_stats"`
	Memory      *struct {
		Usage uint64            `json:"usage"`
		Stats map[string]uint64 `json:"stats"`
	} `json:"memory_stats"`
}

func (s containerStats) usage() *lifecycle.Usage {
	if s.Read.IsZero() {
		return nil
	}
	u := &lifecycle.Usage{At: s.Read}
	if s.PreviousCPU.System > 0 && s.CPU.System > s.PreviousCPU.System && s.CPU.Usage.Total >= s.PreviousCPU.Usage.Total && s.CPU.Online > 0 {
		cores := float64(s.CPU.Usage.Total-s.PreviousCPU.Usage.Total) / float64(s.CPU.System-s.PreviousCPU.System) * float64(s.CPU.Online)
		u.CPUCores = &cores
	}
	if s.Memory != nil && s.Memory.Stats != nil {
		used := s.Memory.Usage
		// 与 docker stats 一致，排除可回收的 inactive file 缓存。
		cache, ok := s.Memory.Stats["total_inactive_file"]
		if !ok {
			cache = s.Memory.Stats["inactive_file"]
		}
		if cache <= used {
			used -= cache
		}
		u.MemoryBytes = &used
	}
	if u.CPUCores == nil && u.MemoryBytes == nil {
		return nil
	}
	return u
}

func (d *Driver) Usage(ctx context.Context, s lifecycle.Spec, ref string) (*lifecycle.Usage, error) {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	c, err := d.load(ctx, s, ref)
	if err != nil || !c.State.Running {
		return nil, err
	}
	var stats containerStats
	// 非流式接口由 Docker 提供前后两次 CPU 采样，不运行额外监控进程。
	if err := d.client.Do(ctx, "GET", "/containers/"+c.ID+"/stats?stream=false", nil, &stats); err != nil {
		return nil, err
	}
	return stats.usage(), nil
}
