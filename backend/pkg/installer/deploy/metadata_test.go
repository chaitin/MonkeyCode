package deploy

import (
	"os"
	"path/filepath"
	"testing"
)

func TestWriteAndReadInstallMetadata(t *testing.T) {
	dir := t.TempDir()
	meta := InstallMetadata{Version: "2026.05.27", Commit: "32df5254", InstallDir: dir}
	if err := WriteInstallMetadata(dir, meta); err != nil {
		t.Fatal(err)
	}

	got, err := ReadInstallMetadata(dir)
	if err != nil {
		t.Fatal(err)
	}
	if got.Version != meta.Version || got.Commit != meta.Commit || got.InstallDir != dir {
		t.Fatalf("metadata = %#v", got)
	}
}

func TestBuildLegacyMetadata(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, ".env"), []byte("BACKEND_IMAGE=backend:old\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "docker-compose.yml"), []byte("services: {}\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	meta, err := BuildLegacyMetadata(dir)
	if err != nil {
		t.Fatal(err)
	}
	if meta.Version != "legacy" || meta.InstallDir != dir {
		t.Fatalf("legacy metadata = %#v", meta)
	}
}
