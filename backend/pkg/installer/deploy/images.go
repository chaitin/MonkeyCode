package deploy

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

func ScanImages(imagesDir string) ([]ImageArchive, error) {
	if _, err := os.Stat(imagesDir); err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var out []ImageArchive
	err := filepath.WalkDir(imagesDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		name := strings.ToLower(d.Name())
		switch {
		case strings.HasSuffix(name, ".tar.gz"), strings.HasSuffix(name, ".tgz"):
			out = append(out, ImageArchive{Path: path, Compressed: true})
		case strings.HasSuffix(name, ".tar"):
			out = append(out, ImageArchive{Path: path, Compressed: false})
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

func LoadImages(ctx context.Context, r Runner, images []ImageArchive) error {
	for _, image := range images {
		if image.Compressed {
			res := r.RunShell(ctx, fmt.Sprintf("gzip -dc '%s' | docker load", image.Path))
			if err := dockerLoadError(res); err != nil {
				return fmt.Errorf("load image %s: %w", image.Path, err)
			}
			continue
		}
		res := r.Run(ctx, "docker", "load", "-i", image.Path)
		if err := dockerLoadError(res); err != nil {
			return fmt.Errorf("load image %s: %w", image.Path, err)
		}
	}
	return nil
}

func dockerLoadError(res RunResult) error {
	output := strings.TrimSpace(res.Stdout + res.Stderr)
	if err := runError(res); err != nil {
		return err
	}
	if strings.Contains(output, "Error unpacking image") {
		return errors.New(output)
	}
	return nil
}
