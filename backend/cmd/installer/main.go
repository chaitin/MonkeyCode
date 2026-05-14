package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"

	"github.com/charmbracelet/bubbles/progress"
	"github.com/charmbracelet/bubbles/spinner"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/huh"
	"github.com/charmbracelet/lipgloss"

	"github.com/chaitin/MonkeyCode/backend/pkg/installer"
)

var (
	titleStyle = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("212"))
	okStyle    = lipgloss.NewStyle().Foreground(lipgloss.Color("42"))
	warnStyle  = lipgloss.NewStyle().Foreground(lipgloss.Color("214"))
	errStyle   = lipgloss.NewStyle().Foreground(lipgloss.Color("196"))
)

type step int

const (
	stepCheck step = iota
	stepHome
	stepInstallDir
	stepConfirmDocker
	stepUninstallDir
	stepConfirmUninstall
	stepRun
	stepDone
)

const defaultInstallDir = "/data/monkeycode_runner"

type homeAction string

const (
	homeActionInstall   homeAction = "install"
	homeActionUninstall homeAction = "uninstall"
	homeActionExit      homeAction = "exit"
)

type installerMode string

const (
	modeCenter installerMode = "center"
	modeHost   installerMode = "host"
)

type model struct {
	ctx           context.Context
	runner        installer.Runner
	spinner       spinner.Model
	prog          progress.Model
	config        installConfig
	step          step
	status        installer.DockerStatus
	form          *huh.Form
	home          homeAction
	installDir    string
	installDocker bool
	uninstallHost bool
	action        string
	detail        string
	err           error
	sender        *programSender
}

type statusMsg installer.DockerStatus
type actionDoneMsg struct{ err error }
type progressMsg struct {
	label    string
	progress installer.DownloadProgress
}

type programSender struct {
	program *tea.Program
}

func (s *programSender) Send(msg tea.Msg) {
	if s.program != nil {
		s.program.Send(msg)
	}
}

func newModel(ctx context.Context) *model {
	sp := spinner.New()
	sp.Spinner = spinner.Dot
	return &model{
		ctx:     ctx,
		runner:  installer.CommandRunner{},
		spinner: sp,
		prog:    progress.New(progress.WithWidth(46)),
		config:  loadConfig(),
		step:    stepCheck,
		sender:  &programSender{},
	}
}

func parseMode(args []string) (installerMode, error) {
	if len(args) <= 1 {
		return modeHost, nil
	}
	switch installerMode(args[1]) {
	case modeCenter:
		return modeCenter, nil
	case modeHost:
		return modeHost, nil
	default:
		return "", fmt.Errorf("unknown installer mode %q, expected center or host", args[1])
	}
}

func (m *model) setProgram(p *tea.Program) {
	m.sender.program = p
}

func (m *model) Init() tea.Cmd {
	return tea.Batch(m.spinner.Tick, m.checkDocker)
}

func (m *model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "ctrl+c":
			return m, tea.Quit
		}
	case statusMsg:
		m.status = installer.DockerStatus(msg)
		m.step = stepHome
		m.form = m.homeForm()
		return m, m.form.Init()
	case progressMsg:
		m.detail = msg.label
		if msg.progress.Total <= 0 {
			return m, nil
		}
		return m, m.prog.SetPercent(msg.progress.Percent())
	case actionDoneMsg:
		m.err = msg.err
		m.step = stepDone
		if msg.err == nil {
			return m, tea.Quit
		}
		return m, nil
	case spinner.TickMsg:
		var cmd tea.Cmd
		m.spinner, cmd = m.spinner.Update(msg)
		return m, cmd
	case progress.FrameMsg:
		pm, cmd := m.prog.Update(msg)
		m.prog = pm.(progress.Model)
		return m, cmd
	}
	if m.form != nil {
		var cmd tea.Cmd
		form, formCmd := m.form.Update(msg)
		m.form = form.(*huh.Form)
		cmd = formCmd
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

func (m *model) View() string {
	var b strings.Builder
	b.WriteString(titleStyle.Render("MonkeyCode 安装器"))
	b.WriteString("\n\n")

	switch m.step {
	case stepCheck:
		b.WriteString(m.spinner.View())
		b.WriteString(" 正在检测 Docker 环境...\n")
	case stepHome, stepInstallDir, stepConfirmDocker, stepUninstallDir, stepConfirmUninstall:
		b.WriteString(renderStatus(m.status))
		b.WriteString("\n")
		if m.form != nil {
			b.WriteString(m.form.View())
			b.WriteString("\n")
		}
	case stepRun:
		b.WriteString(m.spinner.View())
		b.WriteString(" " + m.action + "...\n")
		if m.detail != "" {
			b.WriteString(m.detail)
			b.WriteString("\n")
		}
		b.WriteString(m.prog.View())
		b.WriteString("\n")
	case stepDone:
		if m.err != nil {
			b.WriteString(errStyle.Render(m.action + "失败: " + m.err.Error()))
		} else {
			b.WriteString(okStyle.Render(m.action + "完成。"))
		}
		b.WriteString("\n")
	}
	return b.String()
}

func (m *model) checkDocker() tea.Msg {
	return statusMsg(installer.CheckDockerStatus(m.ctx, m.runner))
}

func (m *model) homeForm() *huh.Form {
	return huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[homeAction]().
				Title("请选择操作").
				Options(homeOptions()...).
				Value(&m.home),
		),
	)
}

