package llmproxy

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"path"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/modelapikey"
)

const upstreamFailureMessage = "连接上游模型失败，请检查模型配置，或重试"

var allowPaths = map[string]string{
	"/v1/chat/completions": "/chat/completions",
	"/v1/responses":        "/responses",
	"/v1/messages":         "/messages",
}

type contextKey struct{}

type modelContext struct {
	modelName string
	baseURL   string
	apiKey    string
}

type proxyContext struct {
	model        *modelContext
	upstreamPath string
}

type Proxy struct {
	db        *db.Client
	logger    *slog.Logger
	transport *http.Transport
	proxy     *httputil.ReverseProxy
}

func NewProxy(db *db.Client, logger *slog.Logger) *Proxy {
	if logger == nil {
		logger = slog.Default()
	}
	p := &Proxy{
		db:     db,
		logger: logger.With("module", "llmproxy"),
		transport: &http.Transport{
			MaxIdleConns:        100,
			MaxIdleConnsPerHost: 100,
			MaxConnsPerHost:     100,
			IdleConnTimeout:     90 * time.Second,
			Proxy:               http.ProxyFromEnvironment,
			DialContext: (&net.Dialer{
				Timeout:   5 * time.Second,
				KeepAlive: 30 * time.Second,
			}).DialContext,
			TLSHandshakeTimeout:   5 * time.Second,
			ResponseHeaderTimeout: 300 * time.Second,
		},
	}
	p.proxy = &httputil.ReverseProxy{
		Transport:     p.transport,
		Rewrite:       p.rewrite,
		ErrorHandler:  p.errorHandler,
		FlushInterval: 100 * time.Millisecond,
	}
	return p
}

func (p *Proxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	upstreamPath, ok := allowPaths[r.URL.Path]
	if !ok {
		http.NotFound(w, r)
		return
	}
	token, ok := extractToken(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Bad Request", http.StatusBadRequest)
		return
	}
	r.Body = io.NopCloser(bytes.NewReader(body))
	r.ContentLength = int64(len(body))

	reqModel, err := readRequestModel(body)
	if err != nil {
		http.Error(w, "Bad Request", http.StatusBadRequest)
		return
	}
	m, err := p.resolveModel(r.Context(), token)
	if err != nil {
		p.logger.WarnContext(r.Context(), "resolve runtime model failed", "error", err)
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	if reqModel != "" && reqModel != m.modelName {
		p.logger.WarnContext(r.Context(), "model mismatch", "request_model", reqModel, "expected_model", m.modelName)
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}

	ctx := context.WithValue(r.Context(), contextKey{}, &proxyContext{
		model:        m,
		upstreamPath: upstreamPath,
	})
	p.proxy.ServeHTTP(w, r.WithContext(ctx))
}

func (p *Proxy) resolveModel(ctx context.Context, token string) (*modelContext, error) {
	keyID, err := uuid.Parse(token)
	query := p.db.ModelApiKey.Query().
		WithModel().
		Where(modelapikey.APIKey(token))
	if err == nil {
		query = p.db.ModelApiKey.Query().
			WithModel().
			Where(modelapikey.Or(modelapikey.ID(keyID), modelapikey.APIKey(token)))
	}
	key, err := query.Only(ctx)
	if err != nil {
		return nil, err
	}
	if key.Edges.Model == nil {
		return nil, errors.New("model not found")
	}
	return &modelContext{
		modelName: key.Edges.Model.Model,
		baseURL:   key.Edges.Model.BaseURL,
		apiKey:    key.Edges.Model.APIKey,
	}, nil
}

func (p *Proxy) rewrite(r *httputil.ProxyRequest) {
	ctx, ok := r.In.Context().Value(contextKey{}).(*proxyContext)
	if !ok || ctx == nil || ctx.model == nil {
		p.logger.WarnContext(r.In.Context(), "missing model context")
		return
	}
	m := ctx.model
	baseURL, err := url.Parse(m.baseURL)
	if err != nil {
		p.logger.ErrorContext(r.In.Context(), "parse model base url failed", "base_url", m.baseURL, "error", err)
		return
	}
	r.Out.URL.Scheme = baseURL.Scheme
	r.Out.URL.Host = baseURL.Host
	r.Out.URL.Path = joinURLPath(baseURL.Path, ctx.upstreamPath)
	r.Out.URL.RawQuery = r.In.URL.RawQuery
	r.Out.Host = baseURL.Host
	r.Out.Header.Set("Authorization", "Bearer "+m.apiKey)
	r.Out.Header.Set("X-Api-Key", m.apiKey)
	r.SetXForwarded()
}

func (p *Proxy) errorHandler(w http.ResponseWriter, r *http.Request, err error) {
	p.logger.ErrorContext(r.Context(), "proxy upstream failed", "path", r.URL.Path, "error", err)
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusBadGateway)
	_, _ = w.Write([]byte(upstreamFailureMessage))
}

func extractToken(req *http.Request) (string, bool) {
	token := strings.TrimSpace(req.Header.Get("X-Api-Key"))
	if token != "" {
		return token, true
	}
	token, ok := strings.CutPrefix(req.Header.Get("Authorization"), "Bearer ")
	if !ok {
		return "", false
	}
	token = strings.TrimSpace(token)
	return token, token != ""
}

func readRequestModel(body []byte) (string, error) {
	var payload struct {
		Model string `json:"model"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return "", fmt.Errorf("parse llm request: %w", err)
	}
	return payload.Model, nil
}

func joinURLPath(basePath, requestPath string) string {
	if basePath == "" || basePath == "/" {
		return requestPath
	}
	return path.Join(basePath, requestPath)
}
