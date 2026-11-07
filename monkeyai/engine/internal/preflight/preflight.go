package preflight

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/dockerapi"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"sync"
	"time"
)

type Config struct {
	Architecture string
	DataDir      string
	Socket       string
	CgroupRoot   string
}

func DefaultConfig() Config {
	return Config{Architecture: "amd64", DataDir: "/var/lib/monkeyai-engine", Socket: "/var/run/docker.sock", CgroupRoot: "/sys/fs/cgroup"}
}

func (c Config) Validate() error {
	if c.Architecture != "amd64" && c.Architecture != "arm64" {
		return errors.New("目标架构必须为 amd64 或 arm64")
	}
	for _, p := range []string{c.DataDir, c.Socket, c.CgroupRoot} {
		if !filepath.IsAbs(p) || filepath.Clean(p) != p || strings.ContainsAny(p, "\x00\r\n") {
			return errors.New("宿主路径必须是规范的绝对路径")
		}
	}
	if c.DataDir == "/" {
		return errors.New("不能使用根目录作为环境数据目录")
	}
	return nil
}

type Check struct {
	Name   string `json:"name"`
	Passed bool   `json:"passed"`
	Detail string `json:"detail"`
}

type Report struct {
	EngineVersion    string    `json:"engine_version,omitempty"`
	System           *System   `json:"system,omitempty"`
	NetworkPolicies  []string  `json:"network_policies"`
	Version          int       `json:"version"`
	At               time.Time `json:"at"`
	OS               string    `json:"os"`
	Architecture     string    `json:"architecture"`
	Prerequisites    bool      `json:"prerequisites_met"`
	RuntimeProtocol  int       `json:"runtime_protocol,omitempty"`
	WorkloadVerified bool      `json:"workload_verified"`
	Checks           []Check   `json:"checks"`
}

type system interface {
	Read(string) ([]byte, error)
	Stat(string) (os.FileInfo, error)
	Resolve(string) (string, error)
	Find(string) (string, error)
	Run(context.Context, string, ...string) (string, error)
	Connect(context.Context, string) error
}

type local struct{}

func (local) Read(p string) ([]byte, error)      { return os.ReadFile(p) }
func (local) Stat(p string) (os.FileInfo, error) { return os.Stat(p) }
func (local) Resolve(p string) (string, error)   { return filepath.EvalSymlinks(p) }
func (local) Find(p string) (string, error)      { return exec.LookPath(p) }
func (local) Connect(ctx context.Context, p string) error {
	c, err := (&net.Dialer{}).DialContext(ctx, "unix", p)
	if err == nil {
		return c.Close()
	}
	return err
}

// 子命令输出截断后继续消费，避免管道阻塞或输出无界增长。
type output struct{ data []byte }

func (b *output) Write(p []byte) (int, error) {
	if remain := 64*1024 - len(b.data); remain > 0 {
		b.data = append(b.data, p[:min(remain, len(p))]...)
	}
	return len(p), nil
}

func (local) Run(ctx context.Context, name string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Env = append(os.Environ(), "LC_ALL=C")
	cmd.WaitDelay = time.Second
	var b output
	cmd.Stdout, cmd.Stderr = &b, io.Discard
	err := cmd.Run()
	return strings.TrimSpace(string(b.data)), err
}

type Inspector struct {
	mu         sync.Mutex
	previous   cpuTimes
	throughput throughput
}

func Inspect(ctx context.Context, c Config) (Report, error) {
	return new(Inspector).Inspect(ctx, c)
}

func (i *Inspector) Inspect(ctx context.Context, c Config) (Report, error) {
	if err := c.Validate(); err != nil {
		return Report{}, err
	}
	report := inspect(ctx, c, local{}, runtime.GOOS, runtime.GOARCH)
	i.mu.Lock()
	defer i.mu.Unlock()
	system, current := systemInfo(c.DataDir)
	if system != nil && system.CPU != nil {
		system.CPU.UsagePercent = cpuUsage(i.previous, current)
	}
	if system != nil {
		system.Network, system.DiskIO = rates(i.throughput, system.throughput)
		i.throughput = system.throughput
	}
	i.previous = current
	report.System = system
	report.At = time.Now().UTC()
	return report, nil
}

