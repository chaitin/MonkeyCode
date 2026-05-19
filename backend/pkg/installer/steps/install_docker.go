package steps

import (
	"context"
	"fmt"

	"github.com/chaitin/MonkeyCode/backend/pkg/installer/deploy"
)

const dockerBundleName = "docker.tgz"
const dockerInstallWorkDir = "/tmp/monkeycode-installer"

type InstallDocker struct{}

func (s *InstallDocker) Name() string { return "安装 Docker" }

func (s *InstallDocker) Run(c *Context) error {
	if c.DockerStatus.Ready() {
		c.Log("⊘ Docker 环境完整，跳过此步骤")
		return nil
	}

	c.Reporter.SetStep("安装 Docker...", "下一步: 收集安装参数")
	bundle, err := locateBundleFile(dockerBundleName)
	if err != nil {
		return err
	}
	c.Log("离线包: %s", bundle)
	c.Log("Docker 环境不完整，使用离线包安装")

	plan := deploy.DockerInstallPlan{
		WorkDir:    dockerInstallWorkDir,
		BundleFile: bundle,
	}

	logRunner := wrapRunner(c.Runner, c.Reporter, "      ")
	if err := deploy.InstallDockerFromLocalBundle(context.Background(), logRunner, plan); err != nil {
		return fmt.Errorf("安装 Docker 失败: %w", err)
	}

	status := deploy.CheckDockerStatus(context.Background(), c.Runner)
	c.DockerStatus = status
	if !status.Ready() {
		return fmt.Errorf("安装脚本执行完成但 Docker 仍不可用")
	}
	c.Log("✓ Docker 安装完成")
	return nil
}
