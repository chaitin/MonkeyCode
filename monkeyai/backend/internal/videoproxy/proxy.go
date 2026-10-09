package videoproxy

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/proxy"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/videogen"
	"github.com/go-chi/chi/v5"
)

type KeyAuthenticator interface {
	Authenticate(context.Context, string, string) (string, error)
}

type SessionResolver interface {
	EnsureSession(context.Context, string, string, string, string) error
}

type Proxy struct {
	resolver proxy.Resolver
	keys     KeyAuthenticator
	sessions SessionResolver
	videos   *videogen.Service
}

func New(resolver proxy.Resolver, keys KeyAuthenticator, sessions SessionResolver, videos *videogen.Service) *Proxy {
	return &Proxy{resolver: resolver, keys: keys, sessions: sessions, videos: videos}
}

func (p *Proxy) Register(router chi.Router) {
	router.Post("/v1/videos/inputs", p.upload)
	router.Post("/v1/videos/generations", p.generate)
	router.Get("/v1/videos/tasks/{id}", p.task)
	router.Get("/v1/videos/outputs/{id}", p.output)
}

func (p *Proxy) authorize(w http.ResponseWriter, r *http.Request) (string, string, bool) {
	credential, ok := proxy.Credential(r)
	if !ok {
		resource.Fail(w, &resource.Error{Status: http.StatusUnauthorized, Code: "unauthorized", Message: "缺少 API Key"})
		return "", "", false
	}
	if p.keys == nil || p.videos == nil {
		resource.Fail(w, &resource.Error{Status: http.StatusServiceUnavailable, Code: "video_unavailable", Message: "视频接口未就绪"})
		return "", "", false
	}
	userID, err := p.keys.Authenticate(r.Context(), credential, "model:invoke")
	if err != nil || userID == "" {
		resource.Fail(w, &resource.Error{Status: http.StatusUnauthorized, Code: "unauthorized", Message: "API Key 无效"})
		return "", "", false
	}
	return userID, credential, true
}

func (p *Proxy) upload(w http.ResponseWriter, r *http.Request) {
	userID, _, ok := p.authorize(w, r)
	if !ok {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 11<<20)
	parts, err := r.MultipartReader()
	if err != nil {
		resource.Fail(w, resource.Invalid("参考图上传格式无效"))
		return
	}
	part, err := parts.NextPart()
	if err != nil || part.FormName() != "file" {
		resource.Fail(w, resource.Invalid("缺少参考图 file 字段"))
		return
	}
	data, err := io.ReadAll(io.LimitReader(part, (10<<20)+1))
	if err != nil || len(data) == 0 || len(data) > 10<<20 {
		resource.Fail(w, &resource.Error{Status: http.StatusRequestEntityTooLarge, Code: "video_input_too_large", Message: "视频参考图超过大小限制"})
		return
	}
	if _, err := parts.NextPart(); !errors.Is(err, io.EOF) {
		resource.Fail(w, resource.Invalid("每次只能上传一张参考图"))
		return
	}
	result, err := p.videos.Upload(r.Context(), userID, data)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	resource.JSON(w, http.StatusCreated, result)
}

