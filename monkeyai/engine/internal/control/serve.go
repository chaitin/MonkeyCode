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

type CommandLoop interface {
	Tick(context.Context, *Client, Config) error
	Close()
	NetworkPolicies(context.Context) []string
}

func Serve(ctx context.Context, log io.Writer) error { return ServeWithCommands(ctx, log, nil) }
func ServeWithCommands(ctx context.Context, log io.Writer, commands CommandLoop) error {
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
	pc := preflight.DefaultConfig()
	pc.Architecture = cfg.Architecture
	pc.DataDir = cfg.DataDir
	pc.CNIDir = "/opt/monkeyai-engine/current/cni"
	var lastHeartbeat time.Time
	for {
		if time.Since(lastHeartbeat) >= 15*time.Second {
			report, err := preflight.Inspect(ctx, pc)
			if err == nil {
				if commands != nil {
					report.NetworkPolicies = commands.NetworkPolicies(ctx)
					report.RuntimeProtocol = 1
				}
				err = c.Heartbeat(ctx, cfg.HostID, report)
			}
			if errors.Is(err, ErrUnauthorized) {
				return err
			}
			if err != nil {
				fmt.Fprintln(log, "宿主状态上报失败，将重试")
			}
			lastHeartbeat = time.Now()
		}
		if commands != nil {
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
