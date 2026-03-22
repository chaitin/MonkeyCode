package file

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
)

type Manager struct {
	logger *slog.Logger
}

func NewManager(logger *slog.Logger) *Manager {
	return &Manager{logger: logger}
}

func (m *Manager) Upload(ctx context.Context, containerID, destPath string, reader io.Reader, mode os.FileMode) error {
	if containerID == "" {
		return fmt.Errorf("container_id is required")
	}
	if destPath == "" {
		return fmt.Errorf("destination path is required")
	}

	return fmt.Errorf("upload requires docker cp - implement with docker SDK")
}

func (m *Manager) Download(ctx context.Context, containerID, srcPath string, writer io.Writer) error {
	if containerID == "" {
		return fmt.Errorf("container_id is required")
	}
	if srcPath == "" {
		return fmt.Errorf("source path is required")
	}

	return fmt.Errorf("download requires docker cp - implement with docker SDK")
}

func (m *Manager) List(ctx context.Context, containerID, path string) ([]FileInfo, error) {
	return nil, fmt.Errorf("list requires docker exec - implement with docker SDK")
}

func (m *Manager) Delete(ctx context.Context, containerID, path string) error {
	return fmt.Errorf("delete requires docker exec - implement with docker SDK")
}

func (m *Manager) Mkdir(ctx context.Context, containerID, path string) error {
	return fmt.Errorf("mkdir requires docker exec - implement with docker SDK")
}

type FileInfo struct {
	Name    string
	Path    string
	IsDir   bool
	Size    int64
	Mode    os.FileMode
	ModTime int64
}

func (m *Manager) TarGZ(ctx context.Context, srcDir, destFile string) error {
	srcInfo, err := os.Stat(srcDir)
	if err != nil {
		return fmt.Errorf("source directory not found: %w", err)
	}
	if !srcInfo.IsDir() {
		return fmt.Errorf("source is not a directory")
	}

	destDir := filepath.Dir(destFile)
	if err := os.MkdirAll(destDir, 0755); err != nil {
		return fmt.Errorf("failed to create destination directory: %w", err)
	}

	outFile, err := os.Create(destFile)
	if err != nil {
		return fmt.Errorf("failed to create archive file: %w", err)
	}
	defer outFile.Close()

	gzWriter := gzip.NewWriter(outFile)
	defer gzWriter.Close()

	tarWriter := tar.NewWriter(gzWriter)
	defer tarWriter.Close()

	err = filepath.Walk(srcDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		relPath, err := filepath.Rel(srcDir, path)
		if err != nil {
			return err
		}

		header, err := tar.FileInfoHeader(info, relPath)
		if err != nil {
			return err
		}
		header.Name = relPath

		if err := tarWriter.WriteHeader(header); err != nil {
			return err
		}

		if !info.IsDir() {
			file, err := os.Open(path)
			if err != nil {
				return err
			}
			defer file.Close()

			if _, err := io.Copy(tarWriter, file); err != nil {
				return err
			}
		}

		return nil
	})

	if err != nil {
		return err
	}

	m.logger.Info("archive created", "src", srcDir, "dest", destFile)
	return nil
}

func (m *Manager) UntarGZ(ctx context.Context, srcFile, destDir string) error {
	inFile, err := os.Open(srcFile)
	if err != nil {
		return fmt.Errorf("failed to open archive: %w", err)
	}
	defer inFile.Close()

	gzReader, err := gzip.NewReader(inFile)
	if err != nil {
		return fmt.Errorf("failed to create gzip reader: %w", err)
	}
	defer gzReader.Close()

	tarReader := tar.NewReader(gzReader)

	for {
		header, err := tarReader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}

		targetPath := filepath.Join(destDir, header.Name)

		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(targetPath, os.FileMode(header.Mode)); err != nil {
				return err
			}
		case tar.TypeReg:
			outFile, err := os.OpenFile(targetPath, os.O_CREATE|os.O_WRONLY, os.FileMode(header.Mode))
			if err != nil {
				return err
			}
			if _, err := io.Copy(outFile, tarReader); err != nil {
				outFile.Close()
				return err
			}
			outFile.Close()
		}
	}

	m.logger.Info("archive extracted", "src", srcFile, "dest", destDir)
	return nil
}

func (m *Manager) Exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func (m *Manager) IsDir(path string) bool {
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	return info.IsDir()
}

func (m *Manager) Size(path string) (int64, error) {
	info, err := os.Stat(path)
	if err != nil {
		return 0, err
	}
	return info.Size(), nil
}

func (m *Manager) CleanPath(path string) string {
	path = filepath.Clean(path)
	path = strings.TrimPrefix(path, "/")
	path = strings.TrimPrefix(path, "..")
	for strings.Contains(path, "..") {
		path = strings.Replace(path, "..", "", -1)
	}
	return path
}
