package tests

import (
	"os"
	"strings"
	"testing"
)

func TestOfflineComposeImagesUseVariables(t *testing.T) {
	content := readFile(t, "../../docker-compose.yml")
	for _, want := range []string{
		"image: ${POSTGRES_IMAGE}",
		"image: ${REDIS_IMAGE}",
		"image: ${CLICKHOUSE_IMAGE}",
		"image: ${RUSTFS_IMAGE}",
		"image: ${INGRESS_IMAGE}",
		"image: ${TASKFLOW_IMAGE}",
		"image: ${FRONTEND_IMAGE}",
		"image: ${BACKEND_IMAGE}",
	} {
		if !strings.Contains(content, want) {
			t.Fatalf("docker-compose.yml missing %q", want)
		}
	}
	for _, forbidden := range []string{
		"image: chaitin-registry.cn-hangzhou.cr.aliyuncs.com",
		"image: ghcr.1ms.run",
	} {
		if strings.Contains(content, forbidden) {
			t.Fatalf("docker-compose.yml still contains fixed image %q", forbidden)
		}
	}
}

func TestOfflineComposePassesInitTeamImageToBackend(t *testing.T) {
	content := readFile(t, "../../docker-compose.yml")
	if !strings.Contains(content, "MCAI_INIT_TEAM_IMAGE: ${INIT_TEAM_IMAGE:-}") {
		t.Fatalf("docker-compose.yml missing MCAI_INIT_TEAM_IMAGE backend env")
	}
}

func TestOfflineComposeUsesInstallDirBindMounts(t *testing.T) {
	content := readFile(t, "../../docker-compose.yml")
	for _, want := range []string{
		"${INSTALL_DIR}/data/postgres:/var/lib/postgresql/data",
		"${INSTALL_DIR}/data/redis:/data",
		"${INSTALL_DIR}/data/clickhouse:/var/lib/clickhouse",
		"${INSTALL_DIR}/logs/clickhouse:/var/log/clickhouse-server",
		"${INSTALL_DIR}/data/rustfs:/data",
		"${INSTALL_DIR}/logs/rustfs:/app/logs",
		"${INSTALL_DIR}/tls:/etc/tls",
		"${INSTALL_DIR}/static:/app/static",
	} {
		if !strings.Contains(content, want) {
			t.Fatalf("docker-compose.yml missing bind mount %q", want)
		}
	}
	for _, forbidden := range []string{
		"pg_data:",
		"redis_data:",
		"ch_data:",
		"rustfs_data:",
		"- ./logs/",
		"- ./tls:",
		"- ./static:",
	} {
		if strings.Contains(content, forbidden) {
			t.Fatalf("docker-compose.yml still contains %q", forbidden)
		}
	}
}

func TestOfflinePackageScriptDoesNotRetagImagesToLocal(t *testing.T) {
	content := readFile(t, "../build-offline-package.sh")
	for _, forbidden := range []string{"docker tag ", ":local", "monkeycode-offline/backend:local"} {
		if strings.Contains(content, forbidden) {
			t.Fatalf("build-offline-package.sh still contains %q", forbidden)
		}
	}
	for _, want := range []string{
		"IMAGE_TAG=\"${IMAGE_TAG:-$(git describe --tags --exact-match",
		"-t \"$BACKEND_IMAGE\"",
		"docker save \"$BACKEND_IMAGE\"",
		"set_env_value BACKEND_IMAGE \"$BACKEND_IMAGE\"",
	} {
		if !strings.Contains(content, want) {
			t.Fatalf("build-offline-package.sh missing %q", want)
		}
	}
}

func TestOfflinePackageIncludesDevboxInHostBundle(t *testing.T) {
	content := readFile(t, "../build-offline-package.sh")
	for _, want := range []string{
		`DEVBOX_IMAGE="${DEVBOX_IMAGE:-ghcr.io/chaitin/monkeycode-runner/devbox:latest}"`,
		`set_env_value INIT_TEAM_IMAGE "$DEVBOX_IMAGE"`,
		`docker pull "$DEVBOX_IMAGE"`,
		`docker save "$DEVBOX_IMAGE" | gzip > "$tmp/images/devbox.tar.gz"`,
	} {
		if !strings.Contains(content, want) {
			t.Fatalf("build-offline-package.sh missing %q", want)
		}
	}
}

func TestHostComposeImageUsesVariable(t *testing.T) {
	content := readFile(t, "../../installation/runner/docker-compose.yml")
	if !strings.Contains(content, "image: ${ORCHESTRATOR_IMAGE}") {
		t.Fatalf("runner docker-compose.yml missing ORCHESTRATOR_IMAGE")
	}
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(content)
}
