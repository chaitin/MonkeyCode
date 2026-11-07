package enginehost

import (
	"net/http"

	"net/url"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

func (s *Service) upgradeCommand(w http.ResponseWriter, r *http.Request) {
	if !secureServer(s.server) {
		fail(w, r, 503, "请先配置宿主可访问的 HTTPS 服务地址")
		return
	}
	for _, arch := range []string{"amd64", "arm64"} {
		m, _, err := s.manifest(s.version, arch)
		if err != nil || m.Files["dockerd"] == "" || m.Files["installer"] == "" {
			fail(w, r, 503, "服务器缺少完整的 Docker engine 升级资源")
			return
		}
	}
	address := s.server + "/api/host/v1/install.sh?version=" + url.QueryEscape(s.version)
	command := "sudo bash -c \"$(curl -kfsSL " + quote(address) + " || echo 'exit 1')\""
	w.Header().Set("Cache-Control", "no-store")
	resource.JSON(r.Context(), w, 200, map[string]string{"version": s.version, "command": command})
}
func (s *Service) upgradeScript(w http.ResponseWriter, r *http.Request) {
	s.script(w, r)
}
