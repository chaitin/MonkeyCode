package proxy

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

type Call struct {
	ModelID           string
	UserID            string
	SessionID         string
	RequestID         string
	InputTokens       uint64
	OutputTokens      uint64
	CachedInputTokens uint64
	StartedAt         time.Time
	CompletedAt       time.Time
}

type usageResult struct {
	InputTokens          uint64
	OutputTokens         uint64
	CacheReadInputTokens uint64
	CachedTokens         uint64
	ResponseID           string
}

func (r usageResult) totalTokens() uint64 {
	return r.InputTokens + r.OutputTokens + r.CacheReadInputTokens
}

func (r usageResult) hasTokens() bool {
	return r.totalTokens() > 0
}

type usageCaptureContext struct {
	ctx      context.Context
	path     string
	stream   bool
	proxyCtx *proxyContext
	proxy    *Proxy
}

type usageCapture struct {
	logger *slog.Logger
	src    io.ReadCloser
	ctx    usageCaptureContext
	reader *io.PipeReader
	writer *io.PipeWriter
}

var _ io.ReadCloser = (*usageCapture)(nil)

func newUsageCapture(logger *slog.Logger, src io.ReadCloser, ctx usageCaptureContext) *usageCapture {
	reader, writer := io.Pipe()
	capture := &usageCapture{
		logger: logger,
		src:    src,
		ctx:    ctx,
		reader: reader,
		writer: writer,
	}
	go capture.handleShadow()
	return capture
}

func (p *Proxy) modifyResponse(response *http.Response) error {
	if response == nil || response.Body == nil || p.recorder == nil {
		return nil
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return nil
	}
	ctx, ok := response.Request.Context().Value(proxyContextKey{}).(*proxyContext)
	if !ok || ctx == nil {
		return nil
	}
	response.Body = newUsageCapture(p.logger, response.Body, usageCaptureContext{
		ctx:      response.Request.Context(),
		path:     normalizeUsagePath(response.Request.URL.Path),
		stream:   ctx.stream,
		proxyCtx: ctx,
		proxy:    p,
	})
	return nil
}

func normalizeUsagePath(path string) string {
	switch {
	case strings.HasSuffix(path, "/chat/completions"):
		return "/v1/chat/completions"
	case strings.HasSuffix(path, "/responses"):
		return "/v1/responses"
	case strings.HasSuffix(path, "/messages"):
		return "/v1/messages"
	default:
		return path
	}
}

func (p *Proxy) recordUsage(ctx context.Context, proxyCtx *proxyContext, result usageResult) {
	if p.recorder == nil || proxyCtx == nil || !result.hasTokens() {
		return
	}
	target := proxyCtx.target
	completedAt := time.Now()
	call := Call{
		ModelID:           target.ModelID,
		UserID:            target.UserID,
		SessionID:         target.SessionID,
		RequestID:         result.ResponseID,
		InputTokens:       result.InputTokens + result.CacheReadInputTokens,
		OutputTokens:      result.OutputTokens,
		CachedInputTokens: result.CacheReadInputTokens + result.CachedTokens,
		StartedAt:         proxyCtx.startedAt,
		CompletedAt:       completedAt,
	}
	if err := p.recorder.Record(context.WithoutCancel(ctx), call); err != nil {
		p.logger.WarnContext(ctx, "记录模型调用用量失败", "model_id", target.ModelID, "error", err)
	}
}

func (c *usageCapture) handleShadow() {
	defer c.reader.Close()
	var result usageResult
	if c.ctx.stream {
		result = c.handleStream()
	} else {
		result = c.handleNonStream()
	}
	if c.ctx.proxy != nil {
		c.ctx.proxy.recordUsage(c.ctx.ctx, c.ctx.proxyCtx, result)
	}
}

