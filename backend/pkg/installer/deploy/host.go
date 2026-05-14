package deploy

import (
	"context"
	"fmt"
	"strings"
)

func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'"
}

type HostBundlePlan struct {
	BundleURL  string
	BundleFile string
	WorkDir    string
}

type HostInstallPlan struct {
	WorkDir     string
	ComposeFile string
	EnvFile     string
	Token       string
	GrpcURL     string
	Images      []ImageArchive
}

func PrepareHostBundleWithProgress(ctx context.Context, r Runner, plan HostBundlePlan, progress ProgressFunc) error {
	if err := run(ctx, r, "mkdir", "-p", plan.WorkDir); err != nil {
		return fmt.Errorf("create host install dir: %w", err)
	}
	if err := DownloadFile(ctx, plan.BundleURL, plan.BundleFile, progress); err != nil {
		return fmt.Errorf("download host bundle: %w", err)
	}
	if err := run(ctx, r, "tar", "-zxf", plan.BundleFile, "-C", plan.WorkDir); err != nil {
		return fmt.Errorf("extract host bundle: %w", err)
	}
	return nil
}

func InstallHost(ctx context.Context, r Runner, plan HostInstallPlan) error {
	if err := LoadImages(ctx, r, plan.Images); err != nil {
		return err
	}
	if plan.EnvFile != "" && (plan.Token != "" || plan.GrpcURL != "") {
		var lines []string
		if plan.Token != "" {
			lines = append(lines, "TOKEN="+plan.Token)
		}
		if plan.GrpcURL != "" {
			lines = append(lines, "GRPC_URL="+plan.GrpcURL)
		}
		quoted := make([]string, len(lines))
		for i, line := range lines {
			quoted[i] = shellQuote(line)
		}
		script := fmt.Sprintf("printf '%%s\\n' %s >> '%s'", strings.Join(quoted, " "), plan.EnvFile)
		if err := runShell(ctx, r, script); err != nil {
			return fmt.Errorf("write host env: %w", err)
		}
	}
	args := []string{"compose", "-f", plan.ComposeFile}
	if plan.EnvFile != "" {
		args = append(args, "--env-file", plan.EnvFile)
	}
	args = append(args, "up", "-d")
	if err := run(ctx, r, "docker", args...); err != nil {
		return fmt.Errorf("start host services: %w", err)
	}
	return nil
}

func UninstallHost(ctx context.Context, r Runner, plan HostInstallPlan) error {
	args := []string{"compose", "-f", plan.ComposeFile}
	if plan.EnvFile != "" {
		args = append(args, "--env-file", plan.EnvFile)
	}
	args = append(args, "down")
	if err := run(ctx, r, "docker", args...); err != nil {
		return fmt.Errorf("stop host services: %w", err)
	}
	if err := run(ctx, r, "rm", "-rf", plan.WorkDir); err != nil {
		return fmt.Errorf("remove host install dir: %w", err)
	}
	return nil
}
