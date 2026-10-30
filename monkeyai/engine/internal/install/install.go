package install

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/control"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/network"
	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/preflight"
)

type Config struct{ Server, Enrollment, Release, Architecture, ManifestSHA, DataDir string }

var versionPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$`)
var hashPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)
var pathPattern = regexp.MustCompile(`^/[a-zA-Z0-9/_-]+$`)
var targets = map[string]string{"monkeyai-engine": "bin/monkeyai-engine", "containerd": "bin/containerd", "runsc": "bin/runsc", "containerd-shim-runsc-v1": "bin/containerd-shim-runsc-v1", "bridge": "cni/bridge", "ptp": "cni/ptp", "host-local": "cni/host-local", "loopback": "cni/loopback", "checkpointgofer": "bin/gvisor-bin/checkpointgofer", "gvisor-proc-umounter": "bin/gvisor-bin/gvisor-proc-umounter", "gvisor-sentry-prewarmer": "bin/gvisor-bin/gvisor-sentry-prewarmer", "gvisor_sentry": "bin/gvisor-bin/gvisor_sentry", "runsc-fd-parking": "bin/gvisor-bin/runsc-fd-parking", "runsc-metric-server": "bin/gvisor-bin/runsc-metric-server"}

type Manifest struct {
	Version      string            `json:"version"`
	Architecture string            `json:"architecture"`
	Files        map[string]string `json:"files"`
}

func (c Config) Validate() error {
	if err := control.ValidateServer(c.Server); err != nil {
		return err
	}
	if !versionPattern.MatchString(c.Release) || !hashPattern.MatchString(c.ManifestSHA) || (c.Architecture != "amd64" && c.Architecture != "arm64") || len(c.Enrollment) != 43 {
		return errors.New("安装版本、架构或接入参数无效")
	}
	if !pathPattern.MatchString(c.DataDir) || filepath.Clean(c.DataDir) != c.DataDir || c.DataDir == "/" {
		return errors.New("数据目录必须为规范的专用绝对路径")
	}
	return nil
}
func ParseManifest(raw []byte, c Config) (Manifest, error) {
	var m Manifest
	if len(raw) > 16<<10 || control.Digest(raw) != c.ManifestSHA {
		return m, errors.New("发行清单摘要不匹配")
	}
	if err := json.Unmarshal(raw, &m); err != nil {
		return m, err
	}
	if m.Version != c.Release || m.Architecture != c.Architecture || len(m.Files) != len(targets) {
		return m, errors.New("发行清单版本或架构不匹配")
	}
	for name := range targets {
		if !hashPattern.MatchString(m.Files[name]) {
			return m, errors.New("发行清单缺少必需组件摘要")
		}
	}
	return m, nil
}
func client() *http.Client {
	return &http.Client{Timeout: 15 * time.Minute, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("拒绝发行物重定向") }}
}
func fetch(ctx context.Context, url string, w io.Writer, limit int64) error {
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return err
	}
	resp, err := client().Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("下载发行物失败，状态码 %d", resp.StatusCode)
	}
	n, err := io.Copy(w, io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return err
	}
	if n > limit {
		return errors.New("发行文件过大")
	}
	return nil
}
func download(ctx context.Context, url, path, want string) error {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0700)
	if err != nil {
		return err
	}
	defer f.Close()
	h := sha256.New()
	if err := fetch(ctx, url, io.MultiWriter(f, h), 256<<20); err != nil {
		return err
	}
	if hex.EncodeToString(h.Sum(nil)) != want {
		return errors.New("发行文件 SHA-256 校验失败")
	}
	return f.Sync()
}
func command(ctx context.Context, out io.Writer, name string, args ...string) error {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Stdout = out
	cmd.Stderr = out
	cmd.Stdin = nil
	cmd.Env = append(os.Environ(), "DEBIAN_FRONTEND=noninteractive")
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("执行 %s 失败: %w", name, err)
	}
	return nil
}
func secureDir(path string) error {
	if err := os.MkdirAll(path, 0700); err != nil {
		return err
	}
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil || resolved != path {
		return errors.New("安装目录不能包含符号链接")
	}
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if info.Mode().Perm()&0022 != 0 {
		return errors.New("安装目录不能被组或其他用户写入")
	}
	return nil
}
func Run(ctx context.Context, c Config, out io.Writer) (runErr error) {
	if err := c.Validate(); err != nil {
		return err
	}
	if runtime.GOOS != "linux" || os.Geteuid() != 0 || runtime.GOARCH != c.Architecture {
		return errors.New("需要在对应架构的 Linux 宿主以 root 运行")
	}
	if _, err := os.Stat("/run/systemd/system"); err != nil {
		return errors.New("需要运行 systemd")
	}
	if _, err := os.Stat("/sys/fs/cgroup/cgroup.controllers"); err != nil {
		return errors.New("需要启用 cgroup v2")
	}
	for _, path := range []string{"/etc/monkeyai-engine", "/var/lib/monkeyai-engine/control", "/opt/monkeyai-engine/releases", c.DataDir} {
		if err := secureDir(path); err != nil {
			return err
		}
	}
	unlock, err := control.Lock("/var/lib/monkeyai-engine/control/install.lock")
	if err != nil {
		return err
	}
	defer unlock()
	for _, name := range []string{"monkeyai-engine", "monkeyai-containerd"} {
		raw, err := os.ReadFile("/etc/systemd/system/" + name + ".service")
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		if err == nil && !strings.HasPrefix(string(raw), "# Managed by monkeyai-engine\n") {
			return errors.New("同名服务不属于此安装器")
		}
	}
	cfg := control.Config{Server: strings.TrimRight(c.Server, "/"), Version: c.Release, Architecture: c.Architecture, DataDir: c.DataDir}
	existing, err := os.ReadFile(control.ConfigPath)
	if err == nil {
		var old control.Config
		if json.Unmarshal(existing, &old) != nil || old.Server != cfg.Server || old.Version != cfg.Version || old.Architecture != cfg.Architecture || old.DataDir != cfg.DataDir {
			return errors.New("现有宿主配置不同；安装命令只支持相同配置重试，不自动切换后台或升级")
		}
		cfg = old
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	fmt.Fprintln(out, "校验固定版本发行物…")
	base := cfg.Server + "/api/host/v1/releases/" + c.Release + "/" + c.Architecture + "/"
	var buf strings.Builder
	if err := fetch(ctx, base+"manifest.json", &buf, 16<<10); err != nil {
		return err
	}
	m, err := ParseManifest([]byte(buf.String()), c)
	if err != nil {
		return err
	}
	stage, err := os.MkdirTemp("/opt/monkeyai-engine/releases", ".install-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(stage)
	for _, dir := range []string{"bin", "bin/gvisor-bin", "cni"} {
		if err := os.Mkdir(filepath.Join(stage, dir), 0755); err != nil {
			return err
		}
	}
	for name, target := range targets {
		if err := download(ctx, base+name, filepath.Join(stage, target), m.Files[name]); err != nil {
			return fmt.Errorf("下载 %s: %w", name, err)
		}
	}
	release := filepath.Join("/opt/monkeyai-engine/releases", c.Release)
	if _, err := os.Lstat(release); err == nil {
		for name, target := range targets {
			p := filepath.Join(release, target)
			info, err := os.Lstat(p)
			if err != nil || !info.Mode().IsRegular() {
				return errors.New("已有发行目录损坏")
			}
			f, err := os.Open(p)
			if err != nil {
				return err
			}
			h := sha256.New()
			_, err = io.Copy(h, f)
			f.Close()
			if err != nil || hex.EncodeToString(h.Sum(nil)) != m.Files[name] {
				return errors.New("已有同版本发行文件不一致")
			}
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	} else if err := os.Rename(stage, release); err != nil {
		return err
	}
	fmt.Fprintln(out, "准备网络与配额工具…")
	missing := false
	for _, tool := range []string{"ip", "nft", "tc", "xfs_quota", "findmnt"} {
		if _, err := exec.LookPath(tool); err != nil {
			missing = true
		}
	}
	if missing {
		if _, err := exec.LookPath("apt-get"); err != nil {
			return errors.New("请先安装 nftables、iproute2、xfsprogs 和 util-linux；自动安装依赖目前支持 Debian/Ubuntu")
		}
		if err := command(ctx, out, "apt-get", "update"); err != nil {
			return err
		}
		if err := command(ctx, out, "apt-get", "install", "-y", "nftables", "iproute2", "xfsprogs", "util-linux", "ca-certificates"); err != nil {
			return err
		}
	}
	if cfg.HostID != "" {
		if _, err := os.Lstat(control.KeyPath); err != nil {
			return errors.New("已有宿主私钥缺失，拒绝替换身份")
		}
	}
	key, err := control.Key(control.KeyPath)
	if err != nil {
		return err
	}
	connection, err := control.New(cfg.Server, key)
	if err != nil {
		return err
	}
	if cfg.HostID == "" {
		fmt.Fprintln(out, "向后台注册宿主…")
		cfg.HostID, err = connection.Enroll(ctx, c.Enrollment, c.Architecture, c.Release)
		if err != nil {
			return err
		}
		raw, err := json.Marshal(cfg)
		if err != nil {
			return err
		}
		if err := control.Write(control.ConfigPath, raw, 0600); err != nil {
			return err
		}
	} else {
		fmt.Fprintf(out, "保留现有宿主身份 %s，修复相同版本安装。\n", cfg.HostID)
	}
	linkDir, err := os.MkdirTemp("/opt/monkeyai-engine", ".link-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(linkDir)
	if err := os.Symlink(release, filepath.Join(linkDir, "current")); err != nil {
		return err
	}
	if err := os.Rename(filepath.Join(linkDir, "current"), "/opt/monkeyai-engine/current"); err != nil {
		return err
	}
	if err := control.Write("/etc/monkeyai-engine/containerd.toml", []byte(containerdConfig), 0600); err != nil {
		return err
	}
	for name, unit := range map[string]string{"monkeyai-containerd": containerdUnit, "monkeyai-engine": engineUnit} {
		if err := control.Write("/etc/systemd/system/"+name+".service", []byte(unit), 0644); err != nil {
			return err
		}
	}
	if err := command(ctx, out, "systemctl", "daemon-reload"); err != nil {
		return err
	}
	if err := command(ctx, out, "systemctl", "enable", "--now", "monkeyai-containerd.service"); err != nil {
		return err
	}
	pc := preflight.DefaultConfig()
	pc.Architecture = c.Architecture
	pc.DataDir = c.DataDir
	pc.CNIDir = "/opt/monkeyai-engine/current/cni"
	os.Setenv("PATH", "/opt/monkeyai-engine/current/bin:"+os.Getenv("PATH"))
	report, err := preflight.Inspect(ctx, pc)
	if err != nil {
		return err
	}
	report.NetworkPolicies = network.Policies(ctx)
	// 修复安装期间避免既有守护进程与安装器争用单次挑战。
	wasActive := exec.CommandContext(ctx, "systemctl", "is-active", "--quiet", "monkeyai-engine.service").Run() == nil
	if err := command(ctx, out, "systemctl", "stop", "monkeyai-engine.service"); err != nil {
		return err
	}
	defer func() {
		if wasActive && runErr != nil {
			restore, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			runErr = errors.Join(runErr, command(restore, out, "systemctl", "start", "monkeyai-engine.service"))
		}
	}()
	// 先完成一次经签名的上报，安装成功不能只依赖 systemd 返回值。
	if err := connection.Heartbeat(ctx, cfg.HostID, report); err != nil {
		return err
	}
	if err := command(ctx, out, "systemctl", "enable", "--now", "monkeyai-engine.service"); err != nil {
		return err
	}
	if err := command(ctx, out, "systemctl", "is-active", "--quiet", "monkeyai-containerd.service", "monkeyai-engine.service"); err != nil {
		return err
	}
	fmt.Fprintf(out, "monkeyai-engine 安装并接入成功，宿主 ID：%s\n", cfg.HostID)
	if !report.Prerequisites {
		fmt.Fprintln(out, "宿主预检尚未通过，请在后台查看检查项；安装器不会格式化现有磁盘。")
	}
	fmt.Fprintln(out, "当前版本提供宿主注册和预检上报，云电脑执行驱动尚未开放。")
	return nil
}

const containerdConfig = `version = 3
root = "/var/lib/monkeyai-engine/containerd"
state = "/run/monkeyai-engine/containerd"
disabled_plugins = ["io.containerd.grpc.v1.cri", "io.containerd.cri.v1.images", "io.containerd.cri.v1.runtime", "io.containerd.podsandbox.controller.v1.podsandbox"]
[grpc]
  address = "/run/monkeyai-engine/containerd.sock"
  uid = 0
  gid = 0
`
const containerdUnit = `# Managed by monkeyai-engine
[Unit]
Description=MonkeyAI dedicated containerd
After=network-online.target
Wants=network-online.target
[Service]
Type=notify
TimeoutStartSec=60
Environment=PATH=/opt/monkeyai-engine/current/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=/opt/monkeyai-engine/current/bin/containerd --config /etc/monkeyai-engine/containerd.toml
Restart=on-failure
RestartSec=5
Delegate=yes
KillMode=process
RuntimeDirectory=monkeyai-engine
RuntimeDirectoryMode=0700
[Install]
WantedBy=multi-user.target
`
const engineUnit = `# Managed by monkeyai-engine
[Unit]
Description=MonkeyAI engine
After=network-online.target monkeyai-containerd.service
Wants=network-online.target monkeyai-containerd.service
[Service]
Type=simple
Environment=PATH=/opt/monkeyai-engine/current/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=/opt/monkeyai-engine/current/bin/monkeyai-engine serve
Restart=on-failure
RestartSec=15
UMask=0077
NoNewPrivileges=yes
[Install]
WantedBy=multi-user.target
`
