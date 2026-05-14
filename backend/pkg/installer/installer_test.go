package installer

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type fakeRunner struct {
	outputs map[string]RunResult
	calls   []string
}

func (r *fakeRunner) Run(ctx context.Context, name string, args ...string) RunResult {
	cmd := strings.Join(append([]string{name}, args...), " ")
	r.calls = append(r.calls, cmd)
	if out, ok := r.outputs[cmd]; ok {
		return out
	}
	return RunResult{Err: errNotFound}
}

func (r *fakeRunner) RunShell(ctx context.Context, script string) RunResult {
	r.calls = append(r.calls, script)
	if out, ok := r.outputs[script]; ok {
		return out
	}
	return RunResult{Err: errNotFound}
}

func TestCheckDockerStatusParsesVersions(t *testing.T) {
	r := &fakeRunner{outputs: map[string]RunResult{
		"docker --version":                        {Stdout: "Docker version 29.4.3, build 123456\n"},
		"docker compose version":                  {Stdout: "Docker Compose version v2.40.3\n"},
		"docker info --format {{.ServerVersion}}": {Stdout: "29.4.3\n"},
	}}

	status := CheckDockerStatus(context.Background(), r)

	if !status.DockerInstalled {
		t.Fatal("DockerInstalled = false")
	}
	if status.DockerVersion != "29.4.3" {
		t.Fatalf("DockerVersion = %q", status.DockerVersion)
	}
	if !status.ComposeInstalled {
		t.Fatal("ComposeInstalled = false")
	}
	if status.ComposeVersion != "v2.40.3" {
		t.Fatalf("ComposeVersion = %q", status.ComposeVersion)
	}
	if !status.DaemonRunning {
		t.Fatal("DaemonRunning = false")
	}
}

func TestCheckDockerStatusDetectsMissingCompose(t *testing.T) {
	r := &fakeRunner{outputs: map[string]RunResult{
		"docker --version": {Stdout: "Docker version 29.4.3, build 123456\n"},
	}}

	status := CheckDockerStatus(context.Background(), r)

	if !status.DockerInstalled {
		t.Fatal("DockerInstalled = false")
	}
	if status.ComposeInstalled {
		t.Fatal("ComposeInstalled = true")
	}
	if status.Ready() {
		t.Fatal("Ready() = true")
	}
}

func TestInstallHostLoadsImagesAndStartsCompose(t *testing.T) {
	r := &fakeRunner{outputs: map[string]RunResult{
		"docker load -i /opt/monkeycode-host/images/orchestrator.tar":                                          {},
		"gzip -dc '/opt/monkeycode-host/images/orchestrator.tgz' | docker load":                                {},
		"sh -c printf '%s\\n' 'TOKEN=host-token' 'GRPC_URL=10.0.0.1:50443' >> '/opt/monkeycode-host/.env'":     {},
		"docker compose -f /opt/monkeycode-host/docker-compose.yml --env-file /opt/monkeycode-host/.env up -d": {},
	}}
	plan := HostInstallPlan{
		WorkDir:     "/opt/monkeycode-host",
		ComposeFile: "/opt/monkeycode-host/docker-compose.yml",
		EnvFile:     "/opt/monkeycode-host/.env",
		Token:       "host-token",
		GrpcURL:     "10.0.0.1:50443",
		Images: []ImageArchive{
			{Path: "/opt/monkeycode-host/images/orchestrator.tar", Compressed: false},
			{Path: "/opt/monkeycode-host/images/orchestrator.tgz", Compressed: true},
		},
	}

	if err := InstallHost(context.Background(), r, plan); err != nil {
		t.Fatalf("%v, calls=%#v", err, r.calls)
	}

	want := []string{
		"docker load -i /opt/monkeycode-host/images/orchestrator.tar",
		"gzip -dc '/opt/monkeycode-host/images/orchestrator.tgz' | docker load",
		"sh -c printf '%s\\n' 'TOKEN=host-token' 'GRPC_URL=10.0.0.1:50443' >> '/opt/monkeycode-host/.env'",
		"docker compose -f /opt/monkeycode-host/docker-compose.yml --env-file /opt/monkeycode-host/.env up -d",
	}
	if strings.Join(r.calls, "\n") != strings.Join(want, "\n") {
		t.Fatalf("calls = %#v", r.calls)
	}
}

