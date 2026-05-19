package steps

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/chaitin/MonkeyCode/backend/pkg/installer/deploy"
)

const (
	HostDefaultInstallDir = "/data/monkeycode_runner"

	hostDockerInstallWorkDir = "/tmp/monkeycode_runner"
	hostDockerBundleFile     = "/tmp/monkeycode_runner/docker.tgz"
	hostBundleFile           = "/tmp/monkeycode-host.tgz"

	envBaseURL          = "MCAI_BASE_URL"
	envHostBundlePath   = "MCAI_HOST_BUNDLE_PATH"
	envDockerBundlePath = "MCAI_DOCKER_BUNDLE_PATH"
	envHostToken        = "MCAI_HOST_TOKEN"
	envTaskflowGRPC     = "MCAI_TASKFLOW_GRPC_URL"
)

// HostInstall：宿主机模式安装
type HostInstall struct{}

func (h *HostInstall) Name() string { return "宿主机安装" }

func (h *HostInstall) Run(c *Context) error {
	bg := context.Background()
	logRunner := wrapRunner(c.Runner, c.Reporter, "      ")

	cfg := loadHostConfig()

	if !c.DockerStatus.Ready() {
		c.Reporter.SetStep("下载并安装 Docker...", "下一步: 收集安装参数")
		dockerURL, err := cfg.dockerBundleURL()
		if err != nil {
			return fmt.Errorf("解析 Docker 包地址失败: %w", err)
		}
		c.Log("下载地址: %s", dockerURL)
		plan := deploy.DockerInstallPlan{
			WorkDir:    hostDockerInstallWorkDir,
			BundleFile: hostDockerBundleFile,
			BundleURL:  dockerURL,
		}
		c.Reporter.StartProgress(filepath.Base(hostDockerBundleFile))
		err = deploy.InstallDockerWithProgress(bg, logRunner, plan, hostProgress(c.Reporter))
		c.Reporter.EndProgress()
		if err != nil {
			return fmt.Errorf("安装 Docker 失败: %w", err)
		}
		status := deploy.CheckDockerStatus(bg, c.Runner)
		c.DockerStatus = status
		if !status.Ready() {
			return fmt.Errorf("Docker 环境仍未就绪")
		}
		c.Log("✓ Docker 安装完成")
	} else {
		c.Log("⊘ Docker 环境完整，跳过此步骤")
	}

	c.Reporter.SetStep("收集安装参数...", "下一步: 下载安装包")
	values, err := c.Reporter.AskForm([]FormField{
		{Label: "安装目录", Default: HostDefaultInstallDir, Help: "宿主机服务文件、镜像包和 docker-compose.yml 将放在该目录", Validate: validateAbsPath},
	})
	if err != nil {
		return err
	}
	workDir := values[0]
	c.Log("安装目录: %s", workDir)

	c.Reporter.SetStep("下载宿主机安装包...", "下一步: 加载镜像")
	hostURL, err := cfg.hostBundleURL()
	if err != nil {
		return fmt.Errorf("解析宿主机包地址失败: %w", err)
	}
	c.Log("下载地址: %s", hostURL)
	bundlePlan := deploy.HostBundlePlan{
		BundleURL:  hostURL,
		BundleFile: hostBundleFile,
		WorkDir:    workDir,
	}
	c.Reporter.StartProgress(filepath.Base(hostBundleFile))
	err = deploy.PrepareHostBundleWithProgress(bg, logRunner, bundlePlan, hostProgress(c.Reporter))
	c.Reporter.EndProgress()
	if err != nil {
		return fmt.Errorf("准备宿主机安装包失败: %w", err)
	}
	c.Log("✓ 安装包已就绪")

	c.Reporter.SetStep("启动宿主机服务...", "下一步: 完成")
	images, err := deploy.ScanImages(filepath.Join(workDir, "images"))
	if err != nil {
		return fmt.Errorf("扫描镜像失败: %w", err)
	}
	c.Log("发现 %d 个镜像归档", len(images))

	plan := deploy.HostInstallPlan{
		WorkDir:     workDir,
		ComposeFile: filepath.Join(workDir, "docker-compose.yml"),
		EnvFile:     filepath.Join(workDir, ".env"),
		Token:       os.Getenv(envHostToken),
		GrpcURL:     os.Getenv(envTaskflowGRPC),
		Images:      images,
	}
	if err := deploy.InstallHost(bg, logRunner, plan); err != nil {
		return fmt.Errorf("启动宿主机服务失败: %w", err)
	}
	c.Log("✓ 服务已启动")

	c.Input.InstallDir = workDir
	return nil
}

// HostUninstall：宿主机模式卸载
type HostUninstall struct{}

func (h *HostUninstall) Name() string { return "宿主机卸载" }

func (h *HostUninstall) Run(c *Context) error {
	bg := context.Background()
	logRunner := wrapRunner(c.Runner, c.Reporter, "      ")

	c.Reporter.SetStep("收集卸载参数...", "下一步: 卸载服务")
	values, err := c.Reporter.AskForm([]FormField{
		{Label: "安装目录", Default: HostDefaultInstallDir, Help: "将停止该目录下的服务并删除目录", Validate: validateAbsPath},
	})
	if err != nil {
		return err
	}
	workDir := values[0]

	ok, err := c.Reporter.AskConfirm(fmt.Sprintf("确认卸载 %s ?", workDir))
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("已取消卸载")
	}

	c.Reporter.SetStep("卸载宿主机服务...", "下一步: 完成")
	plan := deploy.HostInstallPlan{
		WorkDir:     workDir,
		ComposeFile: filepath.Join(workDir, "docker-compose.yml"),
		EnvFile:     filepath.Join(workDir, ".env"),
	}
	if err := deploy.UninstallHost(bg, logRunner, plan); err != nil {
		return fmt.Errorf("卸载失败: %w", err)
	}
	c.Log("✓ 已卸载")

	return nil
}

type hostConfig struct {
	BaseURL          string
	DockerBundlePath string
	HostBundlePath   string
}

func loadHostConfig() hostConfig {
	arch := deploy.InstallerArch()
	return hostConfig{
		BaseURL:          firstNonEmpty(os.Getenv(envBaseURL), "http://localhost"),
		DockerBundlePath: firstNonEmpty(os.Getenv(envDockerBundlePath), "/static/installer/"+arch+"/docker.tgz"),
		HostBundlePath:   firstNonEmpty(os.Getenv(envHostBundlePath), "/static/installer/"+arch+"/host.tgz"),
	}
}

func (c hostConfig) dockerBundleURL() (string, error) {
	return deploy.BundleURL(c.BaseURL, c.DockerBundlePath)
}

func (c hostConfig) hostBundleURL() (string, error) {
	return deploy.BundleURL(c.BaseURL, c.HostBundlePath)
}

func hostProgress(r Reporter) deploy.ProgressFunc {
	return func(p deploy.DownloadProgress) {
		r.UpdateProgress(p.Downloaded, p.Total)
	}
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
