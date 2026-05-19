package deploy

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPrepareDockerInstallDirReplacesFile(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "monkeycode-installer")
	if err := os.WriteFile(dir, []byte("stale"), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := prepareDockerInstallDir(dir); err != nil {
		t.Fatal(err)
	}

	info, err := os.Stat(dir)
	if err != nil {
		t.Fatal(err)
	}
	if !info.IsDir() {
		t.Fatalf("%s should be directory", dir)
	}
}

func TestPrepareDockerInstallDirKeepsDirectory(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "monkeycode-installer")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}

	if err := prepareDockerInstallDir(dir); err != nil {
		t.Fatal(err)
	}
}