func TestUninstallHostStopsComposeAndRemovesWorkDir(t *testing.T) {
	r := &fakeRunner{outputs: map[string]RunResult{
		"docker compose -f /opt/monkeycode-host/docker-compose.yml --env-file /opt/monkeycode-host/.env down": {},
		"rm -rf /opt/monkeycode-host": {},
	}}
	plan := HostInstallPlan{
		WorkDir:     "/opt/monkeycode-host",
		ComposeFile: "/opt/monkeycode-host/docker-compose.yml",
		EnvFile:     "/opt/monkeycode-host/.env",
	}

	if err := UninstallHost(context.Background(), r, plan); err != nil {
		t.Fatalf("%v, calls=%#v", err, r.calls)
	}

	want := []string{
		"docker compose -f /opt/monkeycode-host/docker-compose.yml --env-file /opt/monkeycode-host/.env down",
		"rm -rf /opt/monkeycode-host",
	}
	if strings.Join(r.calls, "\n") != strings.Join(want, "\n") {
		t.Fatalf("calls = %#v", r.calls)
	}
}

func TestInstallCenterLoadsImagesAndStartsCompose(t *testing.T) {
	r := &fakeRunner{outputs: map[string]RunResult{
		"mkdir -p /data/monkeycode-ai":                                                                       {},
		"docker load -i /data/monkeycode-ai/images/backend.tar":                                              {},
		"gzip -dc '/data/monkeycode-ai/images/frontend.tar.gz' | docker load":                                {},
		"docker compose -f /data/monkeycode-ai/docker-compose.yml --env-file /data/monkeycode-ai/.env up -d": {},
	}}
	plan := CenterInstallPlan{
		WorkDir:     "/data/monkeycode-ai",
		ComposeFile: "/data/monkeycode-ai/docker-compose.yml",
		EnvFile:     "/data/monkeycode-ai/.env",
		Images: []ImageArchive{
			{Path: "/data/monkeycode-ai/images/backend.tar"},
			{Path: "/data/monkeycode-ai/images/frontend.tar.gz", Compressed: true},
		},
	}

	if err := InstallCenter(context.Background(), r, plan); err != nil {
		t.Fatalf("%v, calls=%#v", err, r.calls)
	}

	want := []string{
		"mkdir -p /data/monkeycode-ai",
		"docker load -i /data/monkeycode-ai/images/backend.tar",
		"gzip -dc '/data/monkeycode-ai/images/frontend.tar.gz' | docker load",
		"docker compose -f /data/monkeycode-ai/docker-compose.yml --env-file /data/monkeycode-ai/.env up -d",
	}
	if strings.Join(r.calls, "\n") != strings.Join(want, "\n") {
		t.Fatalf("calls = %#v", r.calls)
	}
}

