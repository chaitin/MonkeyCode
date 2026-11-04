package identity

import (
	"context"
	"io"
	"log/slog"
	"net/http"
)

type BrandingLogoReader interface {
	BrandingLogoURL(context.Context) (string, error)
	OpenBrandingLogo(context.Context) (io.ReadCloser, string, error)
}

func (s *Service) WithBrandingLogo(reader BrandingLogoReader) *Service {
	s.brandingLogo = reader
	return s
}

func (s *Service) logo(w http.ResponseWriter, r *http.Request) {
	if s.brandingLogo == nil {
		http.NotFound(w, r)
		return
	}
	body, version, err := s.brandingLogo.OpenBrandingLogo(r.Context())
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer body.Close()
	etag := `"` + version + `"`
	w.Header().Set("Cache-Control", "public, no-cache")
	w.Header().Set("ETag", etag)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Type", "image/png")
	if _, err := io.Copy(w, body); err != nil {
		slog.WarnContext(r.Context(), "传输品牌 Logo 失败", "error", err)
	}
}
