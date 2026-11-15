package environment

import "encoding/json"

// 硬件容量仅用于展示，不作为数量调度的资源准入条件。
func reportedCapacity(raw json.RawMessage) Capacity {
	var report struct {
		System struct {
			CPU struct {
				LogicalCores int64 `json:"logical_cores"`
			} `json:"cpu"`
			Memory struct {
				TotalBytes int64 `json:"total_bytes"`
			} `json:"memory"`
		} `json:"system"`
	}
	if json.Unmarshal(raw, &report) != nil || report.System.CPU.LogicalCores < 1 || report.System.CPU.LogicalCores > 1<<20 || report.System.Memory.TotalBytes < 1 {
		return Capacity{}
	}
	return Capacity{CPUMillis: report.System.CPU.LogicalCores * 1000, MemoryBytes: report.System.Memory.TotalBytes}
}
