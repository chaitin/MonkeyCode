package enginehost

import (
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/web"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"
)

//go:embed install.sh
var installer []byte
var legacyFiles = map[string]bool{"monkeyai-engine": true, "containerd": true, "runsc": true, "containerd-shim-runsc-v1": true, "bridge": true, "ptp": true, "host-local": true, "loopback": true, "checkpointgofer": true, "gvisor-proc-umounter": true, "gvisor-sentry-prewarmer": true, "gvisor_sentry": true, "runsc-fd-parking": true, "runsc-metric-server": true}
var files = map[string]bool{"installer": true, "checkpointgofer": true, "containerd": true, "containerd-shim-runc-v2": true, "ctr": true, "docker": true, "docker-init": true, "docker-proxy": true, "dockerd": true, "gvisor-proc-umounter": true, "gvisor-sentry-prewarmer": true, "gvisor_sentry": true, "monkeyai-engine": true, "runc": true, "runsc": true, "runsc-fd-parking": true, "runsc-metric-server": true}

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
	if len(raw) > 16<<10 || json.Unmarshal(raw, &m) != nil || m.Version != version || m.Architecture != arch || !validReleaseFiles(m.Files) {
		return m, nil, errors.New("发行清单无效")
	}
	for name := range m.Files {
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
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	if !validServer(s.server) {
		http.Error(w, web.Message(r.Context(), "", "后台 HTTP(S) 地址无效"), 503)
		return
	}
	secret := r.URL.Query().Get("token")
	version := r.URL.Query().Get("version")
	if secret != "" || r.URL.Query().Has("token") {
		var err error
		version, err = s.installationVersion(r.Context(), secret)
		if err != nil {
			http.Error(w, web.Message(r.Context(), "", "安装命令无效或已过期"), 401)
			return
		}
	} else if version == "" {
		version = s.version
	}
	if !versionPattern.MatchString(version) || version == "latest" {
		http.Error(w, web.Message(r.Context(), "", "升级版本无效"), 400)
		return
	}
	var body strings.Builder
	body.WriteString("#!/bin/bash\ninstall_engine() {\ncase \"$(uname -m)\" in\n")
	for _, arch := range []string{"amd64", "arm64"} {
		m, raw, err := s.manifest(version, arch)
		if err != nil {
			http.Error(w, web.Message(r.Context(), "", "服务器安装资源不完整"), http.StatusServiceUnavailable)
			return
		}
		pattern := "x86_64|amd64"
		if arch == "arm64" {
			pattern = "aarch64|arm64"
		}
		binary := "installer"
		if !hasInstaller(m.Files) {
			if secret == "" {
				http.Error(w, web.Message(r.Context(), "", "服务器安装资源不完整"), 503)
				return
			}
			binary = "monkeyai-engine"
		}
		args := []string{s.server, secret, version, arch, m.Files[binary], hash(raw), "", binary}
		for i := range args {
			args[i] = quote(args[i])
		}
		fmt.Fprintf(&body, "%s) set -- %s ;;\n", pattern, strings.Join(args, " "))
	}
	body.WriteString("*) echo '仅支持 amd64 / arm64' >&2; return 1 ;;\nesac\n")
	body.Write(installer)
	body.WriteString("\n}\ninstall_engine\n")
	w.Header().Set("Content-Type", "text/x-shellscript; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write([]byte(body.String()))
}
func (s *Service) artifact(w http.ResponseWriter, r *http.Request) {
	version, arch, name := chi.URLParam(r, "version"), chi.URLParam(r, "arch"), chi.URLParam(r, "file")
	if name != "manifest.json" && name != "resources.tgz" && !files[name] && !legacyFiles[name] {
		web.NotFound(w, r)
		return
	}
	if s.releases == "" {
		web.NotFound(w, r)
		return
	}
	if _, _, err := s.manifest(version, arch); err != nil {
		web.NotFound(w, r)
		return
	}
	if name == "resources.tgz" {
		info, err := os.Lstat(filepath.Join(s.releases, version, arch, name))
		if err != nil || !info.Mode().IsRegular() || info.Size() == 0 || info.Size() > 2<<30 {
			web.NotFound(w, r)
			return
		}
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Type", "application/octet-stream")
	http.ServeFile(w, r, filepath.Join(s.releases, version, arch, name))
}

func validReleaseFiles(got map[string]string) bool {
	for _, expected := range []map[string]bool{files, legacyFiles} {
		if len(got) != len(expected) && !(expected["installer"] && !hasInstaller(got) && len(got) == len(expected)-1) {
			continue
		}
		ok := true
		for name := range got {
			if !expected[name] {
				ok = false
				break
			}
		}
		if ok {
			return true
		}
	}
	return false
}

func hasInstaller(files map[string]string) bool { return files["installer"] != "" }
