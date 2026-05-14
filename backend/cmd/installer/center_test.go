package main

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/backend/pkg/installer"
)

func TestCenterPlanUsesSelectedInstallDirAndAccessHost(t *testing.T) {
	plan := centerPlan("/data/monkeycode-ai", "192.168.1.10")

	if plan.WorkDir != "/data/monkeycode-ai" {
		t.Fatalf("WorkDir = %q", plan.WorkDir)
	}
	if plan.ComposeFile != "/data/monkeycode-ai/docker-compose.yml" {
		t.Fatalf("ComposeFile = %q", plan.ComposeFile)
	}
	if plan.EnvFile != "/data/monkeycode-ai/.env" {
		t.Fatalf("EnvFile = %q", plan.EnvFile)
	}
	if plan.TLS.Host != "192.168.1.10" {
		t.Fatalf("TLS.Host = %q", plan.TLS.Host)
	}
	if plan.TLS.CertFile != "/data/monkeycode-ai/tls/server.crt" {
		t.Fatalf("TLS.CertFile = %q", plan.TLS.CertFile)
	}
}

func TestCenterDockerPlanUsesLocalBundle(t *testing.T) {
	plan := centerDockerPlan("/pkg")

	if plan.BundleFile != filepath.Join("/pkg", "docker.tgz") {
		t.Fatalf("BundleFile = %q", plan.BundleFile)
	}
	if plan.WorkDir != "/tmp/monkeycode-installer" {
		t.Fatalf("WorkDir = %q", plan.WorkDir)
	}
}

func TestCenterModelDefaults(t *testing.T) {
	m := newCenterModel(t.Context())

	if m.installDir != defaultCenterInstallDir {
		t.Fatalf("installDir = %q", m.installDir)
	}
	if m.nginxPort != "80" {
		t.Fatalf("nginxPort = %q", m.nginxPort)
	}
	if m.teamName != "MonkeyCode" {
		t.Fatalf("teamName = %q", m.teamName)
	}
	if m.runner == nil {
		t.Fatal("runner is nil")
	}
}

func TestCenterEnvInputUsesModelValues(t *testing.T) {
	m := newCenterModel(t.Context())
	m.accessHost = "example.com"
	m.nginxPort = "8080"
	m.teamEmail = "admin@example.com"
	m.teamName = "Example"
	m.teamPassword = "secret"

	input := m.centerEnvInput()

	if input.AccessHost != "example.com" {
		t.Fatalf("AccessHost = %q", input.AccessHost)
	}
	if input.NginxPort != "8080" {
		t.Fatalf("NginxPort = %q", input.NginxPort)
	}
	if input.TeamEmail != "admin@example.com" {
		t.Fatalf("TeamEmail = %q", input.TeamEmail)
	}
	if input.TeamName != "Example" {
		t.Fatalf("TeamName = %q", input.TeamName)
	}
	if input.TeamPassword != "secret" {
		t.Fatalf("TeamPassword = %q", input.TeamPassword)
	}
}

func TestCenterSuccessViewPrintsAccessAndAdmin(t *testing.T) {
	m := newCenterModel(t.Context())
	m.step = centerStepDone
	m.action = "安装中心端"
	m.result = centerInstallResult{
		URL:           "http://example.com:8080",
		AdminEmail:    "admin@example.com",
		AdminPassword: "secret",
	}

	view := m.View()

	for _, want := range []string{"http://example.com:8080", "admin@example.com", "secret"} {
		if !strings.Contains(view, want) {
			t.Fatalf("view missing %q: %q", want, view)
		}
	}
}

var _ = installer.CenterInstallPlan{}
