package steps

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/chaitin/MonkeyCode/backend/pkg/installer/deploy"
)

type InstallService struct{}

func (s *InstallService) Name() string { return "服务端安装" }

func (s *InstallService) Run(c *Context) error {
	bg := context.Background()

	c.Reporter.SetStep("生成服务端环境配置...", "下一步: 复制安装文件")
	env, err := deploy.NewCenterEnv(c.Input)
	if err != nil {
		return fmt.Errorf("生成环境配置失败: %w", err)
	}
	c.Log("✓ 环境变量已生成")

	c.Reporter.SetStep("复制安装文件...", "下一步: 生成 TLS 证书")
	pkgDir, err := packageDir()
	if err != nil {
		return err
	}
	if err := assertCenterPackage(pkgDir); err != nil {
		return err
	}
	plan, err := deploy.PrepareCenterFiles(env.InstallDir, pkgDir, env)
	if err != nil {
		return err
	}
	c.Log("✓ 配置已生成 %s", plan.ComposeFile)

	c.Reporter.SetStep("生成 TLS 证书...", "下一步: 准备数据目录")
	plan.TLS = deploy.TLSPlan{
		Host:     c.Input.AccessHost,
		CertFile: filepath.Join(env.InstallDir, "tls", "server.crt"),
		KeyFile:  filepath.Join(env.InstallDir, "tls", "server.key"),
	}
	if err := deploy.GenerateSelfSignedTLS(plan.TLS); err != nil {
		return fmt.Errorf("生成 TLS 证书失败: %w", err)
	}
	c.Log("✓ TLS 证书已生成 %s", plan.TLS.CertFile)

	logRunner := wrapRunner(c.Runner, c.Reporter, "      ")

	c.Reporter.SetStep("准备数据目录...", "下一步: 加载镜像")
	if err := deploy.PrepareCenterDirs(bg, logRunner, env.InstallDir); err != nil {
		return fmt.Errorf("准备数据目录失败: %w", err)
	}
	c.Log("✓ 数据目录已准备")

	c.Reporter.SetStep("加载离线镜像...", "下一步: 启动服务")
	images, err := deploy.ScanImages(filepath.Join(env.InstallDir, "images"))
	if err != nil {
		return fmt.Errorf("扫描镜像失败: %w", err)
	}
	if len(images) == 0 {
		c.Log("⊘ 未发现离线镜像")
	} else {
		c.Log("发现 %d 个镜像归档", len(images))
		if err := deploy.LoadImages(bg, logRunner, images); err != nil {
			return fmt.Errorf("加载镜像失败: %w", err)
		}
		c.Log("✓ 所有镜像已加载")
	}
	plan.Images = images

	c.Reporter.SetStep("启动服务...", "下一步: 完成")
	if err := deploy.InstallCenter(bg, logRunner, plan); err != nil {
		return fmt.Errorf("启动服务失败: %w", err)
	}
	c.Log("✓ 服务已启动")

	c.Result = deploy.InstallResult{
		URL:           deploy.CenterAccessURL(c.Input.AccessHost, env.NginxPort),
		AdminEmail:    env.TeamEmail,
		AdminPassword: env.TeamPassword,
	}
	return nil
}

func assertCenterPackage(pkgDir string) error {
	must := []string{"docker-compose.yml", ".env.example"}
	for _, name := range must {
		if _, err := os.Stat(filepath.Join(pkgDir, name)); err != nil {
			return fmt.Errorf("找不到安装包文件 %s/%s: %w", pkgDir, name, err)
		}
	}
	return nil
}
