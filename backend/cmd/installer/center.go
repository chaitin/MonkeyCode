package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/charmbracelet/bubbles/spinner"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/huh"

	"github.com/chaitin/MonkeyCode/backend/pkg/installer"
)

const defaultCenterInstallDir = "/data/monkeycode-ai"

type centerStep int

const (
	centerStepCheck centerStep = iota
	centerStepForm
	centerStepConfirmDocker
	centerStepRun
	centerStepDone
)

type centerModel struct {
	ctx           context.Context
	runner        installer.Runner
	spinner       spinner.Model
	step          centerStep
	status        installer.DockerStatus
	form          *huh.Form
	installDir    string
	accessHost    string
	nginxPort     string
	teamEmail     string
	teamName      string
	teamPassword  string
	installDocker bool
	action        string
	err           error
	result        centerInstallResult
}

type centerStatusMsg installer.DockerStatus
type centerDoneMsg struct {
	err    error
	result centerInstallResult
}

type centerInstallResult struct {
	URL           string
	AdminEmail    string
	AdminPassword string
}

func newCenterModel(ctx context.Context) *centerModel {
	sp := spinner.New()
	sp.Spinner = spinner.Dot
	return &centerModel{
		ctx:        ctx,
		runner:     installer.CommandRunner{},
		spinner:    sp,
		step:       centerStepCheck,
		installDir: defaultCenterInstallDir,
		nginxPort:  "80",
		teamName:   "MonkeyCode",
	}
}

func (m *centerModel) Init() tea.Cmd {
	return tea.Batch(m.spinner.Tick, m.checkDocker)
}

func (m *centerModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		if msg.String() == "ctrl+c" {
			return m, tea.Quit
		}
	case centerStatusMsg:
		m.status = installer.DockerStatus(msg)
		if !m.status.Ready() {
			m.step = centerStepConfirmDocker
			m.installDocker = true
			m.form = m.confirmDockerForm()
			return m, m.form.Init()
		}
		m.step = centerStepForm
		m.form = m.centerForm()
		return m, m.form.Init()
	case centerDoneMsg:
		m.err = msg.err
		m.result = msg.result
		m.step = centerStepDone
		if msg.err == nil {
			return m, nil
		}
		return m, nil
	case spinner.TickMsg:
		var cmd tea.Cmd
		m.spinner, cmd = m.spinner.Update(msg)
		return m, cmd
	}
	if m.form != nil {
		form, cmd := m.form.Update(msg)
		m.form = form.(*huh.Form)
		if m.form.State == huh.StateCompleted {
			m.form = nil
			return m.nextAfterForm()
		}
		if m.form.State == huh.StateAborted {
			return m, tea.Quit
		}
		return m, cmd
	}
	return m, nil
}

func (m *centerModel) View() string {
	var b strings.Builder
	b.WriteString(titleStyle.Render("MonkeyCode 中心端安装器"))
	b.WriteString("\n\n")
	switch m.step {
	case centerStepCheck:
		b.WriteString(m.spinner.View())
		b.WriteString(" 正在检测 Docker 环境...\n")
	case centerStepForm, centerStepConfirmDocker:
		b.WriteString(renderStatus(m.status))
		b.WriteString("\n")
		if m.form != nil {
			b.WriteString(m.form.View())
			b.WriteString("\n")
		}
	case centerStepRun:
		b.WriteString(m.spinner.View())
		b.WriteString(" " + m.action + "...\n")
	case centerStepDone:
		if m.err != nil {
			b.WriteString(errStyle.Render(m.action + "失败: " + m.err.Error()))
		} else {
			b.WriteString(okStyle.Render(m.action + "完成。"))
			if m.result.URL != "" {
				b.WriteString("\n\n")
				b.WriteString("访问地址: " + m.result.URL + "\n")
				b.WriteString("管理员账号: " + m.result.AdminEmail + "\n")
				b.WriteString("管理员密码: " + m.result.AdminPassword + "\n")
			}
		}
		b.WriteString("\n")
	}
	return b.String()
}

func (m *centerModel) checkDocker() tea.Msg {
	return centerStatusMsg(installer.CheckDockerStatus(m.ctx, m.runner))
}

func (m *centerModel) confirmDockerForm() *huh.Form {
	return huh.NewForm(huh.NewGroup(
		huh.NewConfirm().
			Title("安装 Docker/Compose").
			Description("当前 Docker 环境不完整，将使用离线包内 docker.tgz 安装静态二进制。").
			Affirmative("开始安装").
			Negative("取消").
			Value(&m.installDocker),
	))
}

