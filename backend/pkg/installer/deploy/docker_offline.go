package deploy

import (
	"context"
	"fmt"
	"os"
)

const dockerService = `[Unit]
Description=Docker Application Container Engine
Documentation=https://docs.docker.com
After=network-online.target firewalld.service
Wants=network-online.target

[Service]
Type=notify
ExecStart=/usr/local/bin/dockerd
ExecReload=/bin/kill -s HUP $MAINPID
TimeoutStartSec=0
Restart=on-failure
StartLimitBurst=3
StartLimitInterval=60s
LimitNOFILE=infinity
LimitNPROC=infinity
LimitCORE=infinity
TasksMax=infinity
Delegate=yes
KillMode=process
OOMScoreAdjust=-500

[Install]
WantedBy=multi-user.target
`

type DockerInstallPlan struct {
	WorkDir    string
	BundleFile string
	BundleURL  string
}

func InstallDockerWithProgress(ctx context.Context, r Runner, plan DockerInstallPlan, progress ProgressFunc) error {
	if err := prepareDockerInstallDir(plan.WorkDir); err != nil {
		return fmt.Errorf("create docker install dir: %w", err)
	}
	if plan.BundleURL != "" {
		if err := DownloadFile(ctx, plan.BundleURL, plan.BundleFile, progress); err != nil {
			return fmt.Errorf("download docker bundle: %w", err)
		}
	}
	return installDockerBundle(ctx, r, plan)
}

func InstallDockerFromLocalBundle(ctx context.Context, r Runner, plan DockerInstallPlan) error {
	if err := prepareDockerInstallDir(plan.WorkDir); err != nil {
		return fmt.Errorf("create docker install dir: %w", err)
	}
	return installDockerBundle(ctx, r, plan)
}

func prepareDockerInstallDir(dir string) error {
	info, err := os.Stat(dir)
	if err == nil {
		if info.IsDir() {
			return nil
		}
		if err := os.Remove(dir); err != nil {
			return err
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	return os.MkdirAll(dir, 0o755)
}

func installDockerBundle(ctx context.Context, r Runner, plan DockerInstallPlan) error {
	if err := run(ctx, r, "tar", "-zxf", plan.BundleFile, "-C", plan.WorkDir); err != nil {
		return fmt.Errorf("extract docker bundle: %w", err)
	}
	if err := runShell(ctx, r, fmt.Sprintf("install -m 0755 '%s'/docker/* /usr/local/bin/", plan.WorkDir)); err != nil {
		return fmt.Errorf("install docker binaries: %w", err)
	}
	if err := run(ctx, r, "mkdir", "-p", "/usr/local/lib/docker/cli-plugins"); err != nil {
		return fmt.Errorf("create docker cli plugin dir: %w", err)
	}
	if err := run(ctx, r, "install", "-m", "0755", plan.WorkDir+"/docker-compose", "/usr/local/lib/docker/cli-plugins/docker-compose"); err != nil {
		return fmt.Errorf("install docker compose: %w", err)
	}
	if err := run(ctx, r, "ln", "-sf", "/usr/local/lib/docker/cli-plugins/docker-compose", "/usr/local/bin/docker-compose"); err != nil {
		return fmt.Errorf("link docker compose: %w", err)
	}
	if err := run(ctx, r, "mkdir", "-p", "/etc/systemd/system"); err != nil {
		return fmt.Errorf("create systemd unit dir: %w", err)
	}
	if err := runShell(ctx, r, "cat > /etc/systemd/system/docker.service <<'EOF'\n"+dockerService+"EOF\n"); err != nil {
		return fmt.Errorf("write docker service: %w", err)
	}
	if err := run(ctx, r, "systemctl", "daemon-reload"); err != nil {
		return fmt.Errorf("reload systemd: %w", err)
	}
	if err := run(ctx, r, "systemctl", "enable", "--now", "docker"); err != nil {
		_ = r.Run(ctx, "systemctl", "status", "--no-pager", "containerd")
		_ = r.Run(ctx, "systemctl", "status", "--no-pager", "docker")
		_ = r.Run(ctx, "journalctl", "-u", "containerd", "-u", "docker", "--no-pager", "-n", "120")
		return fmt.Errorf("start docker: %w", err)
	}
	return nil
}
