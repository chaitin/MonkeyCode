package relay

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

func validatePreviewTemplate(template, control, files string) error {
	if template == "" {
		return nil
	}
	if strings.Count(template, "{artifact}") != 1 || !strings.HasPrefix(template, "https://{artifact}.") {
		return errors.New("预览 origin 模板必须为 https://{artifact}.<独立域名>")
	}
	u, err := url.Parse(strings.Replace(template, "{artifact}", strings.Repeat("a", 32), 1))
	if err != nil || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.Port() != "" {
		return errors.New("预览 origin 模板不能包含端口、路径或凭据")
	}
	base := strings.TrimPrefix(u.Hostname(), strings.Repeat("a", 32)+".")
	if !strings.Contains(base, ".") || net.ParseIP(base) != nil || strings.ContainsAny(base, "{} /\\") {
		return errors.New("预览必须使用独立域名")
	}
	for _, origin := range []string{control, files} {
		target, err := url.Parse(origin)
		if err != nil {
			return err
		}
		host := strings.ToLower(target.Hostname())
		if base == host || strings.HasSuffix(host, "."+base) {
			return errors.New("预览域名不能覆盖登录或共享文件 origin")
		}
	}
	return nil
}

func PreviewOrigin(template, server, user, machine, session, artifact string) string {
	value := sha256.Sum256([]byte(server + "/" + user + "/" + machine + "/" + session + "/" + artifact))
	return strings.Replace(template, "{artifact}", hex.EncodeToString(value[:16]), 1)
}

func previewHost(template, host string) bool {
	if template == "" {
		return false
	}
	u, _ := url.Parse(strings.Replace(template, "{artifact}", "artifact", 1))
	base := strings.TrimPrefix(u.Host, "artifact.")
	host = strings.ToLower(host)
	if !strings.HasSuffix(host, "."+base) {
		return false
	}
	label := strings.TrimSuffix(host, "."+base)
	_, err := hex.DecodeString(label)
	return len(label) == 32 && err == nil
}

func previewDomain(template, host string) bool {
	if name, _, err := net.SplitHostPort(host); err == nil {
		host = name
	}
	if template == "" {
		return false
	}
	u, err := url.Parse(strings.Replace(template, "{artifact}", "artifact", 1))
	if err != nil {
		return false
	}
	base := strings.TrimPrefix(u.Host, "artifact.")
	host = strings.ToLower(host)
	return host == base || strings.HasSuffix(host, "."+base)
}

func PreviewGuard(template string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if previewDomain(template, r.Host) && !strings.HasPrefix(r.URL.Path, "/preview/") {
				failure(r.Context(), w, 404, "device_not_found")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func (s *Service) preview(w http.ResponseWriter, r *http.Request) {
	if s.config.PreviewOriginTemplate == "" {
		failure(r.Context(), w, 404, "device_not_found")
		return
	}
	if r.Method != "GET" && r.Method != "HEAD" || !previewHost(s.config.PreviewOriginTemplate, r.Host) {
		failure(r.Context(), w, 403, "permission_denied")
		return
	}
	machine, raw := chi.URLParam(r, "machine"), chi.URLParam(r, "grant")
	requested := "/" + chi.URLParam(r, "*")
	if r.URL.RawPath != "" {
		decoded, err := url.PathUnescape(requested)
		if err != nil {
			failure(r.Context(), w, 400, "invalid_request")
			return
		}
		requested = decoded
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	grant, current, err := s.verifyFile(ctx, machine, raw, requested)
	cancel()
	if err != nil {
		fail(r.Context(), w, err)
		return
	}
	expected := PreviewOrigin(s.config.PreviewOriginTemplate, grant.ServerID, grant.OwnerUserID, grant.MachineID, grant.SessionID, grant.ArtifactID)
	u, err := url.Parse(expected)
	if err != nil || !validUUID(grant.ArtifactID) || grant.PreviewOrigin != expected || r.Host != u.Host || grant.Scope != "directory" {
		failure(r.Context(), w, 403, "permission_denied")
		return
	}
	// opaque-origin 沙箱明确禁止持久存储、服务工作线程、表单和嵌套应用。
	w.Header().Set("Content-Security-Policy", "sandbox allow-scripts; default-src 'none'; script-src "+expected+" 'unsafe-inline'; style-src "+expected+" 'unsafe-inline'; img-src "+expected+" data: blob:; media-src "+expected+" data: blob:; font-src "+expected+" data:; connect-src 'none'; worker-src 'none'; frame-src 'none'; form-action 'none'; object-src 'none'; base-uri "+expected+"; frame-ancestors "+s.config.PublicURL)
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), usb=(), payment=(), storage-access=()")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	r = r.Clone(r.Context())
	r.Header = r.Header.Clone()
	r.Header.Del("Authorization")
	r.Header.Del("Cookie")
	a := &access{verifiedAt: time.Now(), expiresAt: grant.ExpiresAt, fileExpiresAt: grant.ExpiresAt, scopes: []string{"files:read"}, grantVersion: grant.GrantVersion}
	s.forward(w, r, current, a, true, "/files/"+raw+requested, "", false)
}
