package proxy

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
)

const upstreamFailureMessage = "连接上游模型失败，请检查模型配置，或重试"

var endpoints = []struct {
	path     string
	upstream string
}{
	{path: "/v1/chat/completions", upstream: "/chat/completions"},
	{path: "/v1/responses", upstream: "/responses"},
	{path: "/v1/messages", upstream: "/messages"},
}

type Target struct {
	ModelID       string
	UpstreamModel string
	Protocol      string
	UserID        string
	SessionID     string
	BaseURL       string
	APIKey        string
}

// Resolver 根据代理凭据和请求模型返回真实上游配置。
type Resolver interface {
	Resolve(ctx context.Context, credential, requestedModel string) (Target, error)
}

type ResolverFunc func(context.Context, string, string) (Target, error)

func (f ResolverFunc) Resolve(ctx context.Context, credential, requestedModel string) (Target, error) {
	return f(ctx, credential, requestedModel)
}

// UsageRecorder 持久化成功响应中解析出的模型调用用量。
type UsageRecorder interface {
	Record(context.Context, Call) error
}

type proxyContextKey struct{}

type proxyContext struct {
	target       Target
	upstream     *url.URL
	upstreamPath string
	stream       bool
	startedAt    time.Time
	reservation  Reservation
	settled      sync.Once
}

type Proxy struct {
	resolver Resolver
	logger   *slog.Logger
	recorder UsageRecorder
	billing  Billing
	captures sync.WaitGroup
	reverse  *httputil.ReverseProxy
}

func NewProxy(resolver Resolver, logger *slog.Logger) *Proxy {
	if logger == nil {
		logger = slog.Default()
	}
	p := &Proxy{
		resolver: resolver,
		logger:   logger.With("module", "proxy"),
	}
	p.reverse = &httputil.ReverseProxy{
		Transport:      http.DefaultTransport,
		Rewrite:        p.rewrite,
		ModifyResponse: p.modifyResponse,
		ErrorHandler:   p.errorHandler,
		FlushInterval:  100 * time.Millisecond,
	}
	return p
}

func (p *Proxy) WithUsageRecorder(recorder UsageRecorder) *Proxy {
	p.recorder = recorder
	return p
}

func (p *Proxy) WithTransport(transport http.RoundTripper) *Proxy {
	if transport != nil {
		p.reverse.Transport = transport
	}
	return p
}

func (p *Proxy) Register(router chi.Router) {
	for _, endpoint := range endpoints {
		router.Method(http.MethodPost, endpoint.path, p)
	}
}

func (p *Proxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
		return
	}
	upstreamPath, ok := upstreamPath(r.URL.Path)
	if !ok {
		http.NotFound(w, r)
		return
	}
	credential, ok := extractCredential(r)
	if !ok {
		http.Error(w, http.StatusText(http.StatusUnauthorized), http.StatusUnauthorized)
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 32<<20))
	if err != nil {
		http.Error(w, http.StatusText(http.StatusBadRequest), http.StatusBadRequest)
		return
	}
	meta, err := readRequestMeta(body)
	if err != nil {
		http.Error(w, http.StatusText(http.StatusBadRequest), http.StatusBadRequest)
		return
	}
	if p.resolver == nil {
		p.logger.ErrorContext(r.Context(), "模型代理未配置凭据解析器")
		http.Error(w, http.StatusText(http.StatusServiceUnavailable), http.StatusServiceUnavailable)
		return
	}
	target, err := p.resolver.Resolve(r.Context(), credential, meta.Model)
	if err != nil {
		p.logger.WarnContext(r.Context(), "解析模型失败", "error", err)
		http.Error(w, http.StatusText(http.StatusUnauthorized), http.StatusUnauthorized)
		return
	}
	if target.Protocol != "" && target.Protocol != protocolForPath(r.URL.Path) {
		http.Error(w, "模型协议与请求端点不匹配", http.StatusBadRequest)
		return
	}
	upstream, err := parseBaseURL(target.BaseURL)
	if err != nil {
		p.logger.ErrorContext(r.Context(), "模型配置无效", "model_id", target.ModelID, "error", err)
		p.errorHandler(w, r, err)
		return
	}
	if target.UpstreamModel != "" && target.UpstreamModel != meta.Model {
		body, err = rewriteModel(body, target.UpstreamModel)
		if err != nil {
			http.Error(w, http.StatusText(http.StatusBadRequest), http.StatusBadRequest)
			return
		}
	}
	var reservation Reservation
	if p.billing != nil {
		reservation, err = p.billing.Begin(r.Context(), target, BillingRequest{Path: r.URL.Path, Body: body, IdempotencyKey: r.Header.Get("Idempotency-Key"), SessionID: r.Header.Get("X-Session-ID")})
		if err != nil {
			billingError(w, err)
			return
		}
		body, err = billRequest(body, r.URL.Path, reservation.OutputLimit, meta.Stream)
		if err != nil {
			pc := &proxyContext{reservation: reservation}
			p.finish(r.Context(), pc, Call{Known: true, Result: "failed", ErrorCode: "invalid_request"})
			billingError(w, err)
			return
		}
		if err = p.billing.Start(r.Context(), reservation.ID); err != nil {
			billingError(w, err)
			return
		}
		w.Header().Set("X-Billing-Transaction-ID", reservation.ID)
	}
	r.Body = io.NopCloser(bytes.NewReader(body))
	r.ContentLength = int64(len(body))
	ctx := context.WithValue(r.Context(), proxyContextKey{}, &proxyContext{
		target:       target,
		upstream:     upstream,
		upstreamPath: upstreamPath,
		stream:       meta.Stream,
		startedAt:    time.Now(),
		reservation:  reservation,
	})
	p.reverse.ServeHTTP(w, r.WithContext(ctx))
}

