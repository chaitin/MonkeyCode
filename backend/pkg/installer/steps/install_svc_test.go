package steps

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const fakeCompose = `version: "3.8"
services:
  app:
    image: example/app:latest
`

const fakeEnv = `INSTALL_DIR=/data/monkeycode-ai
REMOTE_IP=
NGINX_PORT=80
POSTGRES_PASSWORD=
REDIS_PASSWORD=
CLICKHOUSE_PASSWORD=
RUSTFS_ACCESS_KEY=
RUSTFS_SECRET_KEY=
TEAM_EMAIL=
TEAM_NAME=MonkeyCode
TEAM_PASSWORD=
INIT_TEAM_IMAGE=
SUBNET_PREFIX=10.100.50
`

func writeFakePackage(t *testing.T) string {
	t.Helper()
	dir := mockPackageDir(t)
	if err := os.WriteFile(filepath.Join(dir, "docker-compose.yml"), []byte(fakeCompose), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, ".env.example"), []byte(fakeEnv), 0o644); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestInstallServiceWritesFiles(t *testing.T) {
	writeFakePackage(t)
	dir := t.TempDir()
	ctx, _, _ := ctxWithFakeReporter()
	ctx.Input.InstallDir = dir
	ctx.Input.AccessHost = "10.0.0.1"
	ctx.Input.NginxPort = "8080"
	ctx.Input.TeamEmail = "admin@example.com"
	ctx.Input.TeamName = "MyTeam"

	if err := (&InstallService{}).Run(ctx); err != nil {
		t.Fatal(err)
	}
	if ctx.Result.URL != "http://10.0.0.1:8080" {
		t.Fatalf("URL = %q", ctx.Result.URL)
	}
	if ctx.Result.AdminEmail != "admin@example.com" {
		t.Fatalf("AdminEmail = %q", ctx.Result.AdminEmail)
	}
	if ctx.Result.AdminPassword == "" {
		t.Fatal("AdminPassword should be auto-generated")
	}
	if _, err := os.Stat(filepath.Join(dir, "tls", "server.crt")); err != nil {
		t.Fatalf("TLS cert not generated: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, ".env")); err != nil {
		t.Fatalf(".env not written: %v", err)
	}
}

func TestInstallServiceUsesDefaultPort80(t *testing.T) {
	writeFakePackage(t)
	dir := t.TempDir()
	ctx, _, _ := ctxWithFakeReporter()
	ctx.Input.InstallDir = dir
	ctx.Input.AccessHost = "example.com"
	ctx.Input.NginxPort = "80"
	ctx.Input.TeamEmail = "a@b.com"
	if err := (&InstallService{}).Run(ctx); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(ctx.Result.URL, "http://example.com") || strings.Contains(ctx.Result.URL, ":80") {
		t.Fatalf("URL should not include :80 suffix, got %q", ctx.Result.URL)
	}
}
