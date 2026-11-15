package enginehost

import (
	"encoding/json"
	"testing"
)

func TestSystemReportValidation(t *testing.T) {
	for _, raw := range []string{
		`{"private_ips":["10.0.0.1","fd00::1","100.64.0.1"],"public_ips":["8.8.8.8","2001:4860:4860::8888"]}`, `{"network":{"receive_bytes_per_second":1024,"transmit_bytes_per_second":0},"disk_io":{"read_bytes_per_second":2048,"write_bytes_per_second":0}}`, `null`, `{}`, `{"cpu":{"logical_cores":8}}`,
		`{"cpu":{"logical_cores":8,"usage_percent":0},"memory":{"total_bytes":100,"used_bytes":10,"available_bytes":90},"disk":{"path":"/data","total_bytes":100,"used_bytes":20,"available_bytes":70}}`,
	} {
		var report *systemReport
		if err := json.Unmarshal([]byte(raw), &report); err != nil || !validSystem(report) {
			t.Fatalf("合法报告或旧版缺省报告被拒绝: %s %v", raw, err)
		}
	}
	for _, raw := range []string{
		`{"private_ips":["8.8.8.8"]}`, `{"public_ips":["10.0.0.1"]}`, `{"public_ips":["127.0.0.1"]}`, `{"private_ips":["bad"]}`, `{"public_ips":["fe80::1%eth0"]}`, `{"network":{"receive_bytes_per_second":-1}}`, `{"disk_io":{"write_bytes_per_second":-1}}`, `{"hostname":"bad\nname"}`, `{"cpu":{"logical_cores":0}}`, `{"cpu":{"logical_cores":8,"usage_percent":101}}`,
		`{"cpu":{"logical_cores":8,"usage_percent":-1}}`, `{"memory":{"total_bytes":0}}`,
		`{"memory":{"total_bytes":100,"used_bytes":101}}`, `{"memory":{"total_bytes":100,"used_bytes":20,"available_bytes":90}}`,
		`{"disk":{"path":"relative","total_bytes":100}}`, `{"disk":{"path":"/data","total_bytes":100,"used_bytes":-1}}`,
	} {
		var report *systemReport
		if err := json.Unmarshal([]byte(raw), &report); err == nil && validSystem(report) {
			t.Fatalf("接受了无效宿主指标: %s", raw)
		}
	}
}