func TestInstallDockerFromLocalBundleDoesNotDownload(t *testing.T) {
	r := &fakeRunner{outputs: map[string]RunResult{
		"mkdir -p /tmp/monkeycode-installer":                                                                        {},
		"tar -zxf /pkg/docker.tgz -C /tmp/monkeycode-installer":                                                     {},
		"install -m 0755 '/tmp/monkeycode-installer'/docker/* /usr/local/bin/":                                      {},
		"install -m 0755 /tmp/monkeycode-installer/docker-compose /usr/local/lib/docker/cli-plugins/docker-compose": {},
		"ln -sf /usr/local/lib/docker/cli-plugins/docker-compose /usr/local/bin/docker-compose":                     {},
		"systemctl daemon-reload":       {},
		"systemctl enable --now docker": {},
	}}

	err := InstallDockerFromLocalBundle(context.Background(), r, DockerInstallPlan{
		WorkDir:    "/tmp/monkeycode-installer",
		BundleFile: "/pkg/docker.tgz",
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestPrepareCenterFilesCopiesPackageFilesAndWritesEnv(t *testing.T) {
	pkg := t.TempDir()
	work := filepath.Join(t.TempDir(), "monkeycode-ai")
	writeFile(t, filepath.Join(pkg, "docker-compose.yml"), "compose")
	writeFile(t, filepath.Join(pkg, ".env.example"), "REMOTE_IP=\nNGINX_PORT=\nTEAM_EMAIL=\nTEAM_NAME=\nTEAM_PASSWORD=\nPOSTGRES_PASSWORD=\n")
	writeFile(t, filepath.Join(pkg, "static", "project-tpl.zip"), "zip")
	writeFile(t, filepath.Join(pkg, "images", "backend.tar.gz"), "image")

	err := PrepareCenterFiles(context.Background(), CommandRunner{}, CenterFilesPlan{
		PackageDir: pkg,
		WorkDir:    work,
		Env: CenterEnv{
			AccessHost:       "192.168.1.10",
			NginxPort:        "8080",
			TeamEmail:        "admin@example.com",
			TeamName:         "Example",
			TeamPassword:     "team-secret",
			PostgresPassword: "pg-secret",
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	if got := readFile(t, filepath.Join(work, "docker-compose.yml")); got != "compose" {
		t.Fatalf("compose = %q", got)
	}
	if got := readFile(t, filepath.Join(work, "static", "project-tpl.zip")); got != "zip" {
		t.Fatalf("project-tpl.zip = %q", got)
	}
	env := readFile(t, filepath.Join(work, ".env"))
	if !strings.Contains(env, "REMOTE_IP=192.168.1.10") {
		t.Fatalf("env = %q", env)
	}
	for _, want := range []string{
		"NGINX_PORT=8080",
		"TEAM_EMAIL=admin@example.com",
		"TEAM_NAME=Example",
		"TEAM_PASSWORD=team-secret",
		"POSTGRES_PASSWORD=pg-secret",
	} {
		if !strings.Contains(env, want) {
			t.Fatalf("env missing %q: %q", want, env)
		}
	}
}

func TestNewCenterEnvGeneratesPasswords(t *testing.T) {
	env, err := NewCenterEnv(CenterEnvInput{
		AccessHost: "192.168.1.10",
		NginxPort:  "80",
		TeamEmail:  "admin@example.com",
		TeamName:   "MonkeyCode",
	})
	if err != nil {
		t.Fatal(err)
	}
	for name, value := range map[string]string{
		"TeamPassword":       env.TeamPassword,
		"PostgresPassword":   env.PostgresPassword,
		"RedisPassword":      env.RedisPassword,
		"ClickHousePassword": env.ClickHousePassword,
		"RustFSAccessKey":    env.RustFSAccessKey,
		"RustFSSecretKey":    env.RustFSSecretKey,
	} {
		if len(value) < 24 {
			t.Fatalf("%s too short: %q", name, value)
		}
	}
	if env.NginxPort != "80" {
		t.Fatalf("NginxPort = %q", env.NginxPort)
	}
}

func TestRenderCenterEnvReplacesKeys(t *testing.T) {
	got := RenderCenterEnv("REMOTE_IP=\nNGINX_PORT=\nKEEP=value\n", CenterEnv{
		AccessHost: "example.com",
		NginxPort:  "8080",
	})
	if !strings.Contains(got, "REMOTE_IP=example.com") {
		t.Fatalf("env = %q", got)
	}
	if !strings.Contains(got, "NGINX_PORT=8080") {
		t.Fatalf("env = %q", got)
	}
	if !strings.Contains(got, "KEEP=value") {
		t.Fatalf("env = %q", got)
	}
}

func TestInstallDockerDownloadsBundleAndInstallsBinaries(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("docker bundle"))
	}))
	defer server.Close()

	workDir := t.TempDir()
	bundleFile := filepath.Join(workDir, "docker.tgz")
	r := &fakeRunner{outputs: map[string]RunResult{
		"mkdir -p " + workDir:                                        {},
		"tar -zxf " + bundleFile + " -C " + workDir:                  {},
		"install -m 0755 '" + workDir + "'/docker/* /usr/local/bin/": {},
		"install -m 0755 " + workDir + "/docker-compose /usr/local/lib/docker/cli-plugins/docker-compose": {},
		"ln -sf /usr/local/lib/docker/cli-plugins/docker-compose /usr/local/bin/docker-compose":           {},
		"systemctl daemon-reload":       {},
		"systemctl enable --now docker": {},
	}}
	plan := DockerInstallPlan{
		BundleURL:  server.URL,
		WorkDir:    workDir,
		BundleFile: bundleFile,
	}

	if err := InstallDocker(context.Background(), r, plan); err != nil {
		t.Fatal(err)
	}

	want := []string{
		"mkdir -p " + workDir,
		"tar -zxf " + bundleFile + " -C " + workDir,
		"install -m 0755 '" + workDir + "'/docker/* /usr/local/bin/",
		"install -m 0755 " + workDir + "/docker-compose /usr/local/lib/docker/cli-plugins/docker-compose",
		"ln -sf /usr/local/lib/docker/cli-plugins/docker-compose /usr/local/bin/docker-compose",
		"systemctl daemon-reload",
		"systemctl enable --now docker",
	}
	if strings.Join(r.calls, "\n") != strings.Join(want, "\n") {
		t.Fatalf("calls = %#v", r.calls)
	}
}

func TestPrepareHostDownloadsBundle(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("host bundle"))
	}))
	defer server.Close()

	r := &fakeRunner{outputs: map[string]RunResult{
		"mkdir -p /opt/monkeycode-host":                             {},
		"tar -zxf /tmp/monkeycode-host.tgz -C /opt/monkeycode-host": {},
	}}
	plan := HostBundlePlan{
		BundleURL:  server.URL,
		BundleFile: "/tmp/monkeycode-host.tgz",
		WorkDir:    "/opt/monkeycode-host",
	}

	if err := PrepareHostBundle(context.Background(), r, plan); err != nil {
		t.Fatal(err)
	}

	want := []string{
		"mkdir -p /opt/monkeycode-host",
		"tar -zxf /tmp/monkeycode-host.tgz -C /opt/monkeycode-host",
	}
	if strings.Join(r.calls, "\n") != strings.Join(want, "\n") {
		t.Fatalf("calls = %#v", r.calls)
	}
}

func TestDownloadFileReportsProgress(t *testing.T) {
	body := strings.Repeat("a", 1024)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", "1024")
		_, _ = w.Write([]byte(body))
	}))
	defer server.Close()

	var events []DownloadProgress
	dest := filepath.Join(t.TempDir(), "bundle.tgz")
	if err := DownloadFile(context.Background(), server.URL, dest, func(progress DownloadProgress) {
		events = append(events, progress)
	}); err != nil {
		t.Fatal(err)
	}

	got, err := os.ReadFile(dest)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != body {
		t.Fatalf("downloaded body = %q", string(got))
	}
	if len(events) == 0 {
		t.Fatal("progress callback was not called")
	}
	last := events[len(events)-1]
	if last.Downloaded != 1024 || last.Total != 1024 || last.Percent() != 1 {
		t.Fatalf("last progress = %#v percent=%v", last, last.Percent())
	}
}

func TestBundleURLJoinsBaseURLAndPath(t *testing.T) {
	url, err := BundleURL("http://server/base/", "/static/host/installation.tgz")
	if err != nil {
		t.Fatal(err)
	}
	if url != "http://server/base/static/host/installation.tgz" {
		t.Fatalf("url = %q", url)
	}
}

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}
