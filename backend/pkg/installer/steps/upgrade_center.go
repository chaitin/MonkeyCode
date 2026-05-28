package steps

import (
	"context"
	"fmt"
	"path/filepath"

	"github.com/chaitin/MonkeyCode/backend/pkg/installer/deploy"
)

type CenterUpgrade struct{}

func (s *CenterUpgrade) Name() string { return "中心端升级" }

func (s *CenterUpgrade) Run(c *Context) error {
	pkgDir, err := packageDir()
	if err != nil {
		return err
	}
	values, err := c.Reporter.AskForm([]FormField{
		{Label: "安装目录", Default: "/data/monkeycode-ai", Validate: validateAbsPath},
	})
	if err != nil {
		return err
	}
	installDir := values[0]
	ok, err := c.Reporter.AskConfirm(fmt.Sprintf("确认升级 %s ?", installDir))
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("已取消升级")
	}

	c.Reporter.SetStep("升级中心端...", "下一步: 完成")
	backupDir := filepath.Join(installDir, ".monkeycode", "backups")
	plan := deploy.CenterUpgradePlan{
		InstallDir: installDir,
		PackageDir: pkgDir,
		BackupDir:  backupDir,
	}
	if err := deploy.UpgradeCenter(context.Background(), wrapRunner(c.Runner, c.Reporter, "      "), plan); err != nil {
		return fmt.Errorf("升级中心端失败: %w", err)
	}
	c.Log("✓ 中心端升级完成，快照保留在 %s", backupDir)
	return nil
}

type CenterRollback struct{}

func (s *CenterRollback) Name() string { return "中心端回滚" }

func (s *CenterRollback) Run(c *Context) error {
	values, err := c.Reporter.AskForm([]FormField{
		{Label: "安装目录", Default: "/data/monkeycode-ai", Validate: validateAbsPath},
		{Label: "快照目录", Default: "", Validate: validateAbsPath},
	})
	if err != nil {
		return err
	}
	ok, err := c.Reporter.AskConfirm(fmt.Sprintf("确认回滚 %s ?", values[0]))
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("已取消回滚")
	}

	c.Reporter.SetStep("回滚中心端...", "下一步: 完成")
	if err := deploy.RollbackCenter(context.Background(), wrapRunner(c.Runner, c.Reporter, "      "), values[0], deploy.CenterSnapshot{Path: values[1]}); err != nil {
		return fmt.Errorf("回滚中心端失败: %w", err)
	}
	c.Log("✓ 中心端回滚完成")
	return nil
}
