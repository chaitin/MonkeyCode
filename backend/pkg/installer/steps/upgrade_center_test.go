package steps

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCenterUpgradeUsesInstallDirAndPackageDir(t *testing.T) {
	ctx, r, _ := ctxWithFakeReporter()
	installDir := t.TempDir()
	pkgDir := t.TempDir()
	writeStepCenterInstall(t, installDir)
	writeStepCenterPackage(t, pkgDir)
	oldPackageDir := packageDir
	packageDir = func() (string, error) { return pkgDir, nil }
	defer func() { packageDir = oldPackageDir }()
	r.FormAns = [][]string{{installDir}}
	r.ConfirmAns = []bool{true}

	if err := (&CenterUpgrade{}).Run(ctx); err != nil {
		t.Fatal(err)
	}

	got, err := os.ReadFile(filepath.Join(installDir, ".env"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(got), "BACKEND_IMAGE=backend:new") {
		t.Fatalf(".env was not upgraded:\n%s", got)
	}
}

func TestCenterRollbackPassesSnapshotDir(t *testing.T) {
	ctx, r, _ := ctxWithFakeReporter()
	installDir := t.TempDir()
	snapDir := filepath.Join(t.TempDir(), "snap")
	writeStepCenterInstall(t, installDir)
	if err := os.MkdirAll(snapDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(snapDir, ".env"), []byte("BACKEND_IMAGE=backend:old\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	r.FormAns = [][]string{{installDir, snapDir}}
	r.ConfirmAns = []bool{true}

	if err := (&CenterRollback{}).Run(ctx); err != nil {
		t.Fatal(err)
	}

	got, err := os.ReadFile(filepath.Join(installDir, ".env"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "BACKEND_IMAGE=backend:old\n" {
		t.Fatalf(".env = %q", got)
	}
}

func writeStepCenterInstall(t *testing.T, dir string) {
	t.Helper()
	for _, sub := range []string{"data/postgres", "static", "images"} {
		if err := os.MkdirAll(filepath.Join(dir, sub), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(dir, ".env"), []byte("BACKEND_IMAGE=backend:old\nPOSTGRES_PASSWORD=old\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "docker-compose.yml"), []byte("services: {}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
}

func writeStepCenterPackage(t *testing.T, dir string) {
	t.Helper()
	for _, sub := range []string{"images", "static/installer/x86_64", "static/installer/aarch64"} {
		if err := os.MkdirAll(filepath.Join(dir, sub), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	files := map[string]string{
		".env.example":                      "BACKEND_IMAGE=backend:new\nPOSTGRES_PASSWORD=\n",
		"docker-compose.yml":                "services: {}\n",
		"images/backend.tar.gz":             "image",
		"static/installer/x86_64/host.tgz":  "host-x86",
		"static/installer/aarch64/host.tgz": "host-arm",
	}
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	manifest := `{
		"version":"2026.05.27",
		"commit":"new",
		"arch":"amd64",
		"images":[{"name":"backend","archive":"images/backend.tar.gz","image":"backend:new"}],
		"host_bundles":[
			{"arch":"x86_64","path":"static/installer/x86_64/host.tgz"},
			{"arch":"aarch64","path":"static/installer/aarch64/host.tgz"}
		]
	}`
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), []byte(manifest), 0o644); err != nil {
		t.Fatal(err)
	}
}
