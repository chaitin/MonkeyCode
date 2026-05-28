package deploy

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReadPackageManifest(t *testing.T) {
	dir := t.TempDir()
	content := `{
		"version": "2026.05.27",
		"commit": "32df5254",
		"built_at": "2026-05-27T10:00:00+08:00",
		"arch": "amd64",
		"min_upgrade_from": "2026.05.01",
		"compose_sha256": "abc",
		"static_sha256": "def",
		"images": [{"name":"backend","archive":"images/backend.tar.gz","image":"repo/backend:32df5254","sha256":"123"}],
		"host_bundles": [{"arch":"x86_64","path":"static/installer/x86_64/host.tgz","sha256":"456"}]
	}`
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}

	m, err := ReadPackageManifest(dir)
	if err != nil {
		t.Fatal(err)
	}
	if m.Version != "2026.05.27" || m.Commit != "32df5254" || len(m.Images) != 1 || len(m.HostBundles) != 1 {
		t.Fatalf("manifest = %#v", m)
	}
}

func TestValidatePackageManifestRequiresHostBundles(t *testing.T) {
	m := PackageManifest{Version: "2026.05.27", Arch: "amd64"}
	err := ValidatePackageManifest(t.TempDir(), m)
	if err == nil {
		t.Fatal("expected error")
	}
}
