package deploy

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestUpgradeHostBacksUpAndRestartsRunner(t *testing.T) {
	dir := t.TempDir()
	writeMinimalHostInstall(t, dir)
	r := &FakeRunner{}
	bundleFile := filepath.Join(t.TempDir(), "host.tgz")
	if err := os.WriteFile(bundleFile, []byte("fake"), 0o644); err != nil {
		t.Fatal(err)
	}
	plan := HostUpgradePlan{
		WorkDir:    dir,
		BundleFile: bundleFile,
		Token:      "token-new",
		GrpcURL:    "127.0.0.1:50443",
	}

	if err := UpgradeHost(context.Background(), r, plan); err != nil {
		t.Fatal(err)
	}

	calls := strings.Join(r.Calls, "\n")
	if !strings.Contains(calls, "docker compose -f "+filepath.Join(dir, "docker-compose.yml")+" --env-file "+filepath.Join(dir, ".env")+" down") {
		t.Fatalf("missing compose down:\n%s", calls)
	}
	if !strings.Contains(calls, "docker compose -f "+filepath.Join(dir, "docker-compose.yml")+" --env-file "+filepath.Join(dir, ".env")+" up -d") {
		t.Fatalf("missing compose up:\n%s", calls)
	}
}

func writeMinimalHostInstall(t *testing.T, dir string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(dir, "images"), 0o755); err != nil {
		t.Fatal(err)
	}
	files := map[string]string{
		".env":               "TOKEN=old\nGRPC_URL=old:50443\n",
		"docker-compose.yml": "services: {}\n",
		"images/runner.tar":  "image",
	}
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}
