package deploy

import (
	"context"
	"path/filepath"
	"time"
)

type HostUpgradePlan struct {
	WorkDir    string
	BundleFile string
	Token      string
	GrpcURL    string
}

func UpgradeHost(ctx context.Context, r Runner, plan HostUpgradePlan) error {
	backupDir := filepath.Join(plan.WorkDir, ".backup", time.Now().Format("20060102-150405"))
	for _, name := range hostUpgradeFiles() {
		if err := copyPathIfExists(filepath.Join(plan.WorkDir, name), filepath.Join(backupDir, name)); err != nil {
			return err
		}
	}

	oldPlan := HostInstallPlan{
		WorkDir:     plan.WorkDir,
		ComposeFile: filepath.Join(plan.WorkDir, "docker-compose.yml"),
		EnvFile:     filepath.Join(plan.WorkDir, ".env"),
	}
	if err := run(ctx, r, "docker", "compose", "-f", oldPlan.ComposeFile, "--env-file", oldPlan.EnvFile, "down"); err != nil {
		return err
	}
	if err := run(ctx, r, "tar", "-zxf", plan.BundleFile, "-C", plan.WorkDir); err != nil {
		_ = restoreHostBackup(plan.WorkDir, backupDir)
		_ = InstallHost(ctx, r, oldPlan)
		return err
	}

	images, err := ScanImages(filepath.Join(plan.WorkDir, "images"))
	if err != nil {
		_ = restoreHostBackup(plan.WorkDir, backupDir)
		return err
	}
	newPlan := HostInstallPlan{
		WorkDir:     plan.WorkDir,
		ComposeFile: filepath.Join(plan.WorkDir, "docker-compose.yml"),
		EnvFile:     filepath.Join(plan.WorkDir, ".env"),
		Token:       plan.Token,
		GrpcURL:     plan.GrpcURL,
		Images:      images,
	}
	if err := InstallHost(ctx, r, newPlan); err != nil {
		_ = restoreHostBackup(plan.WorkDir, backupDir)
		_ = InstallHost(ctx, r, oldPlan)
		return err
	}
	return nil
}

func restoreHostBackup(workDir, backupDir string) error {
	for _, name := range hostUpgradeFiles() {
		if err := copyPathIfExists(filepath.Join(backupDir, name), filepath.Join(workDir, name)); err != nil {
			return err
		}
	}
	return nil
}

func hostUpgradeFiles() []string {
	return []string{"docker-compose.yml", ".env", "images"}
}
