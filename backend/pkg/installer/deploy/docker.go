package deploy

import (
	"context"
	"strings"
)

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

func parseDockerVersion(out string) string {
	out = strings.TrimSpace(out)
	parts := strings.Fields(out)
	for i, p := range parts {
		if p == "version" && i+1 < len(parts) {
			return strings.TrimSuffix(parts[i+1], ",")
		}
	}
	return out
}

func parseComposeVersion(out string) string {
	out = strings.TrimSpace(out)
	parts := strings.Fields(out)
	for i, p := range parts {
		if p == "version" && i+1 < len(parts) {
			return parts[i+1]
		}
	}
	return out
}
