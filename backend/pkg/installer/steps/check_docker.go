package steps

import (
	"context"
	"fmt"

	"github.com/chaitin/MonkeyCode/backend/pkg/installer/deploy"
)

type CheckDocker struct{}

func (s *CheckDocker) Name() string { return "环境检测" }

func (s *CheckDocker) Run(c *Context) error {
	c.Reporter.SetStep("环境检测...", "下一步: 安装 Docker")
	status := deploy.CheckDockerStatus(context.Background(), c.Runner)
	c.DockerStatus = status

	logCheck(c, "docker", status.DockerInstalled, status.DockerVersion)
	logCheck(c, "docker compose", status.ComposeInstalled, status.ComposeVersion)
	logCheck(c, "docker daemon", status.DaemonRunning, status.DaemonVersion)

	if status.DockerInstalled && !status.ComposeInstalled {
		return fmt.Errorf("docker compose 缺失，需要 v2 plugin")
	}
	return nil
}

func logCheck(c *Context, label string, ok bool, version string) {
	if ok {
		if version != "" {
			c.Log("✓ %-15s %s", label, version)
		} else {
			c.Log("✓ %-15s ok", label)
		}
		return
	}
	c.Log("✗ %-15s 未安装/未运行", label)
}
