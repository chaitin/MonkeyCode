package preflight

import "testing"

func TestCPUInterval(t *testing.T) {
	previous, cores := parseCPU("cpu 100 0 50 800 50 0 0 0 25 0\ncpu0 1\ncpu1 1\nintr 0")
	if cores != 2 || previous.total != 1000 || previous.idle != 850 {
		t.Fatalf("CPU 计数或 guest 去重错误: %+v %d", previous, cores)
	}
	current, _ := parseCPU("cpu 120 0 60 860 60 0 0 0 30 0")
	if usage := cpuUsage(previous, current); usage == nil || *usage != 30 {
		t.Fatalf("区间使用率应为 30%%: %v", usage)
	}
	for _, pair := range [][2]cpuTimes{{{}, current}, {current, current}, {current, previous}, {{100, 10}, {110, 30}}, {{100, 30}, {110, 20}}} {
		if cpuUsage(pair[0], pair[1]) != nil {
			t.Fatal("首次采样、计数回退或无效差值不能伪装为 0%")
		}
	}
	if value, _ := parseCPU("cpu invalid 0 0 0"); value.total != 0 {
		t.Fatal("无效 CPU 计数应丢弃")
	}
}

func TestMemoryAvailable(t *testing.T) {
	memory := parseMemory("MemTotal: 1000 kB\nMemFree: 100 kB\nMemAvailable: 600 kB\nCached: 500 kB")
	if memory == nil || memory.TotalBytes != 1024000 || memory.UsedBytes != 409600 || memory.AvailableBytes != 614400 {
		t.Fatalf("应以可用内存而不是空闲内存计算使用量: %+v", memory)
	}
	for _, input := range []string{"", "MemTotal: 1000 kB", "MemTotal: 0 kB\nMemAvailable: 0 kB", "MemTotal: 1 kB\nMemAvailable: 2 kB", "MemTotal: 18446744073709551615 kB\nMemAvailable: 0 kB"} {
		if parseMemory(input) != nil {
			t.Fatalf("缺失或无效内存数据应不报告: %q", input)
		}
	}
}

func TestSystemNames(t *testing.T) {
	for input, want := range map[string]string{
		"NAME=Ubuntu\nPRETTY_NAME=\"Ubuntu 24.04 LTS\"\nVERSION_ID=\"24.04\"":                       "Ubuntu 24.04",
		"NAME=\"CentOS Linux\"\nID=centos\nVERSION_ID=\"7\"\nPRETTY_NAME=\"CentOS Linux 7 (Core)\"": "CentOS 7",
		"NAME='Debian GNU/Linux'\nVERSION_ID='12'":                                                  "Debian GNU/Linux 12",
		"PRETTY_NAME=\"Arch Linux\"":                                                                "Arch Linux",
		"NAME=Ubuntu\nPRETTY_NAME=\"Ubuntu 24.04 LTS\"":                                             "Ubuntu 24.04 LTS",
		"": "",
	} {
		if got := osName(input); got != want {
			t.Fatalf("操作系统名称解析失败: %q，期望 %q，实际 %q", input, want, got)
		}
	}
	for input, want := range map[string]string{"model name : Test CPU\nmodel name : second": "Test CPU", "processor : 0\nHardware : ARM SoC": "ARM SoC", "Processor : AArch64 Processor": "AArch64 Processor"} {
		if cpuModel(input) != want {
			t.Fatalf("CPU 型号解析失败: %q", input)
		}
	}
}
