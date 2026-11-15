package control

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/preflight"
)

const ConfigPath = "/etc/monkeyai-engine/config.json"
const KeyPath = "/var/lib/monkeyai-engine/control/identity.key"
const UpgradePath = "/var/lib/monkeyai-engine/control/upgrade.json"
const HealthPath = "/var/lib/monkeyai-engine/control/health.json"

type Health struct {
	Version string    `json:"version"`
	HostID  string    `json:"host_id"`
	PID     int       `json:"pid"`
	At      time.Time `json:"at"`
}

type CommandLoop interface {
	Tick(context.Context, *Client, Config) error
	Close()
	NetworkPolicies(context.Context) []string
}

func Serve(ctx context.Context, log io.Writer) error { return ServeWithCommands(ctx, log, nil) }
func ServeWithCommands(ctx context.Context, log io.Writer, commands CommandLoop) error {
	return ServeVersion(ctx, log, commands, "")
}

func ServeVersion(ctx context.Context, log io.Writer, commands CommandLoop, version string) error {
	if commands != nil {
		defer commands.Close()
	}

	unlock, err := Lock("/var/lib/monkeyai-engine/control/service.lock")
	if err != nil {
		return err
	}
	defer unlock()
	raw, err := os.ReadFile(ConfigPath)
	if err != nil {
		return err
	}
	var cfg Config
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return err
	}
	if version != "" && version != cfg.Version {
		return errors.New("engine 二进制版本与宿主配置不一致")
	}
	if _, err := os.Lstat(KeyPath); err != nil {
		return errors.New("宿主私钥缺失，拒绝自动生成替代身份")
	}
	key, err := Key(KeyPath)
	if err != nil {
		return err
	}
	c, err := New(cfg.Server, key)
	if err != nil {
		return err
	}
	c.WithInsecure(cfg.Insecure)
	pc := preflight.DefaultConfig()
	pc.Architecture = cfg.Architecture
	pc.DataDir = cfg.DataDir
	var lastHeartbeat time.Time
	var inspector preflight.Inspector
	for {
		if time.Since(lastHeartbeat) >= 15*time.Second {
			report, err := inspector.Inspect(ctx, pc)
			if err == nil {
				report.EngineVersion = version
				if commands != nil {
					report.NetworkPolicies = commands.NetworkPolicies(ctx)
					report.RuntimeProtocol = 1
					report.RuntimeUpdateProtocol = 2
				}
				upgrade, upgradeErr := remoteUpgradePath.report(ctx)
				if upgradeErr != nil {
					fmt.Fprintln(log, "读取升级状态失败：", upgradeErr)
				}
				err = c.Heartbeat(ctx, cfg.HostID, struct {
					preflight.Report
					UpgradeProtocol int            `json:"upgrade_protocol"`
					Upgrade         *UpgradeResult `json:"upgrade,omitempty"`
				}{report, 1, upgrade})
			}
			if errors.Is(err, ErrUnauthorized) {
				return err
			}
			if err != nil {
				fmt.Fprintln(log, "宿主状态上报失败，将重试")
			} else if report.Prerequisites {
				raw, _ := json.Marshal(Health{Version: version, HostID: cfg.HostID, PID: os.Getpid(), At: time.Now().UTC()})
				if err := Write(HealthPath, raw, 0600); err != nil {
					return err
				}
			}
			if err == nil && c.Upgrade != nil {
				if e := remoteUpgradePath.launch(ctx, *c.Upgrade); e != nil {
					fmt.Fprintln(log, "远程升级启动失败：", e)
				}
			}
			lastHeartbeat = time.Now()
		}
		_, pending := os.Lstat(UpgradePath)
		if pending != nil && !errors.Is(pending, os.ErrNotExist) {
			return pending
		}
		// 升级器确认新进程心跳后才放行任务，失败回滚不会让新版改写环境状态。
		if commands != nil && errors.Is(pending, os.ErrNotExist) {
			if err := commands.Tick(ctx, c, cfg); errors.Is(err, ErrUnauthorized) {
				return err
			} else if err != nil {
				fmt.Fprintln(log, "环境命令同步失败，将保留本地状态并重试")
			}
		}
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(3 * time.Second):
		}
	}
}
