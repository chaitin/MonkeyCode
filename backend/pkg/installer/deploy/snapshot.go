package deploy

import (
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
)

type CenterSnapshot struct {
	Path string
}

func CreateCenterSnapshot(installDir, backupDir string) (CenterSnapshot, error) {
	if err := os.MkdirAll(backupDir, 0o755); err != nil {
		return CenterSnapshot{}, err
	}

	for _, name := range centerSnapshotPaths() {
		src := filepath.Join(installDir, name)
		dst := filepath.Join(backupDir, name)
		if err := copyPathIfExists(src, dst); err != nil {
			return CenterSnapshot{}, fmt.Errorf("backup %s: %w", name, err)
		}
	}
	return CenterSnapshot{Path: backupDir}, nil
}

func RestoreCenterSnapshot(installDir string, snap CenterSnapshot) error {
	for _, name := range centerSnapshotPaths() {
		src := filepath.Join(snap.Path, name)
		dst := filepath.Join(installDir, name)
		if _, err := os.Stat(src); os.IsNotExist(err) {
			continue
		}
		if err := os.RemoveAll(dst); err != nil {
			return err
		}
		if err := copyPathIfExists(src, dst); err != nil {
			return fmt.Errorf("restore %s: %w", name, err)
		}
	}
	return nil
}

func centerSnapshotPaths() []string {
	return []string{".env", "docker-compose.yml", "tls", "static", "images", "data", "logs", ".monkeycode/current.json"}
}

func copyPathIfExists(src, dst string) error {
	info, err := os.Stat(src)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if info.IsDir() {
		return copyDir(src, dst)
	}
	return copyFileMode(src, dst, info.Mode())
}

func copyDir(src, dst string) error {
	return filepath.WalkDir(src, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}

		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return os.MkdirAll(target, info.Mode())
		}
		return copyFileMode(path, target, info.Mode())
	})
}

func copyFileMode(src, dst string, mode os.FileMode) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, mode)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, in)
	return err
}
