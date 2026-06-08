package llmproxy

import (
	"bufio"
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
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/modelapikey"
	"github.com/chaitin/MonkeyCode/backend/db/taskvirtualmachine"
	"github.com/chaitin/MonkeyCode/backend/pkg/modelusage"
)

const upstreamFailureMessage = "连接上游模型失败，请检查模型配置，或重试"

var allowPaths = map[string]string{
	"/v1/chat/completions": "/chat/completions",
	"/v1/responses":        "/responses",
	"/v1/messages":         "/messages",
}

type contextKey struct{}

type modelContext struct {
	modelID   uuid.UUID
	userID    uuid.UUID
	vmID      string
	provider  string
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
	recorder  usageRecorder
	transport *http.Transport
	proxy     *httputil.ReverseProxy
}

type usageRecorder interface {
	Record(ctx context.Context, event modelusage.Event) error
}

type Option func(*Proxy)

func WithUsageRecorder(recorder usageRecorder) Option {
	return func(p *Proxy) {
		p.recorder = recorder
	}
}

func NewProxy(db *db.Client, logger *slog.Logger, opts ...Option) *Proxy {
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
	for _, opt := range opts {
		opt(p)
	}
	p.proxy = &httputil.ReverseProxy{
		Transport:      p.transport,
		Rewrite:        p.rewrite,
		ModifyResponse: p.modifyResponse,
		ErrorHandler:   p.errorHandler,
		FlushInterval:  100 * time.Millisecond,
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
		modelID:   key.Edges.Model.ID,
		userID:    key.UserID,
		vmID:      key.VirtualmachineID,
		provider:  key.Edges.Model.Provider,
		modelName: key.Edges.Model.Model,
		baseURL:   key.Edges.Model.BaseURL,
		apiKey:    key.Edges.Model.APIKey,
	}, nil
}

var LLMAllowPaths []string = []string{
	"/v1/messages",
	"/chat/completions",
	"/responses",
}

func fetchAllowPath(path string) string {
	for _, v := range LLMAllowPaths {
		if strings.HasSuffix(path, v) {
			return v
		}
	}
	return ""
}

func (p *Proxy) rewrite(r *httputil.ProxyRequest) {
	path := r.In.URL.Path
	p.logger.With("path", path).DebugContext(r.In.Context(), "new rewrite request")

	ctx, ok := r.In.Context().Value(contextKey{}).(*proxyContext)
	if !ok || ctx == nil || ctx.model == nil {
		p.logger.WarnContext(r.In.Context(), "missing model context")
		return
	}

	uppath := fetchAllowPath(path)
	if uppath == "" {
		p.logger.With("path", path).WarnContext(r.In.Context(), "unsupport api type")
		return
	}

	m := ctx.model
	ul, err := url.Parse(m.baseURL)
	if err != nil {
		p.logger.ErrorContext(r.In.Context(), "parse model base url failed", "base_url", m.baseURL, "error", err)
		return
	}
	r.Out.URL.Scheme = ul.Scheme
	r.Out.URL.Host = ul.Host
	r.Out.URL.Path = filepath.Join(ul.Path, uppath)
	r.Out.Header.Set("Authorization", "Bearer "+m.apiKey)
	r.Out.Header.Set("X-Api-Key", m.apiKey)
	r.SetXForwarded()
	r.Out.Host = ul.Host
	p.logger.With(
		"model", m.modelName,
		"in", r.In.URL.String(),
		"out", r.Out.URL.String(),
	).DebugContext(r.In.Context(), "rewrite request success")
}

func (p *Proxy) errorHandler(w http.ResponseWriter, r *http.Request, err error) {
	p.logger.ErrorContext(r.Context(), "proxy upstream failed", "path", r.URL.Path, "error", err)
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusBadGateway)
	_, _ = w.Write([]byte(upstreamFailureMessage))
}

