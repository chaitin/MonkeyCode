package deploy

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCreateAndRestoreCenterSnapshot(t *testing.T) {
	installDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(installDir, ".env"), []byte("A=old\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(installDir, "docker-compose.yml"), []byte("old-compose\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(installDir, "data", "postgres"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(installDir, "data", "postgres", "PG_VERSION"), []byte("17"), 0o644); err != nil {
		t.Fatal(err)
	}

	snap, err := CreateCenterSnapshot(installDir, filepath.Join(installDir, ".monkeycode", "backups", "snap"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(installDir, ".env"), []byte("A=new\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := RestoreCenterSnapshot(installDir, snap); err != nil {
		t.Fatal(err)
	}

	got, err := os.ReadFile(filepath.Join(installDir, ".env"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "A=old\n" {
		t.Fatalf(".env = %q", got)
	}
}
