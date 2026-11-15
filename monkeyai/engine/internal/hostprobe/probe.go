package hostprobe

import (
	"context"
	"errors"
	"fmt"
	"os"
	"runtime"
	"slices"
	"strings"
	"time"
)

type Driver string

const (
	Auto        Driver = "auto"
	Firecracker Driver = "firecracker"
	GVisor      Driver = "gvisor"
)

type Status string

const (
	Supported   Status = "supported"
	Unsupported Status = "unsupported"
	Failed      Status = "error"
)

type Check struct {
	Name   string `json:"name"`
	Status Status `json:"status"`
	Detail string `json:"detail"`
}

type Candidate struct {
	Driver Driver  `json:"driver"`
	Status Status  `json:"status"`
	Checks []Check `json:"checks"`
}

func (c *Candidate) add(name string, status Status, detail string) {
	c.Checks = append(c.Checks, Check{name, status, detail})
	if c.Status == "" || status == Failed || c.Status == Supported {
		c.Status = status
	}
}

type Config struct {
	Architecture  string
	Driver        Driver
	CurrentDriver Driver
}

func DefaultConfig() Config {
	return Config{Architecture: runtime.GOARCH, Driver: Auto}
}

func (c Config) Validate() error {
	if c.Architecture != "amd64" && c.Architecture != "arm64" {
		return errors.New("目标架构必须为 amd64 或 arm64")
	}
	if c.Driver != Auto && c.Driver != Firecracker && c.Driver != GVisor {
		return errors.New("执行引擎必须为 auto、firecracker 或 gvisor")
	}
	if c.CurrentDriver != "" && c.CurrentDriver != Firecracker && c.CurrentDriver != GVisor {
		return errors.New("已有执行引擎必须为 firecracker 或 gvisor")
	}
	if c.CurrentDriver != "" && c.Driver != Auto && c.Driver != c.CurrentDriver {
		return errors.New("不能通过安装探测切换已有执行引擎")
	}
	return nil
}

// Report 仅表示平台是否值得继续准备组件，不证明驱动安装、自检或工作负载就绪。
type Report struct {
	Version           int         `json:"version"`
	Scope             string      `json:"scope"`
	At                time.Time   `json:"at"`
	OS                string      `json:"os"`
	Architecture      string      `json:"architecture"`
	RequestedDriver   Driver      `json:"requested_driver"`
	CurrentDriver     Driver      `json:"current_driver,omitempty"`
	CandidateDriver   Driver      `json:"candidate_driver,omitempty"`
	Checks            []Check     `json:"checks"`
	Candidates        []Candidate `json:"candidates"`
	Reason            string      `json:"reason"`
	ReadinessVerified bool        `json:"readiness_verified"`
	WorkloadVerified  bool        `json:"workload_verified"`
}

type local struct{}

func (local) Controllers() ([]byte, error) {
	return os.ReadFile("/sys/fs/cgroup/cgroup.controllers")
}

type platform interface {
	Controllers() ([]byte, error)
	Probe(context.Context, Driver, string) Candidate
}

func Inspect(ctx context.Context, c Config) (Report, error) {
	if err := c.Validate(); err != nil {
		return Report{}, err
	}
	return inspect(ctx, c, runtime.GOOS, runtime.GOARCH, local{}), nil
}

func inspect(ctx context.Context, c Config, goos, arch string, p platform) Report {
	r := Report{
		Version: 1, Scope: "platform_only", At: time.Now().UTC(), OS: goos,
		Architecture: arch, RequestedDriver: c.Driver, CurrentDriver: c.CurrentDriver,
		Checks: []Check{}, Candidates: []Candidate{},
	}
	fail := func(name string, status Status, detail string) Report {
		r.Checks = append(r.Checks, Check{name, status, detail})
		r.Reason = detail
		return r
	}
	if err := ctx.Err(); err != nil {
		return fail("context", Failed, err.Error())
	}
	if goos != "linux" {
		return fail("linux", Unsupported, "宿主执行环境需要 Linux")
	}
	r.Checks = append(r.Checks, Check{"linux", Supported, "Linux"})
	if arch != c.Architecture {
		return fail("architecture", Unsupported, fmt.Sprintf("当前 %s，要求 %s；不进行架构模拟", arch, c.Architecture))
	}
	r.Checks = append(r.Checks, Check{"architecture", Supported, arch})
	controllers, err := p.Controllers()
	if err != nil {
		status := Failed
		if errors.Is(err, os.ErrNotExist) {
			status = Unsupported
		}
		return fail("cgroup_v2", status, fmt.Sprintf("无法读取 cgroup v2 控制器：%v", err))
	}
	available := strings.Fields(string(controllers))
	var missing []string
	for _, name := range []string{"cpu", "memory", "pids", "io"} {
		if !slices.Contains(available, name) {
			missing = append(missing, name)
		}
	}
	if len(missing) != 0 {
		return fail("cgroup_v2", Unsupported, "缺少 cgroup v2 控制器："+strings.Join(missing, ","))
	}
	r.Checks = append(r.Checks, Check{"cgroup_v2", Supported, "存在 cpu、memory、pids、io 控制器；限额生效仍需安装自检"})

	driver := c.Driver
	if c.CurrentDriver != "" {
		driver = c.CurrentDriver
	}
	order := []Driver{driver}
	if driver == Auto {
		order = []Driver{Firecracker, GVisor}
	}
	for _, d := range order {
		if err := ctx.Err(); err != nil {
			return fail("context", Failed, err.Error())
		}
		candidate := p.Probe(ctx, d, arch)
		if err := ctx.Err(); err != nil {
			candidate.add("context", Failed, err.Error())
		}
		if candidate.Driver != d || len(candidate.Checks) == 0 || !valid(candidate) {
			candidate = Candidate{Driver: d}
			candidate.add("probe_result", Failed, "平台探测返回了不完整或不一致的结果")
		}
		r.Candidates = append(r.Candidates, candidate)
		switch candidate.Status {
		case Supported:
			r.CandidateDriver = d
			r.Reason = "平台基础检查通过，仍需准备组件及真实启动自检"
			if c.CurrentDriver != "" {
				r.Reason = "保留已有执行引擎；平台基础检查通过，仍需验证原驱动就绪"
			} else if len(r.Candidates) > 1 {
				r.Reason = "Firecracker 平台条件不满足，gVisor 基础检查通过；仍需安装与启动自检"
			}
			return r
		case Failed:
			r.Reason = fmt.Sprintf("%s 探测异常或清理失败，拒绝静默回退", d)
			return r
		case Unsupported:
			r.Reason = fmt.Sprintf("%s 平台条件不满足", d)
		}
	}
	if c.CurrentDriver != "" {
		r.Reason = "已有执行引擎当前不可用；保留原绑定，不自动切换"
	} else if driver == Auto {
		r.Reason = "Firecracker 和 gVisor 均不满足平台条件"
	}
	return r
}

func valid(c Candidate) bool {
	status := Supported
	for _, check := range c.Checks {
		if check.Name == "" || check.Detail == "" {
			return false
		}
		switch check.Status {
		case Supported:
		case Unsupported:
			if status != Failed {
				status = Unsupported
			}
		case Failed:
			status = Failed
		default:
			return false
		}
	}
	return status == c.Status
}