func (c *usageCapture) handleStream() usageResult {
	var result usageResult
	decoder := newSSEDecoder(c.reader)
	logger := c.logger.With("path", c.ctx.path)
	for decoder.Next() {
		event := decoder.Event()
		switch event.Type {
		case "response.completed":
			response, err := parseOpenAIResponseEvent(event.Data)
			if err != nil {
				logger.WarnContext(c.ctx.ctx, "解析 Responses 流式用量失败", "error", err)
				continue
			}
			result.InputTokens = response.Usage.InputTokens
			result.OutputTokens = response.Usage.OutputTokens
			result.ResponseID = response.ID
			result.CachedTokens = response.Usage.InputTokensDetails.CachedTokens
		case "done":
			response, err := parseChatCompletion(event.Data)
			if err != nil {
				logger.WarnContext(c.ctx.ctx, "解析 Chat Completions 流式用量失败", "error", err)
				continue
			}
			result.InputTokens = response.Usage.PromptTokens
			result.OutputTokens = response.Usage.CompletionTokens
			result.ResponseID = response.ID
			result.CachedTokens = response.Usage.PromptTokensDetails.CachedTokens
		case "message_start":
			response, err := parseAnthropicResponse(event.Data)
			if err != nil {
				logger.WarnContext(c.ctx.ctx, "解析 Anthropic message_start 用量失败", "error", err)
				continue
			}
			result.ResponseID = response.Message.ID
			result.InputTokens = response.Message.Usage.InputTokens
			result.CacheReadInputTokens = response.Message.Usage.CacheReadInputTokens
		case "message_delta":
			response, err := parseAnthropicResponse(event.Data)
			if err != nil {
				logger.WarnContext(c.ctx.ctx, "解析 Anthropic message_delta 用量失败", "error", err)
				continue
			}
			if response.Usage.InputTokens > 0 {
				result.InputTokens = response.Usage.InputTokens
			}
			result.OutputTokens = response.Usage.OutputTokens
			if response.Usage.CacheReadInputTokens > 0 {
				result.CacheReadInputTokens = response.Usage.CacheReadInputTokens
			}
		}
	}
	if err := decoder.Err(); err != nil {
		logger.WarnContext(c.ctx.ctx, "读取模型流式响应失败", "error", err)
	}
	return result
}

func (c *usageCapture) handleNonStream() usageResult {
	var result usageResult
	logger := c.logger.With("path", c.ctx.path)
	data, err := io.ReadAll(c.reader)
	if err != nil {
		logger.WarnContext(c.ctx.ctx, "读取模型响应副本失败", "error", err)
		return result
	}
	switch c.ctx.path {
	case "/v1/responses":
		response, err := parseOpenAIResponse(data)
		if err != nil {
			logger.WarnContext(c.ctx.ctx, "解析 Responses 用量失败", "error", err)
			return result
		}
		result.InputTokens = response.Usage.InputTokens
		result.OutputTokens = response.Usage.OutputTokens
		result.ResponseID = response.ID
		result.CachedTokens = response.Usage.InputTokensDetails.CachedTokens
	case "/v1/chat/completions":
		response, err := parseChatCompletion(data)
		if err != nil {
			logger.WarnContext(c.ctx.ctx, "解析 Chat Completions 用量失败", "error", err)
			return result
		}
		result.InputTokens = response.Usage.PromptTokens
		result.OutputTokens = response.Usage.CompletionTokens
		result.ResponseID = response.ID
		result.CachedTokens = response.Usage.PromptTokensDetails.CachedTokens
	case "/v1/messages":
		response, err := parseAnthropicResponse(data)
		if err != nil {
			logger.WarnContext(c.ctx.ctx, "解析 Anthropic 用量失败", "error", err)
			return result
		}
		result.InputTokens = response.Usage.InputTokens
		result.OutputTokens = response.Usage.OutputTokens
		result.CacheReadInputTokens = response.Usage.CacheReadInputTokens
		result.ResponseID = response.ID
	}
	return result
}

func (c *usageCapture) Close() error {
	_ = c.writer.Close()
	return c.src.Close()
}

