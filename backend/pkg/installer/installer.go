package installer

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"strings"
)

var errNotFound = errors.New("command not found")

type Runner interface {
	Run(ctx context.Context, name string, args ...string) RunResult
	RunShell(ctx context.Context, script string) RunResult
}

type RunResult struct {
	Stdout string
	Stderr string
	Err    error
}

type CommandRunner struct{}

func (CommandRunner) Run(ctx context.Context, name string, args ...string) RunResult {
	cmd := exec.CommandContext(ctx, name, args...)
	out, err := cmd.Output()
	if err != nil {
		if _, ok := err.(*exec.Error); ok {
			return RunResult{Err: errNotFound}
		}
		if exitErr, ok := err.(*exec.ExitError); ok {
			return RunResult{Stderr: string(exitErr.Stderr), Err: err}
		}
		return RunResult{Err: err}
	}
	return RunResult{Stdout: string(out)}
}

func (CommandRunner) RunShell(ctx context.Context, script string) RunResult {
	return CommandRunner{}.Run(ctx, "sh", "-c", script)
}

type DockerStatus struct {
	DockerInstalled  bool
	DockerVersion    string
	ComposeInstalled bool
	ComposeVersion   string
	DaemonRunning    bool
	DaemonVersion    string
}

func (s DockerStatus) Ready() bool {
	return s.DockerInstalled && s.ComposeInstalled && s.DaemonRunning
}

func CheckDockerStatus(ctx context.Context, r Runner) DockerStatus {
	status := DockerStatus{}
	if res := r.Run(ctx, "docker", "--version"); res.Err == nil {
		status.DockerInstalled = true
		status.DockerVersion = parseDockerVersion(res.Stdout)
	}
	if res := r.Run(ctx, "docker", "compose", "version"); res.Err == nil {
		status.ComposeInstalled = true
		status.ComposeVersion = parseComposeVersion(res.Stdout)
	}
	if res := r.Run(ctx, "docker", "info", "--format", "{{.ServerVersion}}"); res.Err == nil {
		status.DaemonRunning = true
		status.DaemonVersion = strings.TrimSpace(res.Stdout)
	}
	return status
}

type HostInstallPlan struct {
	WorkDir     string
	ComposeFile string
	EnvFile     string
	Token       string
	GrpcURL     string
	Images      []ImageArchive
}

type CenterInstallPlan struct {
	WorkDir     string
	ComposeFile string
	EnvFile     string
	TLS         TLSPlan
	Images      []ImageArchive
}

type CenterFilesPlan struct {
	PackageDir string
	WorkDir    string
	Env        CenterEnv
}

type CenterEnvInput struct {
	AccessHost   string
	NginxPort    string
	TeamEmail    string
	TeamName     string
	TeamPassword string
}

type CenterEnv struct {
	AccessHost         string
	NginxPort          string
	PostgresDB         string
	PostgresUser       string
	PostgresPassword   string
	RedisPassword      string
	ClickHouseDB       string
	ClickHouseUser     string
	ClickHousePassword string
	RustFSAccessKey    string
	RustFSSecretKey    string
	TeamEmail          string
	TeamName           string
	TeamPassword       string
	SubnetPrefix       string
}

type DockerInstallPlan struct {
	BundleURL  string
	WorkDir    string
	BundleFile string
}

type HostBundlePlan struct {
	BundleURL  string
	BundleFile string
	WorkDir    string
}

type ImageArchive struct {
	Path       string
	Compressed bool
}

type DownloadProgress struct {
	Downloaded int64
	Total      int64
}

func (p DownloadProgress) Percent() float64 {
	if p.Total <= 0 {
		return 0
	}
	percent := float64(p.Downloaded) / float64(p.Total)
	if percent > 1 {
		return 1
	}
	return percent
}

type ProgressFunc func(DownloadProgress)

func InstallDocker(ctx context.Context, r Runner, plan DockerInstallPlan) error {
	return InstallDockerWithProgress(ctx, r, plan, nil)
}

