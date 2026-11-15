package control

import (
	"encoding/json"
	"testing"
)

func TestDriverConfigCompatibility(t *testing.T) {
	for _, tc := range []struct {
		name string
		raw  string
		want string
		ok   bool
	}{
		{"旧配置", `{"host_id":"existing"}`, "", true},
		{"gVisor配置", `{"default_driver":"gvisor"}`, "gvisor", true},
		{"Firecracker尚未接入", `{"default_driver":"firecracker"}`, "firecracker", false},
		{"不能保存自动策略为执行引擎", `{"default_driver":"auto"}`, "auto", false},
		{"不能退回普通容器", `{"default_driver":"runc"}`, "runc", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var c Config
			if err := json.Unmarshal([]byte(tc.raw), &c); err != nil {
				t.Fatal(err)
			}
			if c.DefaultDriver != tc.want || (c.ValidateDriver() == nil) != tc.ok {
				t.Fatalf("配置被错误接受或丢失驱动：%+v", c)
			}
			raw, err := json.Marshal(c)
			if err != nil {
				t.Fatal(err)
			}
			var fields map[string]any
			if err := json.Unmarshal(raw, &fields); err != nil {
				t.Fatal(err)
			}
			if tc.want != "" && fields["default_driver"] != tc.want {
				t.Fatalf("保存配置丢失驱动：%s", raw)
			}
		})
	}
}