func homeOptions() []huh.Option[homeAction] {
	return []huh.Option[homeAction]{
		huh.NewOption("安装", homeActionInstall),
		huh.NewOption("卸载", homeActionUninstall),
		huh.NewOption("退出", homeActionExit),
	}
}

func (m *model) installDirForm() *huh.Form {
	if strings.TrimSpace(m.installDir) == "" {
		m.installDir = defaultInstallDir
	}
	return huh.NewForm(
		huh.NewGroup(
			huh.NewInput().
				Title("安装目录").
				Description("宿主机服务文件、镜像包和 docker-compose.yml 将放在该目录。").
				Placeholder(defaultInstallDir).
				Value(&m.installDir).
				Validate(validateAbsPath),
		),
	)
}

func (m *model) confirmDockerForm() *huh.Form {
	return huh.NewForm(
		huh.NewGroup(
			huh.NewConfirm().
				Title("安装 Docker/Compose").
				Description("当前 Docker 环境不完整，将下载 Docker 安装包并安装静态二进制。").
				Affirmative("开始安装").
				Negative("取消").
				Value(&m.installDocker),
		),
	)
}

func (m *model) confirmUninstallForm() *huh.Form {
	return huh.NewForm(
		huh.NewGroup(
			huh.NewConfirm().
				Title("卸载宿主机").
				Description("将停止 MonkeyCode 宿主机服务并删除安装目录，不会卸载 Docker/Compose 或删除镜像。").
				Affirmative("确认卸载").
				Negative("取消").
				Value(&m.uninstallHost),
		),
	)
}

func (m *model) nextAfterForm() (tea.Model, tea.Cmd) {
	switch m.step {
	case stepHome:
		switch m.home {
		case homeActionInstall:
			m.action = "安装宿主机"
			m.detail = ""
			m.err = nil
			m.installDir = defaultInstallDir
			if !m.status.Ready() {
				m.step = stepConfirmDocker
				m.installDocker = true
				m.form = m.confirmDockerForm()
				return m, m.form.Init()
			}
			m.step = stepInstallDir
			m.form = m.installDirForm()
			return m, m.form.Init()
		case homeActionUninstall:
			m.action = "卸载宿主机"
			m.detail = ""
			m.err = nil
			m.installDir = defaultInstallDir
			m.step = stepUninstallDir
			m.form = m.installDirForm()
			return m, m.form.Init()
		case homeActionExit:
			return m, tea.Quit
		}
	case stepConfirmDocker:
		if !m.installDocker {
			m.step = stepDone
			m.err = fmt.Errorf("已取消安装 Docker/Compose")
			return m, nil
		}
		m.step = stepInstallDir
		m.form = m.installDirForm()
		return m, m.form.Init()
	case stepInstallDir:
		m.installDir = strings.TrimSpace(m.installDir)
		if m.installDir == "" {
			m.installDir = defaultInstallDir
		}
		m.step = stepRun
		m.detail = "准备安装流程"
		return m, m.installHostFlow
	case stepUninstallDir:
		m.installDir = strings.TrimSpace(m.installDir)
		if m.installDir == "" {
			m.installDir = defaultInstallDir
		}
		m.uninstallHost = false
		m.step = stepConfirmUninstall
		m.form = m.confirmUninstallForm()
		return m, m.form.Init()
	case stepConfirmUninstall:
		if !m.uninstallHost {
			m.step = stepDone
			m.err = fmt.Errorf("已取消卸载宿主机")
			return m, nil
		}
		m.step = stepRun
		m.detail = "准备卸载流程"
		return m, m.uninstallHostFlow
	}
	return m, nil
}

func (m *model) installHostFlow() tea.Msg {
	if !m.status.Ready() {
		plan, err := m.config.dockerPlan()
		if err != nil {
			return actionDoneMsg{err: err}
		}
		if err := installer.InstallDockerWithProgress(m.ctx, m.runner, plan, m.sendProgress("下载 Docker 安装包")); err != nil {
			return actionDoneMsg{err: err}
		}
		status := installer.CheckDockerStatus(m.ctx, m.runner)
		if !status.Ready() {
			return actionDoneMsg{err: fmt.Errorf("Docker 环境仍未就绪")}
		}
	}

	bundlePlan, err := m.config.hostBundlePlan(m.installDir)
	if err != nil {
		return actionDoneMsg{err: err}
	}
	if err := installer.PrepareHostBundleWithProgress(m.ctx, m.runner, bundlePlan, m.sendProgress("下载宿主机安装包")); err != nil {
		return actionDoneMsg{err: err}
	}
	return actionDoneMsg{err: installer.InstallHost(m.ctx, m.runner, hostPlan(m.installDir))}
}

