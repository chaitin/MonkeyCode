package deploy

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"io/fs"
	"net"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
)

const DefaultDevboxImage = "ghcr.io/chaitin/monkeycode-runner/devbox:latest"

type CenterEnvInput struct {
	InstallDir   string
	AccessHost   string
	NginxPort    string
	TeamEmail    string
	TeamName     string
	TeamPassword string
}

type CenterEnv struct {
	InstallDir         string
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
	InitTeamImage      string
	SubnetPrefix       string
	RelaySecret        string
}

type CenterInstallPlan struct {
	WorkDir     string
	ComposeFile string
	EnvFile     string
	TLS         TLSPlan
	Images      []ImageArchive
}

type ImageArchive struct {
	Path       string
	Compressed bool
}

type InstallResult struct {
	URL           string
	AdminEmail    string
	AdminPassword string
}

func NewCenterEnv(input CenterEnvInput) (CenterEnv, error) {
	env := CenterEnv{
		InstallDir:     fallback(input.InstallDir, "/data/monkeycode-ai"),
		AccessHost:     input.AccessHost,
		NginxPort:      fallback(input.NginxPort, "80"),
		PostgresDB:     "monkeycode-ai",
		PostgresUser:   "monkeycode-ai",
		ClickHouseDB:   "monkeycode-ai",
		ClickHouseUser: "monkeycode-ai",
		TeamEmail:      input.TeamEmail,
		TeamName:       fallback(input.TeamName, "MonkeyCode"),
		TeamPassword:   input.TeamPassword,
		InitTeamImage:  DefaultDevboxImage,
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
	if env.RelaySecret, err = randomUUID(); err != nil {
		return CenterEnv{}, err
	}
	return env, nil
}

func RenderCenterEnv(template string, env CenterEnv) string {
	values := map[string]string{
		"INSTALL_DIR":         env.InstallDir,
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
		"INIT_TEAM_IMAGE":     env.InitTeamImage,
		"SUBNET_PREFIX":       env.SubnetPrefix,
		"RELAY_SECRET":        env.RelaySecret,
	}
	lines := strings.Split(template, "\n")
	for i, line := range lines {
		key, _, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		if value, exists := values[strings.TrimSpace(key)]; exists {
			lines[i] = strings.TrimSpace(key) + "=" + value
		}
	}
	return strings.Join(lines, "\n")
}

func PrepareCenterFiles(workDir, packageDir string, env CenterEnv) (CenterInstallPlan, error) {
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		return CenterInstallPlan{}, fmt.Errorf("create install dir: %w", err)
	}
	composePath := filepath.Join(workDir, "docker-compose.yml")
	if err := copyFile(filepath.Join(packageDir, "docker-compose.yml"), composePath); err != nil {
		return CenterInstallPlan{}, fmt.Errorf("copy compose file: %w", err)
	}
	if err := copyTreeIfExists(filepath.Join(packageDir, "static"), filepath.Join(workDir, "static")); err != nil {
		return CenterInstallPlan{}, fmt.Errorf("copy static: %w", err)
	}
	if err := copyTreeIfExists(filepath.Join(packageDir, "images"), filepath.Join(workDir, "images")); err != nil {
		return CenterInstallPlan{}, fmt.Errorf("copy images: %w", err)
	}
	envTemplate, err := os.ReadFile(filepath.Join(packageDir, ".env.example"))
	if err != nil {
		return CenterInstallPlan{}, fmt.Errorf("read .env.example: %w", err)
	}
	if env.InstallDir == "" {
		env.InstallDir = workDir
	}
	rendered := RenderCenterEnv(string(envTemplate), env)
	envPath := filepath.Join(workDir, ".env")
	if err := os.WriteFile(envPath, []byte(rendered), 0o600); err != nil {
		return CenterInstallPlan{}, fmt.Errorf("write .env: %w", err)
	}
	return CenterInstallPlan{
		WorkDir:     workDir,
		ComposeFile: composePath,
		EnvFile:     envPath,
	}, nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

func copyTreeIfExists(src, dst string) error {
	if _, err := os.Stat(src); err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
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
			return os.MkdirAll(target, 0o755)
		}
		return copyFile(path, target)
	})
}

func PrepareCenterDirs(ctx context.Context, r Runner, workDir string) error {
	postgresData := filepath.Join(workDir, "data", "postgres")
	redisData := filepath.Join(workDir, "data", "redis")
	clickhouseData := filepath.Join(workDir, "data", "clickhouse")
	clickhouseLogs := filepath.Join(workDir, "logs", "clickhouse")
	rustfsData := filepath.Join(workDir, "data", "rustfs")
	rustfsLogs := filepath.Join(workDir, "logs", "rustfs")

	if err := run(ctx, r, "mkdir", "-p", postgresData, redisData, clickhouseData, clickhouseLogs, rustfsData, rustfsLogs); err != nil {
		return fmt.Errorf("create center data dirs: %w", err)
	}
	if err := run(ctx, r, "chown", "-R", "101:101", clickhouseData, clickhouseLogs); err != nil {
		return fmt.Errorf("prepare clickhouse data dirs: %w", err)
	}
	if err := run(ctx, r, "chown", "-R", "10001:10001", rustfsData, rustfsLogs); err != nil {
		return fmt.Errorf("prepare rustfs data dirs: %w", err)
	}
	return nil
}

func InstallCenter(ctx context.Context, r Runner, plan CenterInstallPlan) error {
	args := []string{"compose", "-f", plan.ComposeFile}
	if plan.EnvFile != "" {
		args = append(args, "--env-file", plan.EnvFile)
	}
	args = append(args, "up", "-d")
	if err := run(ctx, r, "docker", args...); err != nil {
		return fmt.Errorf("start center services: %w", err)
	}
	return nil
}

func CenterAccessURL(host, port string) string {
	host = strings.TrimSpace(host)
	port = strings.TrimSpace(port)
	if host == "" {
		host = "localhost"
	}
	if ip := net.ParseIP(host); ip != nil && strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	if port == "" || port == "80" {
		return "http://" + host
	}
	return "http://" + host + ":" + port
}

func randomSecret(n int) (string, error) {
	b := make([]byte, n/2+1)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b)[:n], nil
}

func randomUUID() (string, error) {
	id, err := uuid.NewRandom()
	if err != nil {
		return "", err
	}
	return id.String(), nil
}

func fallback(v, def string) string {
	if strings.TrimSpace(v) == "" {
		return def
	}
	return v
}