func InstallDockerWithProgress(ctx context.Context, r Runner, plan DockerInstallPlan, progress ProgressFunc) error {
	if res := r.Run(ctx, "mkdir", "-p", plan.WorkDir); res.Err != nil {
		return fmt.Errorf("create docker install dir: %w", res.Err)
	}
	if err := DownloadFile(ctx, plan.BundleURL, plan.BundleFile, progress); err != nil {
		return fmt.Errorf("download docker bundle: %w", err)
	}
	return installDockerBundle(ctx, r, plan)
}

func InstallDockerFromLocalBundle(ctx context.Context, r Runner, plan DockerInstallPlan) error {
	if res := r.Run(ctx, "mkdir", "-p", plan.WorkDir); res.Err != nil {
		return fmt.Errorf("create docker install dir: %w", res.Err)
	}
	return installDockerBundle(ctx, r, plan)
}

func installDockerBundle(ctx context.Context, r Runner, plan DockerInstallPlan) error {
	if res := r.Run(ctx, "tar", "-zxf", plan.BundleFile, "-C", plan.WorkDir); res.Err != nil {
		return fmt.Errorf("extract docker bundle: %w", res.Err)
	}
	if res := r.RunShell(ctx, fmt.Sprintf("install -m 0755 '%s'/docker/* /usr/local/bin/", shellQuote(plan.WorkDir))); res.Err != nil {
		return fmt.Errorf("install docker binaries: %w", res.Err)
	}
	if res := r.Run(ctx, "install", "-m", "0755", plan.WorkDir+"/docker-compose", "/usr/local/lib/docker/cli-plugins/docker-compose"); res.Err != nil {
		return fmt.Errorf("install docker compose: %w", res.Err)
	}
	if res := r.Run(ctx, "ln", "-sf", "/usr/local/lib/docker/cli-plugins/docker-compose", "/usr/local/bin/docker-compose"); res.Err != nil {
		return fmt.Errorf("link docker compose: %w", res.Err)
	}
	if res := r.Run(ctx, "systemctl", "daemon-reload"); res.Err != nil {
		return fmt.Errorf("reload systemd: %w", res.Err)
	}
	if res := r.Run(ctx, "systemctl", "enable", "--now", "docker"); res.Err != nil {
		return fmt.Errorf("start docker: %w", res.Err)
	}
	return nil
}

func PrepareHostBundle(ctx context.Context, r Runner, plan HostBundlePlan) error {
	return PrepareHostBundleWithProgress(ctx, r, plan, nil)
}

func PrepareHostBundleWithProgress(ctx context.Context, r Runner, plan HostBundlePlan, progress ProgressFunc) error {
	if res := r.Run(ctx, "mkdir", "-p", plan.WorkDir); res.Err != nil {
		return fmt.Errorf("create host install dir: %w", res.Err)
	}
	if err := DownloadFile(ctx, plan.BundleURL, plan.BundleFile, progress); err != nil {
		return fmt.Errorf("download host bundle: %w", err)
	}
	if res := r.Run(ctx, "tar", "-zxf", plan.BundleFile, "-C", plan.WorkDir); res.Err != nil {
		return fmt.Errorf("extract host bundle: %w", res.Err)
	}
	return nil
}

func DownloadFile(ctx context.Context, sourceURL, dest string, progress ProgressFunc) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, sourceURL, nil)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("unexpected status: %s", resp.Status)
	}

	out, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer out.Close()

	reader := &progressReader{
		reader:   resp.Body,
		total:    resp.ContentLength,
		progress: progress,
	}
	if _, err := io.Copy(out, reader); err != nil {
		return err
	}
	if progress != nil {
		progress(DownloadProgress{Downloaded: reader.downloaded, Total: resp.ContentLength})
	}
	return nil
}

type progressReader struct {
	reader     io.Reader
	downloaded int64
	total      int64
	progress   ProgressFunc
}

func (r *progressReader) Read(p []byte) (int, error) {
	n, err := r.reader.Read(p)
	if n > 0 {
		r.downloaded += int64(n)
		if r.progress != nil {
			r.progress(DownloadProgress{Downloaded: r.downloaded, Total: r.total})
		}
	}
	return n, err
}

func BundleURL(baseURL, bundlePath string) (string, error) {
	u, err := url.Parse(strings.TrimRight(baseURL, "/"))
	if err != nil {
		return "", err
	}
	u.Path = path.Join(u.Path, bundlePath)
	return u.String(), nil
}

