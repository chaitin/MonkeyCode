package hostprobe

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"strings"
	"testing"
)

type fakePlatform struct {
	controllers string
	readErr     error
	readCalls   int
	calls       []Driver
	results     map[Driver]Candidate
	probe       func(Driver) Candidate
}

func (f *fakePlatform) Controllers() ([]byte, error) {
	f.readCalls++
	return []byte(f.controllers), f.readErr
}
func (f *fakePlatform) Probe(_ context.Context, d Driver, _ string) Candidate {
	f.calls = append(f.calls, d)
	if f.probe != nil {
		return f.probe(d)
	}
	return f.results[d]
}
func platformResult(d Driver, status Status) Candidate {
	return Candidate{Driver: d, Status: status, Checks: []Check{{"platform", status, "test"}}}
}
func readyPlatform() *fakePlatform {
	return &fakePlatform{
		controllers: "cpu memory pids io",
		results: map[Driver]Candidate{
			Firecracker: platformResult(Firecracker, Supported),
			GVisor:      platformResult(GVisor, Supported),
		},
	}
}
func testConfig() Config { return Config{Architecture: "amd64", Driver: Auto} }

func TestSelect(t *testing.T) {
	for _, tc := range []struct {
		name        string
		requested   Driver
		current     Driver
		firecracker Status
		gvisor      Status
		want        Driver
		calls       []Driver
	}{
		{"优先Firecracker", Auto, "", Supported, Supported, Firecracker, []Driver{Firecracker}},
		{"不支持才回退", Auto, "", Unsupported, Supported, GVisor, []Driver{Firecracker, GVisor}},
		{"异常不回退", Auto, "", Failed, Supported, "", []Driver{Firecracker}},
		{"全部不支持", Auto, "", Unsupported, Unsupported, "", []Driver{Firecracker, GVisor}},
		{"回退探测失败", Auto, "", Unsupported, Failed, "", []Driver{Firecracker, GVisor}},
		{"指定Firecracker不回退", Firecracker, "", Unsupported, Supported, "", []Driver{Firecracker}},
		{"指定gVisor", GVisor, "", Supported, Supported, GVisor, []Driver{GVisor}},
		{"修复保留gVisor", Auto, GVisor, Supported, Supported, GVisor, []Driver{GVisor}},
		{"既有Firecracker不可用不换盘", Auto, Firecracker, Unsupported, Supported, "", []Driver{Firecracker}},
		{"既有gVisor不可用不切换", Auto, GVisor, Supported, Unsupported, "", []Driver{GVisor}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := readyPlatform()
			p.results[Firecracker] = platformResult(Firecracker, tc.firecracker)
			p.results[GVisor] = platformResult(GVisor, tc.gvisor)
			c := testConfig()
			c.Driver, c.CurrentDriver = tc.requested, tc.current
			if err := c.Validate(); err != nil {
				t.Fatal(err)
			}
			r := inspect(t.Context(), c, "linux", "amd64", p)
			if r.CandidateDriver != tc.want || !reflect.DeepEqual(p.calls, tc.calls) {
				t.Fatalf("result=%+v calls=%v", r, p.calls)
			}
			if r.ReadinessVerified || r.WorkloadVerified || r.Scope != "platform_only" || r.Reason == "" {
				t.Fatalf("平台探测不能宣称已就绪：%+v", r)
			}
		})
	}
}

func TestCommonFailureStopsDriverProbes(t *testing.T) {
	for _, tc := range []struct {
		name string
		os   string
		arch string
		edit func(*fakePlatform)
	}{
		{"不是Linux", "darwin", "amd64", func(*fakePlatform) {}},
		{"架构不符", "linux", "arm64", func(*fakePlatform) {}},
		{"cgroup缺失", "linux", "amd64", func(p *fakePlatform) { p.readErr = os.ErrNotExist }},
		{"cgroup读取失败", "linux", "amd64", func(p *fakePlatform) { p.readErr = os.ErrPermission }},
		{"控制器缺失", "linux", "amd64", func(p *fakePlatform) { p.controllers = "cpu memory pids" }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := readyPlatform()
			tc.edit(p)
			r := inspect(t.Context(), testConfig(), tc.os, tc.arch, p)
			if r.CandidateDriver != "" || len(p.calls) != 0 {
				t.Fatalf("共用检查失败后仍探测了驱动：%+v", r)
			}
			if tc.os != "linux" && p.readCalls != 0 {
				t.Fatal("非Linux不能检查宿主资源")
			}
		})
	}
}

func TestCanceled(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	p := readyPlatform()
	r := inspect(ctx, testConfig(), "linux", "amd64", p)
	if r.CandidateDriver != "" || len(p.calls) != 0 || p.readCalls != 0 {
		t.Fatalf("取消后仍探测：%+v", r)
	}
}

func TestCanceledProbeCannotFallbackOrSucceed(t *testing.T) {
	for _, status := range []Status{Supported, Unsupported} {
		t.Run(string(status), func(t *testing.T) {
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			p := readyPlatform()
			p.probe = func(d Driver) Candidate {
				cancel()
				return platformResult(d, status)
			}
			r := inspect(ctx, testConfig(), "linux", "amd64", p)
			if r.CandidateDriver != "" || len(p.calls) != 1 || r.Candidates[0].Status != Failed {
				t.Fatalf("取消被忽略：%+v", r)
			}
		})
	}
}

func TestMalformedProbeFailsClosed(t *testing.T) {
	for _, value := range []Candidate{
		{},
		{Driver: Firecracker, Status: Supported},
		platformResult(GVisor, Supported),
		{Driver: Firecracker, Status: Supported, Checks: []Check{{"x", Failed, "error"}}},
		{Driver: Firecracker, Status: Unsupported, Checks: []Check{{"x", Status("unknown"), "unknown"}}},
	} {
		p := readyPlatform()
		p.results[Firecracker] = value
		r := inspect(t.Context(), testConfig(), "linux", "amd64", p)
		if r.CandidateDriver != "" || len(p.calls) != 1 || r.Candidates[0].Status != Failed {
			t.Fatalf("接受了异常结果：%+v", r)
		}
	}
}

func TestConfig(t *testing.T) {
	for _, c := range []Config{
		{Architecture: "386", Driver: Auto},
		{Architecture: "amd64", Driver: "runc"},
		{Architecture: "amd64", Driver: Auto, CurrentDriver: Auto},
		{Architecture: "amd64", Driver: Firecracker, CurrentDriver: GVisor},
		{Architecture: "amd64", Driver: GVisor, CurrentDriver: Firecracker},
	} {
		if _, err := Inspect(t.Context(), c); err == nil {
			t.Fatalf("接受了无效配置：%+v", c)
		}
	}
}

func TestReportCannotServeAsReadiness(t *testing.T) {
	r := inspect(t.Context(), testConfig(), "linux", "amd64", readyPlatform())
	raw, err := json.Marshal(r)
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"prerequisites_met", "default_driver", "selected_driver", "environment_protocol"} {
		if strings.Contains(string(raw), `"`+field+`"`) {
			t.Fatalf("平台报告混入就绪或持久选择字段：%s", raw)
		}
	}
}

func TestCandidateStatusPrecedence(t *testing.T) {
	c := Candidate{Driver: Firecracker}
	c.add("one", Unsupported, "unsupported")
	c.add("two", Supported, "ok")
	if c.Status != Unsupported {
		t.Fatal(c)
	}
	c.add("cleanup", Failed, errors.New("cleanup").Error())
	c.add("last", Supported, "ok")
	if c.Status != Failed || !valid(c) {
		t.Fatal(c)
	}
}
