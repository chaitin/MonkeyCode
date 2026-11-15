package preflight

import (
	"testing"
	"time"
)

func TestThroughputRates(t *testing.T) {
	start := time.Now()
	before := throughput{at: start, network: map[string]counters{"eth0": {100, 200}, "eth1": {10, 20}}, device: "8:1", disk: &counters{1024, 2048}}
	after := throughput{at: start.Add(2 * time.Second), network: map[string]counters{"eth0": {300, 600}, "eth1": {50, 100}}, device: "8:1", disk: &counters{3072, 6144}}
	net, disk := rates(before, after)
	if net == nil || net.ReceiveBytesPerSecond != 120 || net.TransmitBytesPerSecond != 240 || disk == nil || disk.ReadBytesPerSecond != 1024 || disk.WriteBytesPerSecond != 2048 {
		t.Fatal(net, disk)
	}
	if net, disk := rates(throughput{}, after); net != nil || disk != nil {
		t.Fatal("首次采样不能显示零速率")
	}
	if net, disk := rates(after, before); net != nil || disk != nil {
		t.Fatal("计数回退必须省略")
	}
	if net, disk := rates(before, before); net != nil || disk != nil {
		t.Fatal("零采样间隔必须省略")
	}
	after.device = "8:2"
	delete(after.network, "eth1")
	if net, disk := rates(before, after); net != nil || disk != nil {
		t.Fatal("设备集合变化必须重新采样")
	}
	if got := diskCounters("1 0 10 0 2 0 20 0 0 0 0"); got == nil || got.first != 5120 || got.second != 10240 {
		t.Fatal(got)
	}
	for _, raw := range []string{"", "1 0 bad 0 2 0 20", "1 0 18446744073709551615 0 2 0 20"} {
		if diskCounters(raw) != nil {
			t.Fatal("接受无效磁盘统计")
		}
	}
}

func TestThroughputResetAndRecovery(t *testing.T) {
	start := time.Now()
	before := throughput{at: start, network: map[string]counters{"1:eth0": {100, 200}}, device: "8:1", disk: &counters{1024, 2048}}
	reset := throughput{at: start.Add(time.Second), network: map[string]counters{"1:eth0": {1, 2}}, device: "8:1", disk: &counters{10, 20}}
	if network, disk := rates(before, reset); network != nil || disk != nil {
		t.Fatal("计数重置不能产生负速率", network, disk)
	}
	after := throughput{at: start.Add(3 * time.Second), network: map[string]counters{"1:eth0": {21, 42}}, device: "8:1", disk: &counters{210, 420}}
	if network, disk := rates(reset, after); network == nil || disk == nil || network.ReceiveBytesPerSecond != 10 || network.TransmitBytesPerSecond != 20 || disk.ReadBytesPerSecond != 100 || disk.WriteBytesPerSecond != 200 {
		t.Fatal("重置后应从新的基线恢复采样", network, disk)
	}
	after.at = reset.at.Add(time.Second)
	after.network = map[string]counters{"2:eth0": {21, 42}}
	if network, disk := rates(reset, after); network != nil || disk == nil {
		t.Fatal("同名网卡更换后重新采样，不影响磁盘", network, disk)
	}
	after.network = reset.network
	after.disk = nil
	if network, disk := rates(reset, after); network == nil || network.ReceiveBytesPerSecond != 0 || network.TransmitBytesPerSecond != 0 || disk != nil {
		t.Fatal("空闲网络应上报零速率，不可用磁盘应省略", network, disk)
	}
}