func (p *Proxy) modifyResponse(resp *http.Response) error {
	if resp == nil || resp.Body == nil {
		return nil
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return nil
	}
	ctx, ok := resp.Request.Context().Value(contextKey{}).(*proxyContext)
	if !ok || ctx == nil || ctx.model == nil {
		return nil
	}
	resp.Body = newUsageCaptureBody(resp.Body, func(body []byte) {
		p.recordUsage(resp.Request.Context(), ctx, body)
	})
	return nil
}

type usageCaptureBody struct {
	body     io.ReadCloser
	onFinish func([]byte)
	buf      bytes.Buffer
	once     sync.Once
}

func newUsageCaptureBody(body io.ReadCloser, onFinish func([]byte)) io.ReadCloser {
	return &usageCaptureBody{body: body, onFinish: onFinish}
}

func (b *usageCaptureBody) Read(p []byte) (int, error) {
	n, err := b.body.Read(p)
	if n > 0 {
		_, _ = b.buf.Write(p[:n])
	}
	if errors.Is(err, io.EOF) {
		b.finish()
	}
	return n, err
}

func (b *usageCaptureBody) Close() error {
	err := b.body.Close()
	b.finish()
	return err
}

func (b *usageCaptureBody) finish() {
	b.once.Do(func() {
		if b.onFinish != nil {
			b.onFinish(b.buf.Bytes())
		}
	})
}

func (p *Proxy) recordUsage(ctx context.Context, proxyCtx *proxyContext, body []byte) {
	event, ok := p.buildUsageEvent(ctx, proxyCtx, body)
	if !ok {
		return
	}
	if err := p.recorder.Record(ctx, event); err != nil {
		p.logger.WarnContext(ctx, "record model usage failed", "model", proxyCtx.model.modelName, "error", err)
	}
}

func (p *Proxy) buildUsageEvent(ctx context.Context, proxyCtx *proxyContext, body []byte) (modelusage.Event, bool) {
	if p.recorder == nil || proxyCtx == nil || proxyCtx.model == nil {
		return modelusage.Event{}, false
	}
	usage, ok := parseUsage(proxyCtx.upstreamPath, body)
	if !ok {
		return modelusage.Event{}, false
	}
	m := proxyCtx.model
	taskID := p.resolveTaskID(ctx, m.vmID)
	if taskID == uuid.Nil {
		p.logger.WarnContext(ctx, "skip model usage event without task", "user_id", m.userID, "vm_id", m.vmID, "model_id", m.modelID)
		return modelusage.Event{}, false
	}
	return modelusage.Event{
		EventTime:    time.Now(),
		TaskID:       taskID,
		UserID:       m.userID,
		Provider:     m.provider,
		ModelID:      m.modelID.String(),
		ModelName:    m.modelName,
		InputTokens:  usage.inputTokens,
		OutputTokens: usage.outputTokens,
		CachedTokens: usage.cachedTokens,
		TotalTokens:  usage.totalTokens,
		Success:      true,
		RequestID:    usage.requestID,
		Source:       "llmproxy",
	}, true
}

func (p *Proxy) resolveTaskID(ctx context.Context, vmID string) uuid.UUID {
	if p == nil || p.db == nil || vmID == "" {
		return uuid.Nil
	}
	taskVM, err := p.db.TaskVirtualMachine.Query().
		Where(taskvirtualmachine.VirtualmachineIDEQ(vmID)).
		Order(db.Desc(taskvirtualmachine.FieldCreatedAt)).
		First(ctx)
	if err != nil {
		p.logger.WarnContext(ctx, "resolve task from vm failed", "vm_id", vmID, "error", err)
		return uuid.Nil
	}
	return taskVM.TaskID
}

type usagePayload struct {
	requestID    string
	inputTokens  uint64
	outputTokens uint64
	cachedTokens uint64
	totalTokens  uint64
}

