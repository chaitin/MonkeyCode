package driver

import (
	"encoding/json"
	"testing"
)

func TestContainerUsage(t *testing.T) {
	var stats containerStats
	err := json.Unmarshal([]byte(`{"read":"2026-11-05T01:00:00Z","cpu_stats":{"cpu_usage":{"total_usage":3000000000},"system_cpu_usage":12000000000,"online_cpus":4},"precpu_stats":{"cpu_usage":{"total_usage":1000000000},"system_cpu_usage":8000000000},"memory_stats":{"usage":500,"stats":{"inactive_file":100}}}`), &stats)
	if err != nil {
		t.Fatal(err)
	}
	u := stats.usage()
	if u == nil || u.CPUCores == nil || *u.CPUCores != 2 || u.MemoryBytes == nil || *u.MemoryBytes != 400 {
		t.Fatal("CPU 必须换算为核数，内存排除缓存", u)
	}
	stats.CPU.Usage.Total = 0
	if got := stats.usage(); got.CPUCores != nil || got.MemoryBytes == nil {
		t.Fatal("计数重置时仅省略 CPU", got)
	}
	stats.Memory.Stats["total_inactive_file"] = 200
	if *stats.usage().MemoryBytes != 300 {
		t.Fatal("未使用 cgroup v1 缓存统计")
	}
	stats.Memory.Stats["total_inactive_file"] = 600
	if *stats.usage().MemoryBytes != 500 {
		t.Fatal("无效缓存值不能引起无符号下溢")
	}
	stats.Memory = nil
	if stats.usage() != nil || (containerStats{}).usage() != nil {
		t.Fatal("不可用统计不能显示为零")
	}
}
