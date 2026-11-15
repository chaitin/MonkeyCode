package control

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
	"strings"
	"time"
)

const remoteUpgradePath remoteFile = "/var/lib/monkeyai-engine/control/remote-upgrade.json"

var releaseName = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$`)
var upgradeID = regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`)
var releaseHash = regexp.MustCompile(`^[a-f0-9]{64}$`)

type UpgradeTask struct {
	ID           string `json:"id"`
	Version      string `json:"version"`
	InstallerSHA string `json:"installer_sha256"`
	ManifestSHA  string `json:"manifest_sha256"`
}

func (t UpgradeTask) valid() bool {
	return upgradeID.MatchString(t.ID) && releaseName.MatchString(t.Version) && t.Version != "latest" && releaseHash.MatchString(t.InstallerSHA) && releaseHash.MatchString(t.ManifestSHA)
}

type UpgradeResult struct {
	ID      string `json:"id"`
	Version string `json:"version"`
	Status  string `json:"status"`
	Reason  string `json:"reason"`
}
type remoteUpgrade struct {
	Task   UpgradeTask   `json:"task"`
	Result UpgradeResult `json:"result"`
}

type remoteFile string

func (f remoteFile) save(v remoteUpgrade) error {
	raw, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return Write(string(f), raw, 0600)
}
func (f remoteFile) read() (remoteUpgrade, error) {
	var v remoteUpgrade
	raw, err := os.ReadFile(string(f))
	if err != nil {
		return v, err
	}
	err = json.Unmarshal(raw, &v)
	if err == nil && (!v.Task.valid() || v.Result.ID != v.Task.ID || v.Result.Version != v.Task.Version || (v.Result.Status != "running" && v.Result.Status != "failed" && v.Result.Status != "succeeded")) {
		err = errors.New("远程升级记录无效")
	}
	return v, err
}
func (f remoteFile) report(ctx context.Context) (*UpgradeResult, error) {
	unlock, err := Lock(string(f) + ".lock")
	if err != nil {
		return nil, err
	}
	defer unlock()
	v, err := f.read()
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if v.Result.Status == "running" {
		check, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		raw, err := exec.CommandContext(check, "systemctl", "show", "monkeyai-engine-upgrade-"+v.Task.ID+".service", "--property=ActiveState", "--value").Output()
		if err != nil {
			return &v.Result, err
		}
		switch strings.TrimSpace(string(raw)) {
		case "inactive", "failed":
			v.Result.Status, v.Result.Reason = "failed", "upgrade_interrupted"
			if err := f.save(v); err != nil {
				return nil, err
			}
		}
	}
	return &v.Result, nil
}
func (f remoteFile) launch(ctx context.Context, task UpgradeTask) error {
	if !task.valid() {
		return errors.New("远程升级参数无效")
	}
	unlock, err := Lock(string(f) + ".lock")
	if err != nil {
		return err
	}
	defer unlock()
	previous, err := f.read()
	if err == nil && previous.Task.ID == task.ID {
		if previous.Task != task {
			return errors.New("同一升级任务的发行物发生变化")
		}
		return nil
	}
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err == nil && previous.Result.Status == "running" {
		return errors.New("已有升级正在执行")
	}
	state := remoteUpgrade{task, UpgradeResult{task.ID, task.Version, "running", ""}}
	if err = f.save(state); err != nil {
		return err
	}
	binary, err := os.Executable()
	if err == nil {
		err = exec.CommandContext(ctx, "systemd-run", "--unit=monkeyai-engine-upgrade-"+task.ID, "--collect", "--property=TimeoutStopSec=120", "--property=RuntimeMaxSec=26min", binary, "remote-upgrade", task.ID).Run()
	}
	if err != nil {
		state.Result.Status = "failed"
		state.Result.Reason = "launch_failed"
		return errors.Join(err, f.save(state))
	}
	return nil
}

// RunUpgrade 在独立 systemd 服务内运行，停止 engine 不会中断 installer。
func RunUpgrade(ctx context.Context, id string, out io.Writer) (result error) {
	if !upgradeID.MatchString(id) {
		return errors.New("升级任务标识无效")
	}
	f := remoteUpgradePath
	unlock, err := Lock(string(f) + ".run.lock")
	if err != nil {
		return err
	}
	defer unlock()
	state, err := f.read()
	if err != nil {
		return err
	}
	if state.Task.ID != id || state.Result.Status != "running" {
		return errors.New("升级任务已变更")
	}
	defer func() {
		state.Result.Status = "succeeded"
		if result != nil {
			state.Result.Status = "failed"
			state.Result.Reason = "upgrade_failed"
		}
		result = errors.Join(result, f.save(state))
	}()
	var cfg Config
	raw, err := os.ReadFile(ConfigPath)
	if err != nil {
		return err
	}
	if err = json.Unmarshal(raw, &cfg); err != nil {
		return err
	}
	key, err := Key(KeyPath)
	if err != nil {
		return err
	}
	client, err := New(cfg.Server, key)
	if err != nil {
		return err
	}
	client.WithInsecure(cfg.Insecure)
	ctx, cancel := context.WithTimeout(ctx, 24*time.Minute)
	defer cancel()
	dir, err := os.MkdirTemp("/opt/monkeyai-engine", ".upgrade-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	path := filepath.Join(dir, "installer")
	if err = downloadInstaller(ctx, client, state.Task, cfg.Architecture, path); err != nil {
		return err
	}
	cmd := exec.CommandContext(ctx, path, "monkeyai-engine", "upgrade", "--server", cfg.Server, "--release", state.Task.Version, "--architecture", cfg.Architecture, "--manifest-sha256", state.Task.ManifestSHA)
	// 给 installer 留出取消后的回滚时间，不能直接 SIGKILL。
	cmd.Cancel = func() error { return cmd.Process.Signal(os.Interrupt) }
	cmd.WaitDelay = 90 * time.Second
	cmd.Stdout, cmd.Stderr = out, out
	if err = cmd.Run(); err != nil {
		return fmt.Errorf("installer 升级失败：%w", err)
	}
	return nil
}
func downloadInstaller(ctx context.Context, c *Client, task UpgradeTask, arch, path string) error {
	if !task.valid() || (arch != "amd64" && arch != "arm64") {
		return errors.New("升级发行参数无效")
	}
	req, err := http.NewRequestWithContext(ctx, "GET", c.Server+"/api/host/v1/releases/"+task.Version+"/"+arch+"/installer", nil)
	if err != nil {
		return err
	}
	client := *c.HTTP
	client.Timeout = 15 * time.Minute
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("下载 installer 失败：%d", resp.StatusCode)
	}
	file, err := os.CreateTemp(filepath.Dir(path), ".installer-")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	defer file.Close()
	digest := sha256.New()
	n, err := io.Copy(io.MultiWriter(file, digest), io.LimitReader(resp.Body, (256<<20)+1))
	if err != nil {
		return err
	}
	if n > 256<<20 || hex.EncodeToString(digest.Sum(nil)) != task.InstallerSHA {
		return errors.New("installer 摘要校验失败")
	}
	if err := file.Chmod(0700); err != nil {
		return err
	}
	if err := file.Sync(); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(file.Name(), path)
}
