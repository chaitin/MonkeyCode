package designcatalog

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/go-chi/chi/v5"
)

func (s *Service) RegisterCatalog(router chi.Router, requireAgent func(http.Handler) http.Handler) {
	router.Route("/api/v1/design-resources", func(r chi.Router) {
		r.Method("GET", "/config", controlHeaders(requireAgent(http.HandlerFunc(s.configuration))))
		r.Method("POST", "/token", controlHeaders(requireAgent(http.HandlerFunc(s.token))))
		auth := catalogAuth(requireAgent)
		r.Method("GET", "/catalog/snapshot", auth(http.HandlerFunc(s.snapshotAPI)))
		r.Method("GET", "/catalog/taxonomy", auth(http.HandlerFunc(s.taxonomyAPI)))
		r.Method("GET", "/catalog/{kind}", auth(http.HandlerFunc(s.listAPI)))
		r.Method("GET", "/catalog/{kind}/{id}", auth(http.HandlerFunc(s.detailAPI)))
		for _, method := range []string{"GET", "HEAD"} {
			r.Method(method, "/catalog/templates/{id}/download", auth(http.HandlerFunc(s.downloadAPI)))
			r.Method(method, "/design-systems/{id}/download", auth(http.HandlerFunc(s.downloadAPI)))
			r.Method(method, "/catalog/previews/{id}/*", http.HandlerFunc(s.mediaAPI))
			r.Method(method, "/catalog/style-assets/{id}/*", http.HandlerFunc(s.mediaAPI))
		}
	})
}

func pathParam(r *http.Request, name string) string {
	value := chi.URLParam(r, name)
	if r.URL.RawPath != "" {
		decoded, err := url.PathUnescape(value)
		if err != nil {
			return ""
		}
		return decoded
	}
	return value
}

func controlHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Vary", "Authorization")
		next.ServeHTTP(w, r)
	})
}

type rejectWriter struct {
	header http.Header
	status int
	body   bytes.Buffer
}

