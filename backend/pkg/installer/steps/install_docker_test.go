package steps

import (
	"strings"
	"testing"
)

func mockPackageDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	old := packageDir
	packageDir = func() (string, error) { return dir, nil }
	t.Cleanup(func() { packageDir = old })
	return dir
}

func TestInstallDockerSkipsWhenReady(t *testing.T) {
	ctx, _, _ := ctxWithFakeReporter()
	ctx.DockerStatus.DockerInstalled = true
	ctx.DockerStatus.ComposeInstalled = true
	ctx.DockerStatus.DaemonRunning = true
	if err := (&InstallDocker{}).Run(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestInstallDockerMissingBundle(t *testing.T) {
	mockPackageDir(t)
	ctx, _, _ := ctxWithFakeReporter()
	err := (&InstallDocker{}).Run(ctx)
	if err == nil || !strings.Contains(err.Error(), "找不到离线包") {
		t.Fatalf("expect missing bundle error, got %v", err)
	}
}
