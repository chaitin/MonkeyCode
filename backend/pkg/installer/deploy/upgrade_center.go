package deploy

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
)

type CenterUpgradePlan struct {
	InstallDir string
	PackageDir string
	BackupDir  string
}

func UpgradeCenter(ctx context.Context, r Runner, plan CenterUpgradePlan) error {
	manifest, err := ReadPackageManifest(plan.PackageDir)
	if err != nil {
		return err
	}
	if err := ValidatePackageManifest(plan.PackageDir, manifest); err != nil {
		return err
	}
	if plan.BackupDir == "" {
		plan.BackupDir = filepath.Join(plan.InstallDir, ".monkeycode", "backups", manifest.Commit)
	}

	if err := stopCenterBusiness(ctx, r, plan.InstallDir); err != nil {
		return err
	}
	snap, err := CreateCenterSnapshot(plan.InstallDir, plan.BackupDir)
	if err != nil {
		return err
	}
	if err := stopCenterAll(ctx, r, plan.InstallDir); err != nil {
		_ = RestoreCenterSnapshot(plan.InstallDir, snap)
		return err
	}
	if err := applyCenterPackage(ctx, r, plan); err != nil {
		_ = RestoreCenterSnapshot(plan.InstallDir, snap)
		_ = InstallCenter(ctx, r, CenterInstallPlan{
			WorkDir:     plan.InstallDir,
			ComposeFile: filepath.Join(plan.InstallDir, "docker-compose.yml"),
			EnvFile:     filepath.Join(plan.InstallDir, ".env"),
		})
		return err
	}

	return WriteInstallMetadata(plan.InstallDir, InstallMetadata{
		Version:    manifest.Version,
		Commit:     manifest.Commit,
		InstallDir: plan.InstallDir,
	})
}

func RollbackCenter(ctx context.Context, r Runner, installDir string, snap CenterSnapshot) error {
	_ = stopCenterAll(ctx, r, installDir)
	if err := RestoreCenterSnapshot(installDir, snap); err != nil {
		return err
	}
	return InstallCenter(ctx, r, CenterInstallPlan{
		WorkDir:     installDir,
		ComposeFile: filepath.Join(installDir, "docker-compose.yml"),
		EnvFile:     filepath.Join(installDir, ".env"),
	})
}

func stopCenterBusiness(ctx context.Context, r Runner, installDir string) error {
	return run(ctx, r, "docker", "compose", "-f", filepath.Join(installDir, "docker-compose.yml"), "--env-file", filepath.Join(installDir, ".env"), "stop", "backend", "frontend", "taskflow", "preview", "ingress")
}

func stopCenterAll(ctx context.Context, r Runner, installDir string) error {
	return run(ctx, r, "docker", "compose", "-f", filepath.Join(installDir, "docker-compose.yml"), "--env-file", filepath.Join(installDir, ".env"), "down")
}

func applyCenterPackage(ctx context.Context, r Runner, plan CenterUpgradePlan) error {
	oldEnv, err := os.ReadFile(filepath.Join(plan.InstallDir, ".env"))
	if err != nil {
		return err
	}
	newEnv, err := os.ReadFile(filepath.Join(plan.PackageDir, ".env.example"))
	if err != nil {
		return err
	}
	merged := MergeEnv(string(oldEnv), string(newEnv), imageEnvKeys())
	if err := os.WriteFile(filepath.Join(plan.InstallDir, ".env"), []byte(merged), 0o600); err != nil {
		return err
	}

	for _, name := range []string{"docker-compose.yml", "static", "images"} {
		if err := os.RemoveAll(filepath.Join(plan.InstallDir, name)); err != nil {
			return err
		}
		if err := copyPathIfExists(filepath.Join(plan.PackageDir, name), filepath.Join(plan.InstallDir, name)); err != nil {
			return fmt.Errorf("copy %s: %w", name, err)
		}
	}

	images, err := ScanImages(filepath.Join(plan.InstallDir, "images"))
	if err != nil {
		return err
	}
	if err := LoadImages(ctx, r, images); err != nil {
		return err
	}
	return InstallCenter(ctx, r, CenterInstallPlan{
		WorkDir:     plan.InstallDir,
		ComposeFile: filepath.Join(plan.InstallDir, "docker-compose.yml"),
		EnvFile:     filepath.Join(plan.InstallDir, ".env"),
	})
}

func imageEnvKeys() map[string]bool {
	return map[string]bool{
		"POSTGRES_IMAGE":   true,
		"REDIS_IMAGE":      true,
		"CLICKHOUSE_IMAGE": true,
		"RUSTFS_IMAGE":     true,
		"INGRESS_IMAGE":    true,
		"TASKFLOW_IMAGE":   true,
		"PREVIEW_IMAGE":    true,
		"FRONTEND_IMAGE":   true,
		"BACKEND_IMAGE":    true,
		"INIT_TEAM_IMAGE":  true,
	}
}
