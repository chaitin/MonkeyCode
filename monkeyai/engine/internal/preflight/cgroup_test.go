package preflight

import (
	"os"
	"strings"
	"testing"
)

func TestCgroupV2MissingGivesMigrationAdvice(t *testing.T) {
	f := ready()
	f.readErr = os.ErrNotExist
	report := inspect(t.Context(), DefaultConfig(), f, "linux", "amd64")
	if report.Prerequisites {
		t.Fatal("接受了缺少v2的宿主")
	}
	for _, check := range report.Checks {
		if check.Name != "cgroup_v2" {
			continue
		}
		if check.Passed {
			t.Fatal("错误的cgroup检查结果")
		}
		for _, want := range []string{"不支持 cgroup v1", "Ubuntu", "Debian", "CentOS 7/systemd 219"} {
			if !strings.Contains(check.Detail, want) {
				t.Fatal("缺少错误建议", want, check.Detail)
			}
		}
		return
	}
	t.Fatal("缺少cgroup预检结果")
}

func TestCgroupReadPermissionErrorIsNotMisreportedAsV1(t *testing.T) {
	f := ready()
	f.readErr = os.ErrPermission
	report := inspect(t.Context(), DefaultConfig(), f, "linux", "amd64")
	for _, check := range report.Checks {
		if check.Name == "cgroup_v2" {
			if check.Passed || !strings.Contains(check.Detail, "访问权限") || strings.Contains(check.Detail, "不支持 cgroup v1") {
				t.Fatal(check)
			}
			return
		}
	}
	t.Fatal("缺少cgroup预检结果")
}
