package dockerapi

import (
	"strings"
	"testing"
)

func TestCgroupV1RemainsUnsupported(t *testing.T) {
	info := Info{OSType: "linux", CgroupVersion: "1", MemoryLimit: true, SwapLimit: true, CPUCfsQuota: true, PidsLimit: true}
	info.Runtimes = map[string]struct {
		Path string
		Args []string `json:"runtimeArgs"`
	}{Runtime: {Path: "/opt/monkeyai-engine/current/bin/runsc", Args: []string{"--platform=systrap", "--network=sandbox", "--overlay2=none"}}}
	err := info.Validate()
	if err == nil {
		t.Fatal("接受了v1宿主")
	}
	for _, want := range []string{"cgroup v1", "仅支持 cgroup v2", "现代 Linux", "Docker"} {
		if !strings.Contains(err.Error(), want) {
			t.Fatal("缺少错误建议", want, err)
		}
	}
	info.CgroupVersion = "2"
	if err := info.Validate(); err != nil {
		t.Fatal(err)
	}
	for _, disable := range []func(*Info){func(i *Info) { i.MemoryLimit = false }, func(i *Info) { i.SwapLimit = false }, func(i *Info) { i.CPUCfsQuota = false }, func(i *Info) { i.PidsLimit = false }} {
		bad := info
		disable(&bad)
		if bad.Validate() == nil {
			t.Fatal("放宽了资源限额要求")
		}
	}
}
