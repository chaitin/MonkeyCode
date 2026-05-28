package deploy

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestUpgradeCenterStopsBackupsLoadsAndStarts(t *testing.T) {
	dir := t.TempDir()
	pkg := t.TempDir()
	writeMinimalCenterInstall(t, dir)
	writeMinimalPackage(t, pkg)
	r := &FakeRunner{}
	plan := CenterUpgradePlan{
		InstallDir: dir,
		PackageDir: pkg,
		BackupDir:  filepath.Join(dir, ".monkeycode", "backups", "snap"),
	}

	if err := UpgradeCenter(context.Background(), r, plan); err != nil {
		t.Fatal(err)
	}

	calls := strings.Join(r.Calls, "\n")
	for _, want := range []string{
		"docker compose -f " + filepath.Join(dir, "docker-compose.yml") + " --env-file " + filepath.Join(dir, ".env") + " stop backend frontend taskflow preview ingress",
		"docker compose -f " + filepath.Join(dir, "docker-compose.yml") + " --env-file " + filepath.Join(dir, ".env") + " down",
		"docker compose -f " + filepath.Join(dir, "docker-compose.yml") + " --env-file " + filepath.Join(dir, ".env") + " up -d",
	} {
		if !strings.Contains(calls, want) {
			t.Fatalf("calls missing %q:\n%s", want, calls)
		}
	}
}

func writeMinimalCenterInstall(t *testing.T, dir string) {
	t.Helper()
	for _, sub := range []string{"data/postgres", "data/redis", "data/clickhouse", "data/rustfs", "static", "images"} {
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

func writeMinimalPackage(t *testing.T, dir string) {
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