func InstallHost(ctx context.Context, r Runner, plan HostInstallPlan) error {
	if err := loadImages(ctx, r, plan.Images); err != nil {
		return err
	}

	if plan.EnvFile != "" && (plan.Token != "" || plan.GrpcURL != "") {
		lines := []string{}
		if plan.Token != "" {
			lines = append(lines, "TOKEN="+plan.Token)
		}
		if plan.GrpcURL != "" {
			lines = append(lines, "GRPC_URL="+plan.GrpcURL)
		}
		args := []string{"-c", fmt.Sprintf("printf '%%s\\n' %s >> '%s'", shellJoin(lines), shellQuote(plan.EnvFile))}
		if res := r.Run(ctx, "sh", args...); res.Err != nil {
			return fmt.Errorf("write host env: %w", res.Err)
		}
	}

	args := []string{"compose", "-f", plan.ComposeFile}
	if plan.EnvFile != "" {
		args = append(args, "--env-file", plan.EnvFile)
	}
	args = append(args, "up", "-d")
	if res := r.Run(ctx, "docker", args...); res.Err != nil {
		return fmt.Errorf("start host services: %w", res.Err)
	}
	return nil
}

func InstallCenter(ctx context.Context, r Runner, plan CenterInstallPlan) error {
	if res := r.Run(ctx, "mkdir", "-p", plan.WorkDir); res.Err != nil {
		return fmt.Errorf("create center install dir: %w", res.Err)
	}
	if err := loadImages(ctx, r, plan.Images); err != nil {
		return err
	}
	args := []string{"compose", "-f", plan.ComposeFile}
	if plan.EnvFile != "" {
		args = append(args, "--env-file", plan.EnvFile)
	}
	args = append(args, "up", "-d")
	if res := r.Run(ctx, "docker", args...); res.Err != nil {
		return fmt.Errorf("start center services: %w", res.Err)
	}
	return nil
}

func PrepareCenterFiles(ctx context.Context, r Runner, plan CenterFilesPlan) error {
	if err := copyFile(filepath.Join(plan.PackageDir, "docker-compose.yml"), filepath.Join(plan.WorkDir, "docker-compose.yml")); err != nil {
		return err
	}
	if err := copyTree(filepath.Join(plan.PackageDir, "static"), filepath.Join(plan.WorkDir, "static")); err != nil {
		return err
	}
	if err := copyTree(filepath.Join(plan.PackageDir, "images"), filepath.Join(plan.WorkDir, "images")); err != nil {
		return err
	}
	env, err := os.ReadFile(filepath.Join(plan.PackageDir, ".env.example"))
	if err != nil {
		return err
	}
	content := RenderCenterEnv(string(env), plan.Env)
	return writeFileAtomic(filepath.Join(plan.WorkDir, ".env"), []byte(content), 0600)
}

func NewCenterEnv(input CenterEnvInput) (CenterEnv, error) {
	env := CenterEnv{
		AccessHost:     input.AccessHost,
		NginxPort:      fallback(input.NginxPort, "80"),
		PostgresDB:     "monkeycode-ai",
		PostgresUser:   "monkeycode-ai",
		ClickHouseDB:   "monkeycode-ai",
		ClickHouseUser: "monkeycode-ai",
		TeamEmail:      input.TeamEmail,
		TeamName:       fallback(input.TeamName, "MonkeyCode"),
		TeamPassword:   input.TeamPassword,
		SubnetPrefix:   "10.100.50",
	}
	var err error
	if env.TeamPassword == "" {
		env.TeamPassword, err = randomSecret(24)
		if err != nil {
			return CenterEnv{}, err
		}
	}
	if env.PostgresPassword, err = randomSecret(24); err != nil {
		return CenterEnv{}, err
	}
	if env.RedisPassword, err = randomSecret(24); err != nil {
		return CenterEnv{}, err
	}
	if env.ClickHousePassword, err = randomSecret(24); err != nil {
		return CenterEnv{}, err
	}
	if env.RustFSAccessKey, err = randomSecret(24); err != nil {
		return CenterEnv{}, err
	}
	if env.RustFSSecretKey, err = randomSecret(32); err != nil {
		return CenterEnv{}, err
	}
	return env, nil
}

