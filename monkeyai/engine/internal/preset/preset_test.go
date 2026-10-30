package preset

import (
	"encoding/json"
	"strings"
	"testing"
)

func valid() Preset {
	return Preset{Version: 1, ID: "standard", Revision: 1, Name: "标准开发", Image: "registry.example.com/monkeyai/dev@sha256:" + strings.Repeat("a", 64), Architecture: "amd64", Driver: "gvisor", NetworkPolicy: "public-only", Runtime: Artifact{Path: "/opt/monkeyai/runtime", Version: "1.0.0", SHA256: strings.Repeat("b", 64)}, TaskEngine: Artifact{Path: "/opt/monkeyai/ohmyagent", Version: "1.0.0", SHA256: strings.Repeat("c", 64)}, Resources: Resources{CPUMillis: 2000, MemoryBytes: 4 << 30, WorkspaceBytes: 20 << 30, HomeBytes: 10 << 30, RuntimeBytes: 2 << 30, VolumeInodes: 100000, TemporaryBytes: 512 << 20, SandboxTasks: 512}}
}

func TestResourceBudget(t *testing.T) {
	p := valid()
	data, _ := json.Marshal(p)
	got, err := Decode(strings.NewReader(string(data)))
	if err != nil {
		t.Fatal(err)
	}
	if got.Resources.StorageBytes() != 32<<30 {
		t.Fatal("运行时数据必须计入存储总量")
	}
	quota, period := got.Resources.CPUQuota()
	if quota != 200000 || period != 100000 {
		t.Fatalf("CPU 配额错误：%d/%d", quota, period)
	}
}

func TestRejectUnsafePresets(t *testing.T) {
	cases := map[string]func(*Preset){
		"隔离降级":     func(p *Preset) { p.Driver = "runc" },
		"浮动镜像":     func(p *Preset) { p.Image = "registry.example.com/dev:latest" },
		"镜像内嵌认证":   func(p *Preset) { p.Image = "user:password@registry.example.com/dev@sha256:" + strings.Repeat("a", 64) },
		"未知网络":     func(p *Preset) { p.NetworkPolicy = "" },
		"路径逃逸":     func(p *Preset) { p.Runtime.Path = "/opt/monkeyai/../../bin/sh" },
		"用户可写发行路径": func(p *Preset) { p.Runtime.Path = "/home/monkey/runtime" },
		"浮动程序版本":   func(p *Preset) { p.Runtime.Version = "latest" },
		"缺失校验和":    func(p *Preset) { p.Runtime.SHA256 = "" },
		"负 CPU":    func(p *Preset) { p.Resources.CPUMillis = -1 },
		"资源溢出":     func(p *Preset) { p.Resources.CPUMillis = 1 << 62 },
		"无界磁盘":     func(p *Preset) { p.Resources.HomeBytes = 0 },
		"无界 inode": func(p *Preset) { p.Resources.VolumeInodes = 0 },
		"临时目录超预算":  func(p *Preset) { p.Resources.TemporaryBytes = p.Resources.MemoryBytes },
		"无界进程":     func(p *Preset) { p.Resources.SandboxTasks = 0 },
	}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			p := valid()
			change(&p)
			if err := p.Validate(); err == nil {
				t.Fatal("接受了无效预设")
			}
		})
	}
}

func TestRejectAmbiguousJSON(t *testing.T) {
	b, _ := json.Marshal(valid())
	s := string(b)
	for name, input := range map[string]string{
		"未知字段":  strings.Replace(s, `"version":1`, `"unknown":1,"version":1`, 1),
		"重复顶层":  strings.Replace(s, `"driver":"gvisor"`, `"driver":"runc","driver":"gvisor"`, 1),
		"重复嵌套":  strings.Replace(s, `"cpu_millis":2000`, `"cpu_millis":1000,"cpu_millis":2000`, 1),
		"大小写别名": strings.Replace(s, `"driver":"gvisor"`, `"Driver":"gvisor"`, 1),
		"尾随对象":  s + `{}`,
		"类型错误":  strings.Replace(s, `"cpu_millis":2000`, `"cpu_millis":"2000"`, 1),
		"超长文件":  strings.Repeat(" ", MaxSize) + s,
		"空值":    "null",
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := Decode(strings.NewReader(input)); err == nil {
				t.Fatal("接受了歧义 JSON")
			}
		})
	}
}