func (p *Proxy) generate(w http.ResponseWriter, r *http.Request) {
	userID, credential, ok := p.authorize(w, r)
	if !ok {
		return
	}
	if p.resolver == nil {
		resource.Fail(w, &resource.Error{Status: http.StatusServiceUnavailable, Code: "video_unavailable", Message: "视频模型未就绪"})
		return
	}
	var input videogen.GenerateInput
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil || input.Model == "" || input.Mode == "" {
		resource.Fail(w, resource.Invalid("视频生成请求格式无效"))
		return
	}
	if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
		resource.Fail(w, resource.Invalid("请求只能包含一个 JSON 对象"))
		return
	}
	if input.Params == nil {
		input.Params = map[string]json.RawMessage{}
	}
	target, err := p.resolver.Resolve(r.Context(), credential, input.Model)
	if err != nil {
		resource.Fail(w, err)
		return
	}
	if target.UserID != userID || target.Protocol != "video_generation" {
		resource.Fail(w, resource.Invalid("当前模型不是可调用的视频模型"))
		return
	}
	sessionID := r.Header.Get("X-MAI-Session-ID")
	if sessionID == "" {
		sessionID = r.Header.Get("X-Session-ID")
	}
	if sessionID != "" {
		if p.sessions == nil {
			resource.Fail(w, resource.Invalid("会话服务不可用"))
			return
		}
		if err := p.sessions.EnsureSession(r.Context(), userID, sessionID, r.Header.Get("X-MAI-Parent-Session-ID"), ""); err != nil {
			resource.Fail(w, err)
			return
		}
		target.SessionID = sessionID
	}
	result, err := p.videos.Submit(r.Context(), target, input, r.Header.Get("Idempotency-Key"))
	if err != nil {
		resource.Fail(w, err)
		return
	}
	w.Header().Set("Location", "/v1/videos/tasks/"+result.ID)
	resource.JSON(w, http.StatusAccepted, result)
}

func (p *Proxy) task(w http.ResponseWriter, r *http.Request) {
	userID, _, ok := p.authorize(w, r)
	if !ok {
		return
	}
	result, err := p.videos.GetTask(r.Context(), userID, chi.URLParam(r, "id"))
	if err != nil {
		resource.Fail(w, err)
		return
	}
	resource.JSON(w, http.StatusOK, result)
}

func (p *Proxy) output(w http.ResponseWriter, r *http.Request) {
	userID, _, ok := p.authorize(w, r)
	if !ok {
		return
	}
	body, size, mime, err := p.videos.OpenOutput(r.Context(), userID, chi.URLParam(r, "id"))
	if err != nil {
		resource.Fail(w, err)
		return
	}
	defer body.Close()
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Accept-Ranges", "bytes")
	start, end, ranged, err := parseRange(r.Header.Get("Range"), size)
	if err != nil {
		w.Header().Set("Content-Range", fmt.Sprintf("bytes */%d", size))
		w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
		return
	}
	if ranged {
		if _, err := io.CopyN(io.Discard, body, start); err != nil {
			return
		}
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, size))
		w.Header().Set("Content-Length", strconv.FormatInt(end-start+1, 10))
		w.WriteHeader(http.StatusPartialContent)
		_, _ = io.CopyN(w, body, end-start+1)
		return
	}
	w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
	w.WriteHeader(http.StatusOK)
	_, _ = io.CopyN(w, body, size)
}

func parseRange(header string, size int64) (int64, int64, bool, error) {
	if header == "" {
		return 0, size - 1, false, nil
	}
	if !strings.HasPrefix(header, "bytes=") || strings.Contains(header, ",") || size <= 0 {
		return 0, 0, false, errors.New("不支持的视频 Range")
	}
	parts := strings.Split(strings.TrimPrefix(header, "bytes="), "-")
	if len(parts) != 2 {
		return 0, 0, false, errors.New("视频 Range 格式无效")
	}
	if parts[0] == "" {
		length, err := strconv.ParseInt(parts[1], 10, 64)
		if err != nil || length <= 0 {
			return 0, 0, false, errors.New("视频 Range 长度无效")
		}
		if length > size {
			length = size
		}
		return size - length, size - 1, true, nil
	}
	start, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil || start >= size || start < 0 {
		return 0, 0, false, errors.New("视频 Range 起点无效")
	}
	end := size - 1
	if parts[1] != "" {
		end, err = strconv.ParseInt(parts[1], 10, 64)
		if err != nil || end < start {
			return 0, 0, false, errors.New("视频 Range 终点无效")
		}
		if end >= size {
			end = size - 1
		}
	}
	return start, end, true, nil
}