func (m *model) uninstallHostFlow() tea.Msg {
	return actionDoneMsg{err: installer.UninstallHost(m.ctx, m.runner, hostPlan(m.installDir))}
}

func (m *model) sendProgress(label string) installer.ProgressFunc {
	return func(p installer.DownloadProgress) {
		m.sender.Send(progressMsg{label: label, progress: p})
	}
}

func renderStatus(status installer.DockerStatus) string {
	lines := []string{}
	if status.DockerInstalled {
		lines = append(lines, okStyle.Render("Docker: 已安装 "+status.DockerVersion))
	} else {
		lines = append(lines, errStyle.Render("Docker: 未安装"))
	}
	if status.ComposeInstalled {
		lines = append(lines, okStyle.Render("Docker Compose: 已安装 "+status.ComposeVersion))
	} else {
		lines = append(lines, errStyle.Render("Docker Compose: 未安装"))
	}
	if status.DaemonRunning {
		lines = append(lines, okStyle.Render("Docker Daemon: 运行中 "+status.DaemonVersion))
	} else {
		lines = append(lines, warnStyle.Render("Docker Daemon: 未运行"))
	}
	return strings.Join(lines, "\n")
}

func hostPlan(workDir string) installer.HostInstallPlan {
	return installer.HostInstallPlan{
		WorkDir:     workDir,
		ComposeFile: filepath.Join(workDir, "docker-compose.yml"),
		EnvFile:     filepath.Join(workDir, ".env"),
		Token:       os.Getenv("MCAI_HOST_TOKEN"),
		GrpcURL:     os.Getenv("MCAI_TASKFLOW_GRPC_URL"),
		Images:      scanImages(filepath.Join(workDir, "images")),
	}
}

type installConfig struct {
	BaseURL          string
	DockerBundlePath string
	HostBundlePath   string
}

func loadConfig() installConfig {
	arch := installerArch()
	return installConfig{
		BaseURL:          valueOrDefault(os.Getenv("MCAI_BASE_URL"), "http://localhost"),
		DockerBundlePath: valueOrDefault(os.Getenv("MCAI_DOCKER_BUNDLE_PATH"), "/static/installer/"+arch+"/docker.tgz"),
		HostBundlePath:   valueOrDefault(os.Getenv("MCAI_HOST_BUNDLE_PATH"), "/static/installer/"+arch+"/host.tgz"),
	}
}

func installerArch() string {
	switch runtime.GOARCH {
	case "arm64":
		return "aarch64"
	default:
		return "x86_64"
	}
}

func (c installConfig) dockerPlan() (installer.DockerInstallPlan, error) {
	bundleURL, err := installer.BundleURL(c.BaseURL, c.DockerBundlePath)
	if err != nil {
		return installer.DockerInstallPlan{}, err
	}
	return installer.DockerInstallPlan{
		BundleURL:  bundleURL,
		WorkDir:    "/tmp/monkeycode-installer",
		BundleFile: "/tmp/monkeycode-installer/docker.tgz",
	}, nil
}

func (c installConfig) hostBundlePlan(workDir string) (installer.HostBundlePlan, error) {
	bundleURL, err := installer.BundleURL(c.BaseURL, c.HostBundlePath)
	if err != nil {
		return installer.HostBundlePlan{}, err
	}
	return installer.HostBundlePlan{
		BundleURL:  bundleURL,
		BundleFile: "/tmp/monkeycode-host.tgz",
		WorkDir:    workDir,
	}, nil
}

func valueOrDefault(value, fallback string) string {
	if value != "" {
		return value
	}
	return fallback
}

func scanImages(dir string) []installer.ImageArchive {
	patterns := []struct {
		glob       string
		compressed bool
	}{
		{filepath.Join(dir, "*.tar"), false},
		{filepath.Join(dir, "*.tar.gz"), true},
		{filepath.Join(dir, "*.tgz"), true},
	}
	images := []installer.ImageArchive{}
	for _, pattern := range patterns {
		matches, _ := filepath.Glob(pattern.glob)
		for _, match := range matches {
			if !isImageArchive(match) {
				continue
			}
			images = append(images, installer.ImageArchive{Path: match, Compressed: pattern.compressed})
		}
	}
	sort.Slice(images, func(i, j int) bool {
		return images[i].Path < images[j].Path
	})
	return images
}

func isImageArchive(file string) bool {
	base := filepath.Base(file)
	if strings.HasPrefix(base, ".") || strings.HasPrefix(base, "._") || base == ".DS_Store" {
		return false
	}
	info, err := os.Stat(file)
	if err != nil {
		return false
	}
	return !info.IsDir()
}

func main() {
	mode, err := parseMode(os.Args)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	var m tea.Model
	switch mode {
	case modeCenter:
		m = newCenterModel(context.Background())
	case modeHost:
		m = newModel(context.Background())
	}

	p := tea.NewProgram(m)
	if senderAware, ok := m.(interface{ setProgram(*tea.Program) }); ok {
		senderAware.setProgram(p)
	}
	if _, err := p.Run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