func RenderCenterEnv(template string, env CenterEnv) string {
	values := map[string]string{
		"REMOTE_IP":           env.AccessHost,
		"NGINX_PORT":          env.NginxPort,
		"POSTGRES_DB":         env.PostgresDB,
		"POSTGRES_USER":       env.PostgresUser,
		"POSTGRES_PASSWORD":   env.PostgresPassword,
		"REDIS_PASSWORD":      env.RedisPassword,
		"CLICKHOUSE_DB":       env.ClickHouseDB,
		"CLICKHOUSE_USER":     env.ClickHouseUser,
		"CLICKHOUSE_PASSWORD": env.ClickHousePassword,
		"RUSTFS_ACCESS_KEY":   env.RustFSAccessKey,
		"RUSTFS_SECRET_KEY":   env.RustFSSecretKey,
		"TEAM_EMAIL":          env.TeamEmail,
		"TEAM_NAME":           env.TeamName,
		"TEAM_PASSWORD":       env.TeamPassword,
		"SUBNET_PREFIX":       env.SubnetPrefix,
	}
	lines := strings.Split(template, "\n")
	for i, line := range lines {
		key, _, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		if value, exists := values[key]; exists {
			lines[i] = key + "=" + value
		}
	}
	return strings.Join(lines, "\n")
}

func loadImages(ctx context.Context, r Runner, images []ImageArchive) error {
	for _, image := range images {
		if image.Compressed {
			if res := r.RunShell(ctx, fmt.Sprintf("gzip -dc '%s' | docker load", shellQuote(image.Path))); res.Err != nil {
				return fmt.Errorf("load image %s: %w", image.Path, res.Err)
			}
			continue
		}
		if res := r.Run(ctx, "docker", "load", "-i", image.Path); res.Err != nil {
			return fmt.Errorf("load image %s: %w", image.Path, res.Err)
		}
	}
	return nil
}

func UninstallHost(ctx context.Context, r Runner, plan HostInstallPlan) error {
	args := []string{"compose", "-f", plan.ComposeFile}
	if plan.EnvFile != "" {
		args = append(args, "--env-file", plan.EnvFile)
	}
	args = append(args, "down")
	if res := r.Run(ctx, "docker", args...); res.Err != nil {
		return fmt.Errorf("stop host services: %w", res.Err)
	}
	if res := r.Run(ctx, "rm", "-rf", plan.WorkDir); res.Err != nil {
		return fmt.Errorf("remove host install dir: %w", res.Err)
	}
	return nil
}

func shellJoin(values []string) string {
	parts := make([]string, 0, len(values))
	for _, value := range values {
		parts = append(parts, "'"+shellQuote(value)+"'")
	}
	return strings.Join(parts, " ")
}

func copyTree(src, dst string) error {
	return filepath.WalkDir(src, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0755)
		}
		if shouldSkipPackageFile(filepath.Base(path)) {
			return nil
		}
		return copyFile(path, target)
	})
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return err
	}
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0644)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

func writeFileAtomic(path string, data []byte, perm os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, perm); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func shouldSkipPackageFile(name string) bool {
	return strings.HasPrefix(name, "._") || name == ".DS_Store"
}

func fallback(value, defaultValue string) string {
	if value != "" {
		return value
	}
	return defaultValue
}

func randomSecret(length int) (string, error) {
	raw := make([]byte, length)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	secret := base64.RawURLEncoding.EncodeToString(raw)
	if len(secret) > length {
		return secret[:length], nil
	}
	return secret, nil
}

func shellQuote(s string) string {
	return strings.ReplaceAll(s, "'", `'\''`)
}

var (
	dockerVersionRe  = regexp.MustCompile(`Docker version ([^,\s]+)`)
	composeVersionRe = regexp.MustCompile(`Docker Compose version ([^\s]+)`)
)

func parseDockerVersion(out string) string {
	m := dockerVersionRe.FindStringSubmatch(out)
	if len(m) == 2 {
		return m[1]
	}
	return strings.TrimSpace(out)
}

func parseComposeVersion(out string) string {
	m := composeVersionRe.FindStringSubmatch(out)
	if len(m) == 2 {
		return m[1]
	}
	return strings.TrimSpace(out)
}
