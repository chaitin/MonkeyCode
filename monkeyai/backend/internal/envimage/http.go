package envimage

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/web"
	"github.com/go-chi/chi/v5"
)

func (s *Service) RegisterHost(router chi.Router) {
	router.Handle("/v2/", s)
	router.Handle("/v2/*", s)
}
func (s *Service) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Docker-Distribution-Api-Version", "registry/2.0")
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if r.URL.Path != "/v2/" && !strings.HasPrefix(r.URL.Path, "/v2/environments/") {
		web.NotFound(w, r)
		return
	}
	if s.authorize == nil || !s.authorize(r) {
		w.Header().Set("WWW-Authenticate", `Basic realm="monkeyai-environments"`)
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	s.reader.ServeHTTP(w, r)
}
func (s *Service) RegisterAdmin(router chi.Router) {
	router.Get("/environment-images", s.list)
	router.Post("/environment-images/sync", s.sync)
}
func (s *Service) list(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	images := make([]Image, 0, len(s.images))
	for _, image := range s.images {
		images = append(images, image)
	}
	s.mu.Unlock()
	slices.SortFunc(images, func(a, b Image) int { return strings.Compare(a.Source, b.Source) })
	resource.JSON(r.Context(), w, http.StatusOK, map[string]any{"items": images})
}
func (s *Service) sync(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Image string `json:"image"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&in) != nil || decoder.Decode(new(any)) != io.EOF {
		resource.JSON(r.Context(), w, http.StatusBadRequest, map[string]any{"error": map[string]string{"code": "invalid_request", "message": web.Message(r.Context(), "invalid_request", "请提供固定摘要镜像")}})
		return
	}
	if _, err := source(in.Image); err != nil {
		resource.JSON(r.Context(), w, http.StatusBadRequest, map[string]any{"error": map[string]string{"code": "invalid_request", "message": web.Message(r.Context(), "invalid_request", err.Error())}})
		return
	}
	s.mu.Lock()
	if s.ctx.Err() != nil {
		s.mu.Unlock()
		http.Error(w, web.Message(r.Context(), "", "服务正在停止"), 503)
		return
	}
	current := s.images[in.Image]
	if current.Status == "syncing" || current.Status == "ready" {
		s.mu.Unlock()
		resource.JSON(r.Context(), w, http.StatusAccepted, current)
		return
	}
	current = Image{Source: in.Image, Status: "syncing", Architectures: []string{}, UpdatedAt: time.Now().UTC()}
	s.images[in.Image] = current
	s.wg.Add(1)
	s.mu.Unlock()
	if err := s.save(current); err != nil {
		s.wg.Done()
		s.mu.Lock()
		delete(s.images, in.Image)
		s.mu.Unlock()
		resource.Fail(r.Context(), w, err)
		return
	}
	go func() {
		defer s.wg.Done()
		ctx, cancel := context.WithTimeout(s.ctx, 30*time.Minute)
		defer cancel()
		if err := s.Sync(ctx, in.Image); err != nil {
			failed := current
			failed.Status, failed.Error, failed.UpdatedAt = "failed", "镜像同步失败，请检查资源与上游连接后重试", time.Now().UTC()
			_ = s.save(failed)
		}
	}()
	resource.JSON(r.Context(), w, http.StatusAccepted, current)
}
