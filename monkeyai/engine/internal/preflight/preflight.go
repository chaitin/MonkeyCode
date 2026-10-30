package preflight

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"time"
)

type Config struct {
	Architecture string
	DataDir      string
	Socket       string
	CNIDir       string
	CgroupRoot   string
}

func DefaultConfig() Config {
	return Config{Architecture: "amd64", DataDir: "/var/lib/monkeyai-engine", Socket: "/run/monkeyai-engine/containerd.sock", CNIDir: "/opt/cni/bin", CgroupRoot: "/sys/fs/cgroup"}
}

func (c Config) Validate() error {
	if c.Architecture != "amd64" && c.Architecture != "arm64" {
		return errors.New("目标架构必须为 amd64 或 arm64")
	}
	for _, p := range []string{c.DataDir, c.Socket, c.CNIDir, c.CgroupRoot} {
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

func Inspect(ctx context.Context, c Config) (Report, error) {
	if err := c.Validate(); err != nil {
		return Report{}, err
	}
	return inspect(ctx, c, local{}, runtime.GOOS, runtime.GOARCH), nil
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
		{"containerd", []string{"--version"}},
		{"runsc", []string{"--version"}},
		{"containerd-shim-runsc-v1", []string{"-v"}},
		{"nft", []string{"--version"}},
		{"tc", []string{"-V"}},
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
	for _, name := range []string{"bridge", "host-local", "loopback"} {
		info, err := s.Stat(filepath.Join(c.CNIDir, name))
		ok := err == nil && info.Mode().IsRegular() && info.Mode().Perm()&0111 != 0
		add("cni_"+name, ok, "检查 CNI 可执行文件："+filepath.Join(c.CNIDir, name))
	}
	info, err := s.Stat(c.Socket)
	if err != nil || info.Mode()&os.ModeSocket == 0 {
		add("containerd_socket", false, "指定路径不是可访问的 Unix socket")
	} else {
		dialCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
		err := s.Connect(dialCtx, c.Socket)
		cancel()
		add("containerd_socket", err == nil, "检查 socket 可达性；尚未验证 containerd API 或权限隔离")
	}

	info, err = s.Stat(c.DataDir)
	resolved, resolveErr := s.Resolve(c.DataDir)
	dirOK := err == nil && info.IsDir() && info.Mode().Perm()&0022 == 0 && resolveErr == nil && resolved == c.DataDir
	add("data_directory", dirOK, "数据目录必须已存在、不是符号链接路径且组及其他用户不可写；不会自动创建或格式化")
	if !dirOK {
		add("xfs_project_quota", false, "先准备受限数据目录，才能核验项目配额")
		return r
	}
	findmnt, err := s.Find("findmnt")
	if err != nil {
		add("xfs_project_quota", false, "缺少 findmnt，无法识别真实挂载")
		return r
	}
	mountJSON, err := s.Run(ctx, findmnt, "--json", "--target", c.DataDir, "--output", "TARGET,FSTYPE,OPTIONS")
	mount, mountErr := parseMount(mountJSON)
	if err != nil || mountErr != nil || mount.Type != "xfs" || !quotaMount(mount.Options) {
		add("xfs_project_quota", false, "数据目录需要可写 XFS 且启用 prjquota／pquota（非 pqnoenforce）")
		return r
	}
	quota, err := s.Find("xfs_quota")
	if err != nil {
		add("xfs_project_quota", false, "缺少 xfs_quota，无法确认配额实际启用")
		return r
	}
	state, err := s.Run(ctx, quota, "-x", "-c", "state", mount.Target)
	add("xfs_project_quota", err == nil && projectQuota(state), "必须确认 Project quota 的 Accounting 和 Enforcement 都为 ON")
	return r
}

type mountInfo struct {
	Target  string `json:"target"`
	Type    string `json:"fstype"`
	Options string `json:"options"`
}

func parseMount(raw string) (mountInfo, error) {
	var data struct {
		Filesystems []mountInfo `json:"filesystems"`
	}
	if err := json.Unmarshal([]byte(raw), &data); err != nil || len(data.Filesystems) != 1 {
		return mountInfo{}, errors.New("挂载信息不唯一")
	}
	m := data.Filesystems[0]
	if !filepath.IsAbs(m.Target) {
		return mountInfo{}, errors.New("挂载点无效")
	}
	return m, nil
}

func quotaMount(options string) bool {
	values := strings.Split(options, ",")
	return slices.Contains(values, "rw") && !slices.Contains(values, "ro") && !slices.Contains(values, "pqnoenforce") && (slices.Contains(values, "prjquota") || slices.Contains(values, "pquota"))
}

func projectQuota(state string) bool {
	project, accounting, enforcement := false, false, false
	for line := range strings.SplitSeq(state, "\n") {
		line = strings.TrimSpace(line)
		if strings.Contains(line, "quota state on") {
			project = strings.HasPrefix(line, "Project quota state on")
			continue
		}
		if !project {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) != 2 {
			continue
		}
		if fields[0] == "Accounting:" {
			accounting = fields[1] == "ON"
		}
		if fields[0] == "Enforcement:" {
			enforcement = fields[1] == "ON"
		}
	}
	return accounting && enforcement
}