func inspect(ctx context.Context, c Config, s system, goos, arch string) Report {
	r := Report{NetworkPolicies: []string{"isolated"}, Version: 1, At: time.Now().UTC(), OS: goos, Architecture: arch, Prerequisites: true, Checks: []Check{}}
	add := func(name string, passed bool, detail string) {
		r.Checks = append(r.Checks, Check{name, passed, detail})
		r.Prerequisites = r.Prerequisites && passed
	}
	add("linux", goos == "linux", "宿主管理需要 Linux")
	add("architecture", arch == c.Architecture, fmt.Sprintf("当前 %s，要求 %s；不进行架构模拟", arch, c.Architecture))
	if goos != "linux" {
		return r
	}

	controllers, err := s.Read(filepath.Join(c.CgroupRoot, "cgroup.controllers"))
	available := strings.Fields(string(controllers))
	missing := []string{}
	for _, name := range []string{"cpu", "memory", "pids", "io"} {
		if !slices.Contains(available, name) {
			missing = append(missing, name)
		}
	}
	add("cgroup_v2", err == nil && len(missing) == 0, "必需控制器 cpu、memory、pids、io；缺失："+strings.Join(missing, ","))

	for _, tool := range []struct {
		name string
		args []string
	}{
		{"docker", []string{"--version"}},
		{"runsc", []string{"--version"}},
		{"nft", []string{"--version"}},
	} {
		p, err := s.Find(tool.name)
		if err != nil {
			add(tool.name, false, "未找到可执行程序")
			continue
		}
		out, err := s.Run(ctx, p, tool.args...)
		if err != nil || out == "" {
			add(tool.name, false, "无法读取程序版本")
			continue
		}
		add(tool.name, true, out[:min(len(out), 512)])
	}
	info, err := s.Stat(c.Socket)
	if err != nil || info.Mode()&os.ModeSocket == 0 {
		add("docker_socket", false, "指定路径不是可访问的 Unix socket")
	} else {
		dialCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
		err := s.Connect(dialCtx, c.Socket)
		cancel()
		add("docker_socket", err == nil, "检查 Docker Unix socket 可达性")
	}

	data, dockerErr := s.Run(ctx, "docker", "--host", "unix://"+c.Socket, "info", "--format", "{{json .}}")
	var dockerInfo dockerapi.Info
	if dockerErr == nil {
		dockerErr = json.Unmarshal([]byte(data), &dockerInfo)
	}
	if dockerErr == nil {
		dockerErr = dockerInfo.Validate()
	}
	detail := "Docker API、cgroup v2 与 monkeyai-runsc runtime 已就绪"
	if dockerErr != nil {
		detail = dockerErr.Error()
	}
	add("docker_runtime", dockerErr == nil, detail)
	if dockerErr == nil {
		_, nftErr := s.Run(ctx, "nft", "-j", "list", "tables")
		ready := dockerInfo.IPv4Forwarding && nftErr == nil
		add("public_network", ready, "Docker IPv4 转发及 nftables 必须可用；无需手动配置环境网段和 DNS")
		if ready {
			r.NetworkPolicies = []string{"isolated", "public-only"}
		}
	}

	info, err = s.Stat(c.DataDir)
	resolved, resolveErr := s.Resolve(c.DataDir)
	dirOK := err == nil && info.IsDir() && info.Mode().Perm()&0022 == 0 && resolveErr == nil && resolved == c.DataDir
	add("data_directory", dirOK, "数据目录必须已存在、不是符号链接路径且组及其他用户不可写；不会自动创建或格式化")
	return r
}
