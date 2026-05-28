package deploy

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

type PackageManifest struct {
	Version        string          `json:"version"`
	Commit         string          `json:"commit"`
	BuiltAt        string          `json:"built_at"`
	Arch           string          `json:"arch"`
	MinUpgradeFrom string          `json:"min_upgrade_from"`
	ComposeSHA256  string          `json:"compose_sha256"`
	StaticSHA256   string          `json:"static_sha256"`
	Images         []ManifestImage `json:"images"`
	HostBundles    []HostBundle    `json:"host_bundles"`
}

type ManifestImage struct {
	Name    string `json:"name"`
	Archive string `json:"archive"`
	Image   string `json:"image"`
	SHA256  string `json:"sha256"`
}

type HostBundle struct {
	Arch   string `json:"arch"`
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
}

func ReadPackageManifest(packageDir string) (PackageManifest, error) {
	data, err := os.ReadFile(filepath.Join(packageDir, "manifest.json"))
	if err != nil {
		return PackageManifest{}, fmt.Errorf("read manifest: %w", err)
	}

	var manifest PackageManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return PackageManifest{}, fmt.Errorf("parse manifest: %w", err)
	}
	return manifest, nil
}

func ValidatePackageManifest(packageDir string, manifest PackageManifest) error {
	if manifest.Version == "" || manifest.Arch == "" {
		return fmt.Errorf("manifest missing version or arch")
	}
	if len(manifest.Images) == 0 {
		return fmt.Errorf("manifest missing images")
	}
	if len(manifest.HostBundles) == 0 {
		return fmt.Errorf("manifest missing host bundles")
	}

	for _, image := range manifest.Images {
		if err := validateManifestFile(packageDir, image.Archive, image.SHA256); err != nil {
			return fmt.Errorf("validate image %s: %w", image.Name, err)
		}
	}
	for _, bundle := range manifest.HostBundles {
		if err := validateManifestFile(packageDir, bundle.Path, bundle.SHA256); err != nil {
			return fmt.Errorf("validate host bundle %s: %w", bundle.Arch, err)
		}
	}
	return nil
}

func validateManifestFile(root, rel, want string) error {
	if rel == "" {
		return fmt.Errorf("empty path")
	}

	path := filepath.Join(root, rel)
	if _, err := os.Stat(path); err != nil {
		return err
	}
	if want == "" {
		return nil
	}

	got, err := fileSHA256(path)
	if err != nil {
		return err
	}
	if got != want {
		return fmt.Errorf("sha256 mismatch for %s", rel)
	}
	return nil
}

func fileSHA256(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()

	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}
