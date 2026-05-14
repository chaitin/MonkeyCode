package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/chaitin/MonkeyCode/backend/pkg/installer"
)

func TestInstallerModeDefaultsToHost(t *testing.T) {
	mode, err := parseMode([]string{"installer"})
	if err != nil {
		t.Fatal(err)
	}
	if mode != modeHost {
		t.Fatalf("mode = %q", mode)
	}
}

func TestInstallerModeAcceptsCenterAndHost(t *testing.T) {
	for _, tc := range []struct {
		args []string
		want installerMode
	}{
		{[]string{"installer", "center"}, modeCenter},
		{[]string{"installer", "host"}, modeHost},
	} {
		got, err := parseMode(tc.args)
		if err != nil {
			t.Fatalf("parseMode(%v): %v", tc.args, err)
		}
		if got != tc.want {
			t.Fatalf("parseMode(%v) = %q, want %q", tc.args, got, tc.want)
		}
	}
}

func TestInstallerModeRejectsUnknownMode(t *testing.T) {
	_, err := parseMode([]string{"installer", "agent"})
	if err == nil {
		t.Fatal("expected error")
	}
	if !strings.Contains(err.Error(), "unknown installer mode") {
		t.Fatalf("err = %v", err)
	}
}

func TestHomeOptionsOnlyInstallAndExit(t *testing.T) {
	options := homeOptions()

	if len(options) != 3 {
		t.Fatalf("len(options) = %d", len(options))
	}
	if options[0].Key != "安装" || options[0].Value != homeActionInstall {
		t.Fatalf("first option = %#v", options[0])
	}
	if options[1].Key != "卸载" || options[1].Value != homeActionUninstall {
		t.Fatalf("second option = %#v", options[1])
	}
	if options[2].Key != "退出" || options[2].Value != homeActionExit {
		t.Fatalf("third option = %#v", options[2])
	}
}

func TestHomeSelectionExitsOnSingleSubmit(t *testing.T) {
	m := newModel(t.Context())
	m.status = installer.DockerStatus{DockerInstalled: true, ComposeInstalled: true, DaemonRunning: true}
	m.step = stepHome
	m.form = m.homeForm()
	_ = m.form.Init()

	updated, cmd := runUpdate(m, tea.KeyMsg{Type: tea.KeyDown})
	updated, cmd = runUpdate(updated, tea.KeyMsg{Type: tea.KeyDown})
	updated, cmd = runUpdate(updated, tea.KeyMsg{Type: tea.KeyEnter})

	if cmd == nil {
		t.Fatal("expected quit command")
	}
	if msg := cmd(); msg != tea.Quit() {
		t.Fatalf("cmd() = %#v", msg)
	}
}

func TestHomeSelectionStartsUninstallOnSingleSubmit(t *testing.T) {
	m := newModel(t.Context())
	m.status = installer.DockerStatus{DockerInstalled: true, ComposeInstalled: true, DaemonRunning: true}
	m.step = stepHome
	m.form = m.homeForm()
	_ = m.form.Init()

	updated, _ := runUpdate(m, tea.KeyMsg{Type: tea.KeyDown})
	updated, _ = runUpdate(updated, tea.KeyMsg{Type: tea.KeyEnter})
	got := updated.(*model)

	if got.step != stepUninstallDir {
		t.Fatalf("step = %v", got.step)
	}
	if got.form == nil {
		t.Fatal("form is nil")
	}
}

func TestUninstallDirSelectionAsksForConfirmation(t *testing.T) {
	m := newModel(t.Context())
	m.step = stepUninstallDir
	m.installDir = "/data/monkeycode_runner"
	m.form = m.installDirForm()
	_ = m.form.Init()

	updated, _ := runUpdate(m, tea.KeyMsg{Type: tea.KeyEnter})
	got := updated.(*model)

	if got.step != stepConfirmUninstall {
		t.Fatalf("step = %v", got.step)
	}
	if got.form == nil {
		t.Fatal("form is nil")
	}
	if got.installDir != "/data/monkeycode_runner" {
		t.Fatalf("installDir = %q", got.installDir)
	}
}