func (c *usageCapture) Read(buffer []byte) (int, error) {
	n, err := c.src.Read(buffer)
	if n > 0 {
		_, _ = c.writer.Write(bytes.Clone(buffer[:n]))
	}
	if err != nil {
		_ = c.writer.Close()
	}
	return n, err
}

type openAIResponseEvent struct {
	Response openAIResponse `json:"response"`
}

type openAIResponse struct {
	ID    string     `json:"id"`
	Usage tokenUsage `json:"usage"`
}

type tokenUsage struct {
	InputTokens          uint64       `json:"input_tokens"`
	OutputTokens         uint64       `json:"output_tokens"`
	CacheReadInputTokens uint64       `json:"cache_read_input_tokens"`
	InputTokensDetails   tokenDetails `json:"input_tokens_details"`
}

type tokenDetails struct {
	CachedTokens uint64 `json:"cached_tokens"`
}

type chatCompletion struct {
	ID    string `json:"id"`
	Usage struct {
		PromptTokens        uint64       `json:"prompt_tokens"`
		CompletionTokens    uint64       `json:"completion_tokens"`
		PromptTokensDetails tokenDetails `json:"prompt_tokens_details"`
	} `json:"usage"`
}

type anthropicResponse struct {
	ID      string           `json:"id"`
	Usage   tokenUsage       `json:"usage"`
	Message anthropicMessage `json:"message"`
}

type anthropicMessage struct {
	ID    string     `json:"id"`
	Usage tokenUsage `json:"usage"`
}

func parseOpenAIResponseEvent(data []byte) (openAIResponse, error) {
	var event openAIResponseEvent
	err := json.Unmarshal(data, &event)
	return event.Response, err
}

func parseOpenAIResponse(data []byte) (openAIResponse, error) {
	var response openAIResponse
	if err := json.Unmarshal(data, &response); err != nil {
		return openAIResponse{}, err
	}
	if response.ID != "" {
		return response, nil
	}
	return parseOpenAIResponseEvent(data)
}

func parseChatCompletion(data []byte) (chatCompletion, error) {
	var response chatCompletion
	err := json.Unmarshal(data, &response)
	return response, err
}

func parseAnthropicResponse(data []byte) (anthropicResponse, error) {
	var response anthropicResponse
	err := json.Unmarshal(data, &response)
	return response, err
}

type sseEvent struct {
	Type string
	Data []byte
}

type sseDecoder struct {
	scanner  *bufio.Scanner
	current  sseEvent
	lastData []byte
	done     bool
}

func newSSEDecoder(reader io.Reader) *sseDecoder {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 64<<10), 4<<20)
	return &sseDecoder{scanner: scanner}
}

func (d *sseDecoder) Next() bool {
	if d.done {
		return false
	}
	var eventType string
	var data bytes.Buffer
	for d.scanner.Scan() {
		line := d.scanner.Text()
		if line == "" {
			if eventType == "" && data.Len() == 0 {
				continue
			}
			return d.setEvent(eventType, data.Bytes())
		}
		if value, ok := strings.CutPrefix(line, "event:"); ok {
			eventType = strings.TrimSpace(value)
			continue
		}
		if value, ok := strings.CutPrefix(line, "data:"); ok {
			chunk := strings.TrimSpace(value)
			if chunk == "[DONE]" {
				d.current = sseEvent{Type: "done", Data: bytes.Clone(d.lastData)}
				d.done = true
				return true
			}
			data.WriteString(chunk)
			data.WriteByte('\n')
		}
	}
	if eventType != "" || data.Len() > 0 {
		return d.setEvent(eventType, data.Bytes())
	}
	return false
}

func (d *sseDecoder) setEvent(eventType string, data []byte) bool {
	data = bytes.TrimSuffix(data, []byte("\n"))
	d.current = sseEvent{Type: eventType, Data: bytes.Clone(data)}
	d.lastData = bytes.Clone(data)
	return true
}

func (d *sseDecoder) Event() sseEvent {
	return d.current
}

func (d *sseDecoder) Err() error {
	return d.scanner.Err()
}
