package designcatalog

import (
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"strconv"
	"strings"
	"time"
)

type byteRange struct{ start, end int64 }

func ranges(raw string, size int64) ([]byteRange, error) {
	if raw == "" {
		return nil, nil
	}
	if !strings.HasPrefix(raw, "bytes=") {
		return nil, fault(400, "invalid_argument", "Range 格式无效")
	}
	parts := strings.Split(strings.TrimPrefix(raw, "bytes="), ",")
	if len(parts) > 32 {
		return nil, fault(400, "invalid_argument", "Range 区间过多")
	}
	out := []byteRange{}
	for _, part := range parts {
		pair := strings.Split(strings.TrimSpace(part), "-")
		if len(pair) != 2 || pair[0] == "" && pair[1] == "" {
			return nil, fault(400, "invalid_argument", "Range 格式无效")
		}
		var start, end int64
		var err error
		if pair[0] == "" {
			suffix, e := strconv.ParseInt(pair[1], 10, 64)
			if e != nil || suffix < 0 {
				return nil, fault(400, "invalid_argument", "Range 后缀无效")
			}
			if suffix == 0 || size == 0 {
				continue
			}
			start = max(0, size-suffix)
			end = size - 1
		} else {
			start, err = strconv.ParseInt(pair[0], 10, 64)
			if err != nil || start < 0 {
				return nil, fault(400, "invalid_argument", "Range 起点无效")
			}
			end = size - 1
			if pair[1] != "" {
				end, err = strconv.ParseInt(pair[1], 10, 64)
				if err != nil || end < start {
					return nil, fault(400, "invalid_argument", "Range 终点无效")
				}
			}
			if start >= size {
				continue
			}
			end = min(end, size-1)
		}
		out = append(out, byteRange{start, end})
	}
	if len(out) == 0 {
		return nil, fault(416, "invalid_argument", "Range 全部不可满足")
	}
	return out, nil
}
func etagMatches(header, etag string) bool {
	for _, part := range strings.Split(header, ",") {
		v := strings.TrimSpace(part)
		if v == "*" || strings.TrimPrefix(v, "W/") == etag {
			return true
		}
	}
	return false
}
func (s *Service) serveObject(w http.ResponseWriter, r *http.Request, object Object, contentType, filename string) {
	if s.storage == nil {
		writeAPIError(w, r, fault(503, "unavailable", "本地存储尚未配置"))
		return
	}
	size, sha, err := s.storage.HeadImmutable(r.Context(), object.Key)
	if err != nil {
		writeAPIError(w, r, err)
		return
	}
	if size != object.Size || sha != object.SHA256 {
		writeAPIError(w, r, fault(503, "unavailable", "存储对象摘要或大小不符"))
		return
	}
	etag := `"` + strings.TrimPrefix(object.SHA256, "sha256:") + `"`
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Vary", "Authorization")
	w.Header().Set("Cache-Control", "private, max-age=0, must-revalidate")
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Accept-Ranges", "bytes")
	w.Header().Set("ETag", etag)
	if filename != "" {
		w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": filename}))
	}
	mediaType, _, _ := mime.ParseMediaType(contentType)
	if mediaType == "image/svg+xml" {
		w.Header().Set("Content-Security-Policy", "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'")
	}
	if r.Header.Get("If-None-Match") != "" && etagMatches(r.Header.Get("If-None-Match"), etag) {
		w.WriteHeader(304)
		return
	}
	rangeHeader := r.Header.Get("Range")
	if ifRange := r.Header.Get("If-Range"); ifRange != "" && ifRange != etag {
		rangeHeader = ""
	}
	selected, err := ranges(rangeHeader, object.Size)
	if err != nil {
		var f *Fault
		if errors.As(err, &f) && f.Status == 416 {
			w.Header().Set("Content-Range", fmt.Sprintf("bytes */%d", object.Size))
		}
		writeAPIError(w, r, err)
		return
	}
	if len(selected) == 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(object.Size, 10))
		if r.Method == "HEAD" || object.Size == 0 {
			w.WriteHeader(200)
			return
		}
		body, err := s.storage.GetRange(r.Context(), object.Key, 0, object.Size-1)
		if err != nil {
			writeAPIError(w, r, err)
			return
		}
		defer body.Close()
		w.WriteHeader(200)
		_, _ = io.CopyN(w, body, object.Size)
		return
	}
	if len(selected) == 1 {
		part := selected[0]
		length := part.end - part.start + 1
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", part.start, part.end, object.Size))
		w.Header().Set("Content-Length", strconv.FormatInt(length, 10))
		if r.Method == "HEAD" {
			w.WriteHeader(206)
			return
		}
		body, err := s.storage.GetRange(r.Context(), object.Key, part.start, part.end)
		if err != nil {
			writeAPIError(w, r, err)
			return
		}
		defer body.Close()
		w.WriteHeader(206)
		_, _ = io.CopyN(w, body, length)
		return
	}
	bodies := []io.ReadCloser{}
	defer func() {
		for _, body := range bodies {
			body.Close()
		}
	}()
	if r.Method != "HEAD" {
		for _, part := range selected {
			body, err := s.storage.GetRange(r.Context(), object.Key, part.start, part.end)
			if err != nil {
				writeAPIError(w, r, err)
				return
			}
			bodies = append(bodies, body)
		}
	}
	multi := multipart.NewWriter(w)
	w.Header().Set("Content-Type", "multipart/byteranges; boundary="+multi.Boundary())
	w.WriteHeader(206)
	if r.Method == "HEAD" {
		return
	}
	for i, part := range selected {
		header := textproto.MIMEHeader{"Content-Type": {contentType}, "Content-Range": {fmt.Sprintf("bytes %d-%d/%d", part.start, part.end, object.Size)}}
		dest, err := multi.CreatePart(header)
		if err != nil {
			return
		}
		if _, err = io.CopyN(dest, bodies[i], part.end-part.start+1); err != nil {
			return
		}
	}
	_ = multi.Close()
}
func (s *Service) downloadAPI(w http.ResponseWriter, r *http.Request) {
	snap, q, err := s.selected(r)
	if err != nil {
		writeAPIError(w, r, err)
		return
	}
	kind := "template"
	if strings.Contains(r.URL.Path, "/design-systems/") {
		kind = "design-system"
	}
	e, err := lookup(snap, kind, pathParam(r, "id"), q.Get("content_digest"))
	if err != nil {
		writeAPIError(w, r, err)
		return
	}
	if e.Native == nil {
		writeAPIError(w, r, fault(404, "resource_not_found", "资源不可下载"))
		return
	}
	s.serveObject(w, r, *e.Native, "application/zip", e.ID+".zip")
}
func (s *Service) mediaAPI(w http.ResponseWriter, r *http.Request) {
	q, err := query(r)
	if err != nil {
		writeAPIError(w, r, err)
		return
	}
	token := q.Get("token")
	if headers, ok := r.Header["Authorization"]; ok {
		token = ""
		if len(headers) == 1 {
			value := strings.TrimSpace(headers[0])
			if len(value) > 7 && strings.EqualFold(value[:7], "Bearer ") {
				token = strings.TrimSpace(value[7:])
			}
		}
	}
	if _, err = s.mediaClaims(token, time.Now()); err != nil {
		writeAPIError(w, r, err)
		return
	}
	snap, q, err := s.selected(r)
	if err != nil {
		writeAPIError(w, r, err)
		return
	}
	kind := "template"
	if strings.Contains(r.URL.Path, "/style-assets/") {
		kind = "style"
	}
	e, err := lookup(snap, kind, pathParam(r, "id"), q.Get("content_digest"))
	if err != nil {
		writeAPIError(w, r, err)
		return
	}
	logical := pathParam(r, "*")
	if !SafePath(logical) {
		writeAPIError(w, r, fault(404, "resource_not_found", "媒体路径无效"))
		return
	}
	for _, ref := range e.Files {
		if ref.Path != logical {
			continue
		}
		typ, _, parseErr := mime.ParseMediaType(ref.MIME)
		if parseErr != nil || !strings.HasPrefix(typ, "image/") && !strings.HasPrefix(typ, "video/") && !strings.HasPrefix(typ, "audio/") {
			break
		}
		s.serveObject(w, r, Object{Key: ObjectKey(ref.SHA256), SHA256: ref.SHA256, Size: ref.Size}, ref.MIME, "")
		return
	}
	writeAPIError(w, r, fault(404, "resource_not_found", "媒体不存在"))
}
