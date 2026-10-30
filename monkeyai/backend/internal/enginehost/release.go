package enginehost

import (
	_ "embed"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"

	"github.com/go-chi/chi/v5"
)

//go:embed install.sh
var installer []byte
var files = map[string]bool{"monkeyai-engine": true, "containerd": true, "runsc": true, "containerd-shim-runsc-v1": true, "bridge": true, "ptp": true, "host-local": true, "loopback": true, "checkpointgofer": true, "gvisor-proc-umounter": true, "gvisor-sentry-prewarmer": true, "gvisor_sentry": true, "runsc-fd-parking": true, "runsc-metric-server": true}

type manifest struct {
	Version      string            `json:"version"`
	Architecture string            `json:"architecture"`
	Files        map[string]string `json:"files"`
}

func (s *Service) manifest(version, arch string) (manifest, []byte, error) {
	var m manifest
	if s.releases == "" || !versionPattern.MatchString(version) || (arch != "amd64" && arch != "arm64") {
		return m, nil, errors.New("发行配置无效")
	}
	raw, err := os.ReadFile(filepath.Join(s.releases, version, arch, "manifest.json"))
	if err != nil {
		return m, nil, err
	}
	if len(raw) > 16<<10 || json.Unmarshal(raw, &m) != nil || m.Version != version || m.Architecture != arch || len(m.Files) != len(files) {
		return m, nil, errors.New("发行清单无效")
	}
	for name := range files {
		if !hashPattern.MatchString(m.Files[name]) {
			return m, nil, errors.New("发行摘要缺失")
		}
		info, err := os.Lstat(filepath.Join(s.releases, version, arch, name))
		if err != nil || !info.Mode().IsRegular() || info.Size() == 0 || info.Size() > 256<<20 {
			return m, nil, errors.New("发行文件缺失或类型无效")
		}
	}
	return m, raw, nil
}
func (s *Service) script(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/x-shellscript; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write(installer)
}
func (s *Service) artifact(w http.ResponseWriter, r *http.Request) {
	version, arch, name := chi.URLParam(r, "version"), chi.URLParam(r, "arch"), chi.URLParam(r, "file")
	if name != "manifest.json" && !files[name] {
		http.NotFound(w, r)
		return
	}
	if _, _, err := s.manifest(version, arch); err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Type", "application/octet-stream")
	http.ServeFile(w, r, filepath.Join(s.releases, version, arch, name))
}
