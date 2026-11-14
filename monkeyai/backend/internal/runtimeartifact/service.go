package runtimeartifact

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/web"
	"github.com/go-chi/chi/v5"
)

type Service struct{ root, version string }

func New(root, version string) *Service {
	return &Service{root: filepath.Clean(root), version: version}
}
func (s *Service) Current(arch string) (environment.RuntimePackage, error) {
	version := s.version
	if version == "" {
		raw, err := os.ReadFile(filepath.Join(s.root, "latest.json"))
		if err != nil {
			return environment.RuntimePackage{}, err
		}
		var latest struct {
			Version string `json:"version"`
		}
		if len(raw) > 4096 || json.Unmarshal(raw, &latest) != nil {
			return environment.RuntimePackage{}, errors.New("runtime latest 清单无效")
		}
		version = latest.Version
	}
	return s.Get(version, arch)
}
func (s *Service) Get(version, arch string) (environment.RuntimePackage, error) {
	var release environment.RuntimePackage
	if version == "" || strings.ContainsAny(version, "/\\\x00") || version == "." || version == ".." || (arch != "amd64" && arch != "arm64") {
		return release, errors.New("runtime 版本或架构无效")
	}
	folder := filepath.Join(s.root, version, arch)
	for _, path := range []string{filepath.Join(s.root, version), folder} {
		info, err := os.Lstat(path)
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return release, errors.New("runtime 发行目录无效")
		}
	}
	path := filepath.Join(folder, "manifest.json")
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Size() > 16<<10 {
		return release, errors.New("runtime 发行清单无效")
	}
	raw, err := os.ReadFile(path)
	if err != nil || json.Unmarshal(raw, &release) != nil {
		return release, errors.New("runtime 发行清单无法读取")
	}
	if release.Version != version {
		return release, errors.New("runtime 版本不一致")
	}
	if err := release.Validate(arch); err != nil {
		return release, err
	}
	for name, expected := range release.Files {
		actual, err := os.Lstat(filepath.Join(folder, name))
		if err != nil || !actual.Mode().IsRegular() || actual.Size() != expected.Size {
			return release, errors.New("runtime 发行文件缺失或大小不符")
		}
	}
	return release, nil
}
func (s *Service) RegisterHost(router chi.Router) {
	router.Get("/api/host/v1/runtime-releases/{version}/{arch}/{file}", s.artifact)
}
func (s *Service) artifact(w http.ResponseWriter, r *http.Request) {
	version, arch, file := chi.URLParam(r, "version"), chi.URLParam(r, "arch"), chi.URLParam(r, "file")
	release, err := s.Get(version, arch)
	if err != nil {
		web.NotFound(w, r)
		return
	}
	if file != "manifest.json" {
		if _, ok := release.Files[file]; !ok {
			web.NotFound(w, r)
			return
		}
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/octet-stream")
	http.ServeFile(w, r, filepath.Join(s.root, version, arch, file))
}
