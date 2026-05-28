package steps

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/chaitin/MonkeyCode/backend/pkg/installer/deploy"
)

type HostUpgrade struct{}

func (h *HostUpgrade) Name() string { return "宿主机升级" }

func (h *HostUpgrade) Run(c *Context) error {
	cfg := loadHostConfig()
	values, err := c.Reporter.AskForm([]FormField{
		{Label: "安装目录", Default: HostDefaultInstallDir, Validate: validateAbsPath},
	})
	if err != nil {
		return err
	}
	workDir := values[0]
	ok, err := c.Reporter.AskConfirm(fmt.Sprintf("确认升级 %s ?", workDir))
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("已取消升级")
	}

	hostURL, err := cfg.hostBundleURL()
	if err != nil {
		return err
	}
	bundleFile := filepath.Join(os.TempDir(), "monkeycode-host-upgrade.tgz")
	c.Reporter.SetStep("下载宿主机升级包...", "下一步: 升级宿主机")
	c.Reporter.StartProgress(filepath.Base(bundleFile))
	err = deploy.DownloadFile(context.Background(), hostURL, bundleFile, hostProgress(c.Reporter))
	c.Reporter.EndProgress()
	if err != nil {
		return fmt.Errorf("下载宿主机升级包失败: %w", err)
	}

	c.Reporter.SetStep("升级宿主机服务...", "下一步: 完成")
	plan := deploy.HostUpgradePlan{
		WorkDir:    workDir,
		BundleFile: bundleFile,
		Token:      os.Getenv(envHostToken),
		GrpcURL:    os.Getenv(envTaskflowGRPC),
	}
	if err := deploy.UpgradeHost(context.Background(), wrapRunner(c.Runner, c.Reporter, "      "), plan); err != nil {
		return fmt.Errorf("升级宿主机失败: %w", err)
	}
	c.Log("✓ 宿主机升级完成")
	return nil
}