func TestHomeSelectionStartsInstallOnSingleSubmit(t *testing.T) {
	m := newModel(t.Context())
	m.status = installer.DockerStatus{DockerInstalled: true, ComposeInstalled: true, DaemonRunning: true}
	m.step = stepHome
	m.form = m.homeForm()
	_ = m.form.Init()

	updated, _ := runUpdate(m, tea.KeyMsg{Type: tea.KeyEnter})
	got := updated.(*model)

	if got.step != stepInstallDir {
		t.Fatalf("step = %v", got.step)
	}
	if got.form == nil {
		t.Fatal("form is nil")
	}
}

func TestInstallSuccessQuits(t *testing.T) {
	m := newModel(t.Context())
	m.step = stepRun
	m.action = "安装宿主机"

	_, cmd := m.Update(actionDoneMsg{})

	if cmd == nil {
		t.Fatal("expected quit command")
	}
	if msg := cmd(); msg != tea.Quit() {
		t.Fatalf("cmd() = %#v", msg)
	}
}

func TestInstallFailureStaysOnDone(t *testing.T) {
	m := newModel(t.Context())
	m.step = stepRun
	m.action = "安装宿主机"
	err := os.ErrNotExist

	updated, cmd := m.Update(actionDoneMsg{err: err})
	got := updated.(*model)

	if cmd != nil {
		t.Fatal("expected no quit command")
	}
	if got.step != stepDone {
		t.Fatalf("step = %v", got.step)
	}
	if got.err != err {
		t.Fatalf("err = %v", got.err)
	}
}

func runUpdate(m tea.Model, msg tea.Msg) (tea.Model, tea.Cmd) {
	updated, cmd := m.Update(msg)
	for cmd != nil {
		next := cmd()
		if next == tea.Quit() {
			return updated, cmd
		}
		updated, cmd = updated.Update(next)
	}
	return updated, nil
}

func TestHostPlanUsesSelectedInstallDir(t *testing.T) {
	plan := hostPlan("/data/monkeycode_runner")

	if plan.WorkDir != "/data/monkeycode_runner" {
		t.Fatalf("WorkDir = %q", plan.WorkDir)
	}
	if plan.ComposeFile != "/data/monkeycode_runner/docker-compose.yml" {
		t.Fatalf("ComposeFile = %q", plan.ComposeFile)
	}
	if plan.EnvFile != "/data/monkeycode_runner/.env" {
		t.Fatalf("EnvFile = %q", plan.EnvFile)
	}
}

func TestHostBundlePlanUsesSelectedInstallDir(t *testing.T) {
	cfg := installConfig{
		BaseURL:        "http://server",
		HostBundlePath: "/static/installer/x86_64/host.tgz",
	}

	plan, err := cfg.hostBundlePlan("/data/monkeycode_runner")
	if err != nil {
		t.Fatal(err)
	}

	if plan.WorkDir != "/data/monkeycode_runner" {
		t.Fatalf("WorkDir = %q", plan.WorkDir)
	}
	if plan.BundleFile != filepath.Join("/tmp", "monkeycode-host.tgz") {
		t.Fatalf("BundleFile = %q", plan.BundleFile)
	}
}

func TestScanImagesSkipsMacOSMetadataFiles(t *testing.T) {
	dir := t.TempDir()
	imageDir := filepath.Join(dir, "images")
	if err := os.Mkdir(imageDir, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"orchestrator.tgz", "._orchestrator.tgz", ".DS_Store", ".hidden.tgz"} {
		if err := os.WriteFile(filepath.Join(imageDir, name), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	images := scanImages(imageDir)

	if len(images) != 1 {
		t.Fatalf("len(images) = %d, images=%#v", len(images), images)
	}
	if images[0].Path != filepath.Join(imageDir, "orchestrator.tgz") {
		t.Fatalf("image path = %q", images[0].Path)
	}
	if !images[0].Compressed {
		t.Fatal("image should be compressed")
	}
}