func (w *rejectWriter) Header() http.Header { return w.header }
func (w *rejectWriter) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
	}
}
func (w *rejectWriter) Write(b []byte) (int, error) {
	w.WriteHeader(200)
	if w.body.Len() < 8192 {
		w.body.Write(b[:min(len(b), 8192-w.body.Len())])
	}
	return len(b), nil
}
func catalogAuth(require func(http.Handler) http.Handler) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			allowed := false
			capture := &rejectWriter{header: http.Header{}}
			require(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) { allowed = true; next.ServeHTTP(w, r) })).ServeHTTP(capture, r)
			if allowed {
				return
			}
			status := capture.status
			if status == 0 {
				status = 401
			}
			code := "unauthorized"
			if status == 403 {
				code = "forbidden"
			} else if status >= 500 {
				code = "unavailable"
			}
			message := "访问凭据无效或已过期"
			if status == 403 {
				message = "无权访问设计资源"
			} else if status >= 500 {
				message = "认证服务暂不可用"
			}
			writeAPIError(w, r, fault(status, code, message))
		})
	}
}
func writeAPIError(w http.ResponseWriter, r *http.Request, err error) {
	var f *Fault
	if !errors.As(err, &f) {
		f = &Fault{503, "unavailable", "设计目录或存储暂不可用"}
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Vary", "Authorization")
	w.Header().Del("ETag")
	w.Header().Del("Content-Length")
	w.Header().Del("Content-Disposition")
	w.WriteHeader(f.Status)
	if r.Method != "HEAD" {
		_ = json.NewEncoder(w).Encode(map[string]any{"code": f.Code, "message": f.Message, "data": nil})
	}
}
func apiJSON(w http.ResponseWriter, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "private, max-age=0, must-revalidate")
	w.Header().Set("Vary", "Authorization")
	w.WriteHeader(200)
	_ = json.NewEncoder(w).Encode(map[string]any{"code": 0, "message": "", "data": data})
}
func query(r *http.Request) (url.Values, error) {
	q, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil || len(r.URL.RawQuery) > 16384 {
		return nil, fault(400, "invalid_argument", "查询编码无效")
	}
	for key, values := range q {
		if len(values) != 1 || strings.ContainsAny(values[0], "\x00;") {
			return nil, fault(400, "invalid_argument", "查询参数重复或编码无效: "+key)
		}
	}
	return q, nil
}
func (s *Service) selected(r *http.Request) (*Snapshot, url.Values, error) {
	q, err := query(r)
	if err != nil {
		return nil, nil, err
	}
	current, _, err := s.Current(r.Context())
	if err != nil {
		return nil, q, err
	}
	if current == nil {
		return nil, q, fault(404, "snapshot_not_found", "尚未导入设计快照")
	}
	if pub := q.Get("publisher_id"); pub != "" && pub != current.PublisherID {
		return nil, q, fault(403, "forbidden", "发布者与快照不匹配")
	}
	release := current.ReleaseID
	if values, ok := q["snapshot"]; ok {
		value := values[0]
		if !strings.HasPrefix(value, "release:") || strings.TrimPrefix(value, "release:") == "" {
			return nil, q, fault(404, "snapshot_not_found", "快照标识无效")
		}
		release = strings.TrimPrefix(value, "release:")
	}
	snap, err := s.Find(r.Context(), current.PublisherID, release)
	return snap, q, err
}
func (s *Service) snapshotAPI(w http.ResponseWriter, r *http.Request) {
	snap, _, err := s.selected(r)
	if err != nil {
		writeAPIError(w, r, err)
		return
	}
	apiJSON(w, snap.SnapshotRef)
}
func (s *Service) taxonomyAPI(w http.ResponseWriter, r *http.Request) {
	snap, _, err := s.selected(r)
	if err != nil {
		writeAPIError(w, r, err)
		return
	}
	apiJSON(w, snap.Taxonomy)
}
func (s *Service) base() string {
	return strings.TrimRight(s.access.PublicURL, "/") + "/api/v1/design-resources"
}
func controlError(w http.ResponseWriter, r *http.Request, err error) {
	var f *Fault
	if !errors.As(err, &f) {
		f = &Fault{503, "unavailable", "设计资源控制面暂不可用"}
	}
	w.Header().Set("Cache-Control", "no-store")
	resource.JSON(r.Context(), w, f.Status, map[string]any{"error": map[string]string{"code": f.Code, "message": f.Message}})
}
func (s *Service) configuration(w http.ResponseWriter, r *http.Request) {
	current, _, err := s.Current(r.Context())
	if err != nil {
		controlError(w, r, err)
		return
	}
	var publisher *string
	if s.access.PublisherID != "" {
		publisher = new(s.access.PublisherID)
	}
	var respub any
	if s.access.RespubURL != "" {
		respub = map[string]string{"base_url": s.access.RespubURL}
	}
	w.Header().Set("Cache-Control", "no-store")
	resource.JSON(r.Context(), w, 200, map[string]any{"schema_version": SchemaVersion, "publisher_id": publisher, "respub": respub, "monkeyai": map[string]any{"base_url": s.base(), "available": current != nil, "snapshot": current}})
}
func (s *Service) token(w http.ResponseWriter, r *http.Request) {
	var input struct {
		MachineID string `json:"machine_id"`
		Target    string `json:"target"`
	}
	if err := resource.Decode(w, r, &input); err != nil {
		controlError(w, r, fault(400, "invalid_argument", "Token 请求无效"))
		return
	}
	if input.Target != "respub" && input.Target != "monkeyai-media" {
		controlError(w, r, fault(400, "invalid_argument", "Token target 不支持"))
		return
	}
	user, ok := identity.UserFromContext(r.Context())
	if !ok {
		controlError(w, r, fault(401, "unauthorized", "尚未认证"))
		return
	}
	if s.devices == nil || input.MachineID == "" {
		controlError(w, r, fault(403, "forbidden", "设备不属于当前用户"))
		return
	}
	machine, err := s.devices.OwnedDevice(r.Context(), user.ID, input.MachineID)
	if err != nil {
		controlError(w, r, err)
		return
	}
	if machine == "" {
		controlError(w, r, fault(403, "forbidden", "设备不属于当前用户"))
		return
	}
	key := s.access.MediaSecret
	audience := "monkeyai-design-media"
	subject := user.ID
	if input.Target == "respub" {
		key = s.access.RespubSecret
		audience = "respub-design"
		subject = ""
		if s.access.RespubURL == "" {
			key = ""
		}
	}
	if key == "" || s.access.InstanceID == "" {
		controlError(w, r, fault(503, "unavailable", "对应签发配置缺失"))
		return
	}
	now := time.Now().UTC()
	claims := Claims{Issuer: "monkeyai", Audience: audience, InstanceID: s.access.InstanceID, ClientID: machine, Subject: subject, IssuedAt: now.Unix(), ExpiresAt: now.Add(10 * time.Minute).Unix()}
	w.Header().Set("Cache-Control", "no-store")
	resource.JSON(r.Context(), w, 200, map[string]any{"token": signClaims(claims, key), "expires_at": time.Unix(claims.ExpiresAt, 0).UTC()})
}
