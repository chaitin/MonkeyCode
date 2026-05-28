package deploy

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

type InstallMetadata struct {
	Version      string   `json:"version"`
	Commit       string   `json:"commit"`
	InstallDir   string   `json:"install_dir"`
	ComposeSHA   string   `json:"compose_sha256"`
	StaticSHA    string   `json:"static_sha256"`
	Images       []string `json:"images"`
	LastUpgraded string   `json:"last_upgraded"`
}

type UpgradeRecord struct {
	Type       string `json:"type"`
	From       string `json:"from"`
	To         string `json:"to"`
	BackupDir  string `json:"backup_dir"`
	StartedAt  string `json:"started_at"`
	FinishedAt string `json:"finished_at"`
	Status     string `json:"status"`
	Error      string `json:"error,omitempty"`
}

func metadataDir(installDir string) string {
	return filepath.Join(installDir, ".monkeycode")
}

func currentMetadataPath(installDir string) string {
	return filepath.Join(metadataDir(installDir), "current.json")
}

func ReadInstallMetadata(installDir string) (InstallMetadata, error) {
	data, err := os.ReadFile(currentMetadataPath(installDir))
	if err != nil {
		return InstallMetadata{}, err
	}

	var meta InstallMetadata
	if err := json.Unmarshal(data, &meta); err != nil {
		return InstallMetadata{}, err
	}
	return meta, nil
}

func WriteInstallMetadata(installDir string, meta InstallMetadata) error {
	if err := os.MkdirAll(metadataDir(installDir), 0o755); err != nil {
		return err
	}

	data, err := json.MarshalIndent(meta, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(currentMetadataPath(installDir), append(data, '\n'), 0o644)
}

func BuildLegacyMetadata(installDir string) (InstallMetadata, error) {
	for _, name := range []string{".env", "docker-compose.yml"} {
		if _, err := os.Stat(filepath.Join(installDir, name)); err != nil {
			return InstallMetadata{}, fmt.Errorf("legacy install missing %s: %w", name, err)
		}
	}

	composeSHA, _ := fileSHA256(filepath.Join(installDir, "docker-compose.yml"))
	return InstallMetadata{
		Version:    "legacy",
		Commit:     "legacy",
		InstallDir: installDir,
		ComposeSHA: composeSHA,
	}, nil
}

func WriteUpgradeRecord(installDir string, record UpgradeRecord) error {
	if record.StartedAt == "" {
		record.StartedAt = time.Now().Format(time.RFC3339)
	}
	if err := os.MkdirAll(filepath.Join(metadataDir(installDir), "upgrades"), 0o755); err != nil {
		return err
	}

	name := time.Now().Format("20060102-150405") + ".json"
	data, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(metadataDir(installDir), "upgrades", name), append(data, '\n'), 0o644)
}