func parseUsage(path string, body []byte) (usagePayload, bool) {
	switch path {
	case "/chat/completions":
		return parseOpenAIChatUsage(body)
	case "/responses":
		return parseOpenAIResponsesUsage(body)
	case "/messages":
		return parseAnthropicUsage(body)
	default:
		return usagePayload{}, false
	}
}

func parseOpenAIChatUsage(body []byte) (usagePayload, bool) {
	if usage, ok := parseOpenAIChatUsageJSON(body); ok {
		return usage, true
	}
	var usage usagePayload
	for _, evt := range parseSSE(body) {
		if evt.data == "" || evt.data == "[DONE]" {
			continue
		}
		if got, ok := parseOpenAIChatUsageJSON([]byte(evt.data)); ok {
			usage = got
		}
	}
	return usage, usage.hasTokens()
}

func parseOpenAIResponsesUsage(body []byte) (usagePayload, bool) {
	if usage, ok := parseOpenAIResponsesUsageJSON(body); ok {
		return usage, true
	}
	var usage usagePayload
	for _, evt := range parseSSE(body) {
		if evt.event != "response.completed" || evt.data == "" {
			continue
		}
		if got, ok := parseOpenAIResponsesUsageJSON([]byte(evt.data)); ok {
			usage = got
		}
	}
	return usage, usage.hasTokens()
}

func parseAnthropicUsage(body []byte) (usagePayload, bool) {
	if usage, ok := parseAnthropicUsageJSON(body); ok {
		return usage, true
	}
	var usage usagePayload
	for _, evt := range parseSSE(body) {
		if evt.data == "" {
			continue
		}
		switch evt.event {
		case "message_start":
			got, ok := parseAnthropicUsageJSON([]byte(evt.data))
			if !ok {
				continue
			}
			usage.requestID = got.requestID
			usage.inputTokens = got.inputTokens
			usage.cachedTokens = got.cachedTokens
		case "message_delta":
			got, ok := parseAnthropicUsageJSON([]byte(evt.data))
			if !ok {
				continue
			}
			if got.inputTokens > 0 {
				usage.inputTokens = got.inputTokens
			}
			if got.cachedTokens > 0 {
				usage.cachedTokens = got.cachedTokens
			}
			usage.outputTokens = got.outputTokens
		}
	}
	if usage.totalTokens == 0 {
		usage.totalTokens = usage.inputTokens + usage.outputTokens
	}
	return usage, usage.hasTokens()
}