func (m *centerModel) centerForm() *huh.Form {
	return huh.NewForm(huh.NewGroup(
		huh.NewInput().
			Title("中心端安装目录").
			Placeholder(defaultCenterInstallDir).
			Value(&m.installDir).
			Validate(validateAbsPath),
		huh.NewInput().
			Title("中心端访问地址").
			Description("请输入用户和宿主机能访问到的 IP 或域名。").
			Value(&m.accessHost).
			Validate(func(value string) error {
				if strings.TrimSpace(value) == "" {
					return fmt.Errorf("请输入中心端访问地址")
				}
				return nil
			}),
		huh.NewInput().
			Title("Nginx HTTP 端口").
			Value(&m.nginxPort).
			Validate(func(value string) error {
				if strings.TrimSpace(value) == "" {
					return fmt.Errorf("请输入 Nginx 端口")
				}
				return nil
			}),
		huh.NewInput().
			Title("管理员邮箱").
			Value(&m.teamEmail).
			Validate(func(value string) error {
				if strings.TrimSpace(value) == "" {
					return fmt.Errorf("请输入管理员邮箱")
				}
				return nil
			}),
		huh.NewInput().
			Title("团队名称").
			Value(&m.teamName),
		huh.NewInput().
			Title("管理员密码").
			Description("留空时自动生成随机密码。").
			Value(&m.teamPassword),
	))
}

func validateAbsPath(value string) error {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	if !filepath.IsAbs(strings.TrimSpace(value)) {
		return fmt.Errorf("请输入绝对路径")
	}
	return nil
}

func (m *centerModel) nextAfterForm() (tea.Model, tea.Cmd) {
	switch m.step {
	case centerStepConfirmDocker:
		if !m.installDocker {
			m.step = centerStepDone
			m.err = fmt.Errorf("已取消安装 Docker/Compose")
			return m, nil
		}
		m.step = centerStepForm
		m.form = m.centerForm()
		return m, m.form.Init()
	case centerStepForm:
		m.installDir = strings.TrimSpace(m.installDir)
		if m.installDir == "" {
			m.installDir = defaultCenterInstallDir
		}
		m.accessHost = strings.TrimSpace(m.accessHost)
		m.nginxPort = strings.TrimSpace(m.nginxPort)
		m.teamEmail = strings.TrimSpace(m.teamEmail)
		m.teamName = strings.TrimSpace(m.teamName)
		m.teamPassword = strings.TrimSpace(m.teamPassword)
		m.step = centerStepRun
		m.action = "安装中心端"
		return m, m.installCenterFlow
	}
	return m, nil
}

func (m *centerModel) installCenterFlow() tea.Msg {
	pkgDir := packageDir()
	if !m.status.Ready() {
		if err := installer.InstallDockerFromLocalBundle(m.ctx, m.runner, centerDockerPlan(pkgDir)); err != nil {
			return centerDoneMsg{err: err}
		}
		status := installer.CheckDockerStatus(m.ctx, m.runner)
		if !status.Ready() {
			return centerDoneMsg{err: fmt.Errorf("Docker 环境仍未就绪")}
		}
	}
	env, err := installer.NewCenterEnv(m.centerEnvInput())
	if err != nil {
		return centerDoneMsg{err: err}
	}
	if err := installer.PrepareCenterFiles(m.ctx, m.runner, installer.CenterFilesPlan{
		PackageDir: pkgDir,
		WorkDir:    m.installDir,
		Env:        env,
	}); err != nil {
		return centerDoneMsg{err: err}
	}
	plan := centerPlan(m.installDir, m.accessHost)
	if err := installer.GenerateSelfSignedTLS(plan.TLS); err != nil {
		return centerDoneMsg{err: err}
	}
	if err := installer.InstallCenter(m.ctx, m.runner, plan); err != nil {
		return centerDoneMsg{err: err}
	}
	return centerDoneMsg{result: centerInstallResult{
		URL:           centerAccessURL(env.AccessHost, env.NginxPort),
		AdminEmail:    env.TeamEmail,
		AdminPassword: env.TeamPassword,
	}}
}

func centerDockerPlan(packageDir string) installer.DockerInstallPlan {
	return installer.DockerInstallPlan{
		WorkDir:    "/tmp/monkeycode-installer",
		BundleFile: filepath.Join(packageDir, "docker.tgz"),
	}
}

func centerPlan(workDir, accessHost string) installer.CenterInstallPlan {
	return installer.CenterInstallPlan{
		WorkDir:     workDir,
		ComposeFile: filepath.Join(workDir, "docker-compose.yml"),
		EnvFile:     filepath.Join(workDir, ".env"),
		TLS: installer.TLSPlan{
			Host:     accessHost,
			CertFile: filepath.Join(workDir, "tls", "server.crt"),
			KeyFile:  filepath.Join(workDir, "tls", "server.key"),
		},
		Images: scanImages(filepath.Join(workDir, "images")),
	}
}

func (m *centerModel) centerEnvInput() installer.CenterEnvInput {
	return installer.CenterEnvInput{
		AccessHost:   m.accessHost,
		NginxPort:    m.nginxPort,
		TeamEmail:    m.teamEmail,
		TeamName:     m.teamName,
		TeamPassword: m.teamPassword,
	}
}

func centerAccessURL(host, port string) string {
	if port == "" || port == "80" {
		return "http://" + host
	}
	return "http://" + host + ":" + port
}

func packageDir() string {
	exe, err := os.Executable()
	if err != nil {
		return "."
	}
	return filepath.Dir(exe)
}
