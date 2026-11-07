package preflight

import (
	"context"
	"encoding/json"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/dockerapi"
	"os"
	"strings"
	"testing"
	"time"
)

type info struct{ mode os.FileMode }

func (i info) Name() string       { return "test" }
func (i info) Size() int64        { return 0 }
func (i info) Mode() os.FileMode  { return i.mode }
func (i info) ModTime() time.Time { return time.Time{} }
func (i info) IsDir() bool        { return i.mode.IsDir() }
func (i info) Sys() any           { return nil }

type fake struct {
	controllers string
	missing     string
	mode        os.FileMode
	link        bool
	calls       int
}

func (f *fake) Read(string) ([]byte, error) { return []byte(f.controllers), nil }
func (f *fake) Stat(p string) (os.FileInfo, error) {
	if strings.HasSuffix(p, ".sock") {
		return info{os.ModeSocket | 0600}, nil
	}
	if p == DefaultConfig().DataDir {
		return info{f.mode}, nil
	}
	return info{0755}, nil
}
func (f *fake) Resolve(p string) (string, error) {
	if f.link {
		return "/different/path", nil
	}
	return p, nil
}
func (f *fake) Find(p string) (string, error) {
	if p == f.missing {
		return "", os.ErrNotExist
	}
	return p, nil
}
func (f *fake) Connect(context.Context, string) error { return nil }
func (f *fake) Run(_ context.Context, p string, args ...string) (string, error) {
	f.calls++

	if p == "docker" && len(args) > 1 {
		info := dockerapi.Info{OSType: "linux", CgroupVersion: "2", MemoryLimit: true, SwapLimit: true, CPUCfsQuota: true, PidsLimit: true, IPv4Forwarding: true}
		info.Runtimes = map[string]struct {
			Path string
			Args []string `json:"runtimeArgs"`
		}{dockerapi.Runtime: {Path: "/opt/monkeyai-engine/current/bin/runsc", Args: []string{"--platform=systrap", "--network=sandbox"}}}
		raw, _ := json.Marshal(info)
		return string(raw), nil
	}
	return "version 1.0", nil

}

func ready() *fake {
	return &fake{controllers: "cpu memory pids io", mode: os.ModeDir | 0700}
}

func TestPrerequisitesAreNotWorkloadVerification(t *testing.T) {
	f := ready()
	r := inspect(t.Context(), DefaultConfig(), f, "linux", "amd64")
	if !r.Prerequisites {
		t.Fatalf("%+v", r.Checks)
	}
	if r.WorkloadVerified {
		t.Fatal("预检不能声称工作负载通过")
	}
}

func TestFailClosed(t *testing.T) {
	for name, change := range map[string]func(*fake){
		"缺少 gvisor": func(f *fake) { f.missing = "runsc" },
		"缺少 io 控制器": func(f *fake) { f.controllers = "cpu memory pids" },
		"可写目录":      func(f *fake) { f.mode = os.ModeDir | 0777 },
		"链接目录":      func(f *fake) { f.link = true },
	} {
		t.Run(name, func(t *testing.T) {
			f := ready()
			change(f)
			r := inspect(t.Context(), DefaultConfig(), f, "linux", "amd64")
			if r.Prerequisites {
				t.Fatal("错误地接受了节点")
			}
		})
	}
}

func TestNonLinuxDoesNotExecutePrograms(t *testing.T) {
	f := ready()
	r := inspect(t.Context(), DefaultConfig(), f, "darwin", "arm64")
	if r.Prerequisites || f.calls != 0 {
		t.Fatal("非 Linux 不能执行宿主探测程序")
	}
}

func TestArchitectureMismatch(t *testing.T) {
	r := inspect(t.Context(), DefaultConfig(), ready(), "linux", "arm64")
	if r.Prerequisites {
		t.Fatal("不能把 ARM64 当成 AMD64 验收")
	}
}

func TestBoundedOutput(t *testing.T) {
	var b output
	input := make([]byte, 1<<20)
	n, err := b.Write(input)
	if err != nil || n != len(input) || len(b.data) != 64*1024 {
		t.Fatal("输出未被限制或提前停止消费")
	}
}

func TestInvalidPaths(t *testing.T) {
	for _, p := range []string{"/", "relative", "/data/../etc", "/data\nextra"} {
		c := DefaultConfig()
		c.DataDir = p
		if err := c.Validate(); err == nil {
			t.Fatalf("接受了路径 %q", p)
		}
	}
}