func parseOpenAIChatUsageJSON(body []byte) (usagePayload, bool) {
	var resp struct {
		ID    string `json:"id"`
		Usage struct {
			PromptTokens        uint64 `json:"prompt_tokens"`
			CompletionTokens    uint64 `json:"completion_tokens"`
			TotalTokens         uint64 `json:"total_tokens"`
			PromptTokensDetails struct {
				CachedTokens uint64 `json:"cached_tokens"`
			} `json:"prompt_tokens_details"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return usagePayload{}, false
	}
	usage := usagePayload{
		requestID:    resp.ID,
		inputTokens:  resp.Usage.PromptTokens,
		outputTokens: resp.Usage.CompletionTokens,
		cachedTokens: resp.Usage.PromptTokensDetails.CachedTokens,
		totalTokens:  resp.Usage.TotalTokens,
	}
	if usage.totalTokens == 0 {
		usage.totalTokens = usage.inputTokens + usage.outputTokens
	}
	return usage, usage.hasTokens()
}

func parseOpenAIResponsesUsageJSON(body []byte) (usagePayload, bool) {
	var resp struct {
		ID       string `json:"id"`
		Response *struct {
			ID    string `json:"id"`
			Usage struct {
				InputTokens        uint64 `json:"input_tokens"`
				OutputTokens       uint64 `json:"output_tokens"`
				TotalTokens        uint64 `json:"total_tokens"`
				InputTokensDetails struct {
					CachedTokens uint64 `json:"cached_tokens"`
				} `json:"input_tokens_details"`
			} `json:"usage"`
		} `json:"response"`
		Usage struct {
			InputTokens        uint64 `json:"input_tokens"`
			OutputTokens       uint64 `json:"output_tokens"`
			TotalTokens        uint64 `json:"total_tokens"`
			InputTokensDetails struct {
				CachedTokens uint64 `json:"cached_tokens"`
			} `json:"input_tokens_details"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return usagePayload{}, false
	}
	requestID := resp.ID
	inputTokens := resp.Usage.InputTokens
	outputTokens := resp.Usage.OutputTokens
	cachedTokens := resp.Usage.InputTokensDetails.CachedTokens
	totalTokens := resp.Usage.TotalTokens
	if resp.Response != nil {
		requestID = resp.Response.ID
		inputTokens = resp.Response.Usage.InputTokens
		outputTokens = resp.Response.Usage.OutputTokens
		cachedTokens = resp.Response.Usage.InputTokensDetails.CachedTokens
		totalTokens = resp.Response.Usage.TotalTokens
	}
	usage := usagePayload{
		requestID:    requestID,
		inputTokens:  inputTokens,
		outputTokens: outputTokens,
		cachedTokens: cachedTokens,
		totalTokens:  totalTokens,
	}
	if usage.totalTokens == 0 {
		usage.totalTokens = usage.inputTokens + usage.outputTokens
	}
	return usage, usage.hasTokens()
}

func parseAnthropicUsageJSON(body []byte) (usagePayload, bool) {
	var resp struct {
		ID      string `json:"id"`
		Message *struct {
			ID    string `json:"id"`
			Usage struct {
				InputTokens              uint64 `json:"input_tokens"`
				OutputTokens             uint64 `json:"output_tokens"`
				CacheReadInputTokens     uint64 `json:"cache_read_input_tokens"`
				CacheCreationInputTokens uint64 `json:"cache_creation_input_tokens"`
			} `json:"usage"`
		} `json:"message"`
		Usage struct {
			InputTokens              uint64 `json:"input_tokens"`
			OutputTokens             uint64 `json:"output_tokens"`
			CacheReadInputTokens     uint64 `json:"cache_read_input_tokens"`
			CacheCreationInputTokens uint64 `json:"cache_creation_input_tokens"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return usagePayload{}, false
	}
	requestID := resp.ID
	inputTokens := resp.Usage.InputTokens
	outputTokens := resp.Usage.OutputTokens
	cacheReadTokens := resp.Usage.CacheReadInputTokens
	if resp.Message != nil {
		requestID = resp.Message.ID
		inputTokens = resp.Message.Usage.InputTokens
		outputTokens = resp.Message.Usage.OutputTokens
		cacheReadTokens = resp.Message.Usage.CacheReadInputTokens
	}
	inputTokens += cacheReadTokens
	usage := usagePayload{
		requestID:    requestID,
		inputTokens:  inputTokens,
		outputTokens: outputTokens,
		cachedTokens: cacheReadTokens,
		totalTokens:  inputTokens + outputTokens,
	}
	return usage, usage.hasTokens()
}

func (u usagePayload) hasTokens() bool {
	return u.inputTokens > 0 || u.outputTokens > 0 || u.totalTokens > 0
}

type sseEvent struct {
	event string
	data  string
}

func parseSSE(body []byte) []sseEvent {
	var events []sseEvent
	var current sseEvent
	var data strings.Builder
	flush := func() {
		if current.event == "" && data.Len() == 0 {
			return
		}
		current.data = strings.TrimSuffix(data.String(), "\n")
		events = append(events, current)
		current = sseEvent{}
		data.Reset()
	}
	scanner := bufio.NewScanner(bytes.NewReader(body))
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			flush()
			continue
		}
		if strings.HasPrefix(line, "event:") {
			current.event = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
			continue
		}
		if strings.HasPrefix(line, "data:") {
			data.WriteString(strings.TrimSpace(strings.TrimPrefix(line, "data:")))
			data.WriteByte('\n')
		}
	}
	flush()
	return events
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
