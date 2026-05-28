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

func TestCreateCenterSnapshotPreservesDirectorySymlink(t *testing.T) {
	installDir := t.TempDir()
	storeDir := filepath.Join(installDir, "data", "clickhouse", "store", "abc")
	if err := os.MkdirAll(storeDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(storeDir, "data.bin"), []byte("rows"), 0o644); err != nil {
		t.Fatal(err)
	}
	dbDir := filepath.Join(installDir, "data", "clickhouse", "data", "monkeycode%2Dai")
	if err := os.MkdirAll(dbDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("../../store/abc", filepath.Join(dbDir, "task_logs")); err != nil {
		t.Fatal(err)
	}

	backupDir := filepath.Join(installDir, ".monkeycode", "backups", "snap")
	if _, err := CreateCenterSnapshot(installDir, backupDir); err != nil {
		t.Fatal(err)
	}

	link := filepath.Join(backupDir, "data", "clickhouse", "data", "monkeycode%2Dai", "task_logs")
	got, err := os.Readlink(link)
	if err != nil {
		t.Fatal(err)
	}
	if got != "../../store/abc" {
		t.Fatalf("symlink target = %q, want %q", got, "../../store/abc")
	}

	if err := os.RemoveAll(filepath.Join(installDir, "data")); err != nil {
		t.Fatal(err)
	}
	if err := RestoreCenterSnapshot(installDir, CenterSnapshot{Path: backupDir}); err != nil {
		t.Fatal(err)
	}
	restored := filepath.Join(installDir, "data", "clickhouse", "data", "monkeycode%2Dai", "task_logs")
	got, err = os.Readlink(restored)
	if err != nil {
		t.Fatal(err)
	}
	if got != "../../store/abc" {
		t.Fatalf("restored symlink target = %q, want %q", got, "../../store/abc")
	}
}