func protocolForPath(requestPath string) string {
	switch requestPath {
	case "/v1/chat/completions":
		return "openai_chat_completions"
	case "/v1/responses":
		return "openai_responses"
	case "/v1/messages":
		return "anthropic"
	default:
		return ""
	}
}

func rewriteModel(body []byte, upstreamModel string) ([]byte, error) {
	var request map[string]json.RawMessage
	if err := json.Unmarshal(body, &request); err != nil || request == nil {
		return nil, errors.New("请求体必须是 JSON 对象")
	}
	encoded, err := json.Marshal(upstreamModel)
	if err != nil {
		return nil, err
	}
	request["model"] = encoded
	return json.Marshal(request)
}

func (p *Proxy) rewrite(r *httputil.ProxyRequest) {
	ctx, ok := r.In.Context().Value(proxyContextKey{}).(*proxyContext)
	if !ok || ctx == nil || ctx.upstream == nil {
		p.logger.ErrorContext(r.In.Context(), "模型代理上下文缺失")
		return
	}
	r.Out.URL.Scheme = ctx.upstream.Scheme
	r.Out.URL.Host = ctx.upstream.Host
	r.Out.URL.Path = path.Join(ctx.upstream.Path, ctx.upstreamPath)
	r.Out.URL.RawPath = ""
	if ctx.upstream.RawQuery != "" {
		if r.Out.URL.RawQuery == "" {
			r.Out.URL.RawQuery = ctx.upstream.RawQuery
		} else {
			r.Out.URL.RawQuery = ctx.upstream.RawQuery + "&" + r.Out.URL.RawQuery
		}
	}
	r.Out.Header.Del("Authorization")
	r.Out.Header.Del("X-Api-Key")
	r.Out.Header.Del("Idempotency-Key")
	r.Out.Header.Del("X-Session-ID")
	if ctx.target.APIKey != "" {
		r.Out.Header.Set("Authorization", "Bearer "+ctx.target.APIKey)
		r.Out.Header.Set("X-Api-Key", ctx.target.APIKey)
	}
	r.SetXForwarded()
	r.Out.Host = ctx.upstream.Host
}

func (p *Proxy) errorHandler(w http.ResponseWriter, r *http.Request, err error) {
	if pc, ok := r.Context().Value(proxyContextKey{}).(*proxyContext); ok {
		p.finish(r.Context(), pc, Call{Result: "failed", ErrorCode: "upstream_connection_failed"})
	}
	p.logger.ErrorContext(r.Context(), "模型上游请求失败", "path", r.URL.Path, "error", err)
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusBadGateway)
	_, _ = io.WriteString(w, upstreamFailureMessage)
}

func upstreamPath(requestPath string) (string, bool) {
	for _, endpoint := range endpoints {
		if endpoint.path == requestPath {
			return endpoint.upstream, true
		}
	}
	return "", false
}

func parseBaseURL(raw string) (*url.URL, error) {
	upstream, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return nil, fmt.Errorf("解析模型地址: %w", err)
	}
	if upstream.Scheme != "http" && upstream.Scheme != "https" {
		return nil, fmt.Errorf("模型地址协议 %q 不受支持", upstream.Scheme)
	}
	if upstream.Hostname() == "" || upstream.User != nil {
		return nil, errors.New("模型地址主机无效")
	}
	upstream.Fragment = ""
	return upstream, nil
}

func extractCredential(req *http.Request) (string, bool) {
	credential := strings.TrimSpace(req.Header.Get("X-Api-Key"))
	if credential != "" {
		return credential, true
	}
	credential, ok := strings.CutPrefix(req.Header.Get("Authorization"), "Bearer ")
	if !ok {
		return "", false
	}
	credential = strings.TrimSpace(credential)
	return credential, credential != ""
}

type requestMeta struct {
	Model  string `json:"model"`
	Stream bool   `json:"stream"`
}

func readRequestMeta(body []byte) (requestMeta, error) {
	var meta *requestMeta
	if err := json.Unmarshal(body, &meta); err != nil || meta == nil {
		if err == nil {
			err = errors.New("请求体必须是 JSON 对象")
		}
		return requestMeta{}, fmt.Errorf("解析模型请求: %w", err)
	}
	return *meta, nil
}
