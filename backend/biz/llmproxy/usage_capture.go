package llmproxy

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"strings"
)

type usageResult struct {
	InputTokens              uint64
	OutputTokens             uint64
	CacheReadInputTokens     uint64
	CacheCreationInputTokens uint64
	ReasoningTokens          uint64
	CachedTokens             uint64
	ResponseID               string
}

func (r usageResult) totalTokens() uint64 {
	return r.InputTokens + r.OutputTokens + r.CacheReadInputTokens
}

func (r usageResult) hasTokens() bool {
	return r.totalTokens() > 0
}

type UsageCaptureContext struct {
	ctx      context.Context
	path     string
	stream   bool
	proxyCtx *proxyContext
	proxy    *Proxy
}

type UsageCapture struct {
	logger *slog.Logger
	src    io.ReadCloser
	ctx    *UsageCaptureContext
	pr     *io.PipeReader
	pw     *io.PipeWriter
}

var _ io.ReadCloser = &UsageCapture{}

func NewUsageCapture(logger *slog.Logger, src io.ReadCloser, ctx *UsageCaptureContext) *UsageCapture {
	pr, pw := io.Pipe()
	b := &UsageCapture{
		logger: logger,
		src:    src,
		ctx:    ctx,
		pr:     pr,
		pw:     pw,
	}
	go b.handleShadow()
	return b
}

func (b *UsageCapture) handleStream() usageResult {
	var result usageResult
	decoder := newSSEDecoder(b.pr)
	logger := b.logger.With("path", b.ctx.path)
	for decoder.Next() {
		evt := decoder.Event()
		switch evt.Type {
		case "response.completed":
			resp, err := parseOpenAIResponseWrapper(evt.Data)
			if err != nil {
				logger.With("data", string(evt.Data), "error", err).WarnContext(b.ctx.ctx, "parse stream response usage failed")
				continue
			}
			result.InputTokens = resp.Response.Usage.InputTokens
			result.OutputTokens = resp.Response.Usage.OutputTokens
			result.ResponseID = resp.Response.ID
			result.CachedTokens = resp.Response.Usage.InputTokensDetails.CachedTokens

		case "done":
			resp, err := parseOpenAIChatCompletionResponse(evt.Data)
			if err != nil {
				logger.With("data", string(evt.Data), "error", err).WarnContext(b.ctx.ctx, "parse stream chat usage failed")
				continue
			}
			result.InputTokens = resp.Usage.PromptTokens
			result.OutputTokens = resp.Usage.CompletionTokens
			result.ResponseID = resp.ID
			result.CachedTokens = resp.Usage.PromptTokensDetails.CachedTokens
			result.ReasoningTokens = resp.Usage.CompletionTokensDetails.ReasoningTokens

		case "message_start":
			resp, err := parseAnthropicResponse(evt.Data)
			if err != nil {
				logger.With("data", string(evt.Data), "error", err).WarnContext(b.ctx.ctx, "parse message_start usage failed")
				continue
			}
			result.ResponseID = resp.Message.ID
			result.InputTokens = resp.Message.Usage.InputTokens
			result.CacheReadInputTokens = resp.Message.Usage.CacheReadInputTokens
			result.CacheCreationInputTokens = resp.Message.Usage.CacheCreationInputTokens

		case "message_delta":
			resp, err := parseAnthropicResponse(evt.Data)
			if err != nil {
				logger.With("data", string(evt.Data), "error", err).WarnContext(b.ctx.ctx, "parse message_delta usage failed")
				continue
			}
			if resp.Usage.InputTokens > 0 {
				result.InputTokens = resp.Usage.InputTokens
			}
			result.OutputTokens = resp.Usage.OutputTokens
			if resp.Usage.CacheReadInputTokens > 0 {
				result.CacheReadInputTokens = resp.Usage.CacheReadInputTokens
			}
			if resp.Usage.CacheCreationInputTokens > 0 {
				result.CacheCreationInputTokens = resp.Usage.CacheCreationInputTokens
			}
		}
	}
	return result
}

func (b *UsageCapture) handleShadow() {
	defer func() {
		if b.pr != nil {
			_ = b.pr.Close()
		}
	}()
	var result usageResult
	if b.ctx.stream {
		result = b.handleStream()
	} else {
		result = b.handleNonStream()
	}
	if b.ctx.proxy != nil {
		b.ctx.proxy.recordUsage(context.Background(), b.ctx.proxyCtx, result)
	}
}

func (b *UsageCapture) handleNonStream() usageResult {
	var result usageResult
	logger := b.logger.With("path", b.ctx.path)
	data, err := io.ReadAll(b.pr)
	if err != nil {
		logger.With("error", err).WarnContext(b.ctx.ctx, "read shadow response failed")
		return result
	}
	switch b.ctx.path {
	case "/v1/responses":
		resp, err := parseOpenAIResponseWrapper(data)
		if err != nil {
			logger.With("data", string(data), "error", err).WarnContext(b.ctx.ctx, "parse response usage failed")
			return result
		}
		result.InputTokens = resp.Response.Usage.InputTokens
		result.OutputTokens = resp.Response.Usage.OutputTokens
		result.ResponseID = resp.Response.ID
		result.CachedTokens = resp.Response.Usage.InputTokensDetails.CachedTokens

	case "/v1/chat/completions":
		resp, err := parseOpenAIChatCompletionResponse(data)
		if err != nil {
			logger.With("data", string(data), "error", err).WarnContext(b.ctx.ctx, "parse chat usage failed")
			return result
		}
		result.InputTokens = resp.Usage.PromptTokens
		result.OutputTokens = resp.Usage.CompletionTokens
		result.ResponseID = resp.ID
		result.CachedTokens = resp.Usage.PromptTokensDetails.CachedTokens
		result.ReasoningTokens = resp.Usage.CompletionTokensDetails.ReasoningTokens

	case "/v1/messages":
		resp, err := parseAnthropicResponse(data)
		if err != nil {
			logger.With("data", string(data), "error", err).WarnContext(b.ctx.ctx, "parse anthropic usage failed")
			return result
		}
		result.InputTokens = resp.Usage.InputTokens
		result.OutputTokens = resp.Usage.OutputTokens
		result.CacheReadInputTokens = resp.Usage.CacheReadInputTokens
		result.CacheCreationInputTokens = resp.Usage.CacheCreationInputTokens
		result.ResponseID = resp.ID
	}
	return result
}

func (b *UsageCapture) Close() error {
	if b.pw != nil {
		_ = b.pw.Close()
	}
	return b.src.Close()
}

func (b *UsageCapture) Read(p []byte) (int, error) {
	n, err := b.src.Read(p)
	if n > 0 {
		data := make([]byte, n)
		copy(data, p[:n])
		_, _ = b.pw.Write(data)
	}
	if err != nil {
		_ = b.pw.Close()
	}
	return n, err
}

type openAIResponseWrapper struct {
	Type     string         `json:"type"`
	Response openAIResponse `json:"response"`
}

type openAIResponse struct {
	ID    string     `json:"id"`
	Usage tokenUsage `json:"usage"`
}

type tokenUsage struct {
	InputTokens              uint64            `json:"input_tokens"`
	OutputTokens             uint64            `json:"output_tokens"`
	TotalTokens              uint64            `json:"total_tokens"`
	CacheReadInputTokens     uint64            `json:"cache_read_input_tokens"`
	CacheCreationInputTokens uint64            `json:"cache_creation_input_tokens"`
	InputTokensDetails       tokenDetails      `json:"input_tokens_details"`
	PromptTokensDetails      tokenDetails      `json:"prompt_tokens_details"`
	CompletionTokensDetails  completionDetails `json:"completion_tokens_details"`
}

type tokenDetails struct {
	CachedTokens uint64 `json:"cached_tokens"`
}

type completionDetails struct {
	ReasoningTokens uint64 `json:"reasoning_tokens"`
}

type openAIChatCompletionResponse struct {
	ID    string `json:"id"`
	Usage struct {
		PromptTokens            uint64            `json:"prompt_tokens"`
		CompletionTokens        uint64            `json:"completion_tokens"`
		TotalTokens             uint64            `json:"total_tokens"`
		PromptTokensDetails     tokenDetails      `json:"prompt_tokens_details"`
		CompletionTokensDetails completionDetails `json:"completion_tokens_details"`
	} `json:"usage"`
}

type anthropicResponse struct {
	ID      string           `json:"id"`
	Type    string           `json:"type"`
	Usage   tokenUsage       `json:"usage"`
	Message anthropicMessage `json:"message"`
}

type anthropicMessage struct {
	ID    string     `json:"id"`
	Usage tokenUsage `json:"usage"`
}

func parseOpenAIResponseWrapper(data []byte) (openAIResponseWrapper, error) {
	var resp openAIResponseWrapper
	err := json.Unmarshal(data, &resp)
	return resp, err
}

func parseOpenAIChatCompletionResponse(data []byte) (openAIChatCompletionResponse, error) {
	var resp openAIChatCompletionResponse
	err := json.Unmarshal(data, &resp)
	return resp, err
}

func parseAnthropicResponse(data []byte) (anthropicResponse, error) {
	var resp anthropicResponse
	err := json.Unmarshal(data, &resp)
	return resp, err
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

func newSSEDecoder(r io.Reader) *sseDecoder {
	return &sseDecoder{scanner: bufio.NewScanner(r)}
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
			if eventType != "" || data.Len() > 0 {
				d.current = sseEvent{Type: eventType, Data: bytes.TrimSuffix(data.Bytes(), []byte("\n"))}
				return true
			}
			continue
		}
		if strings.HasPrefix(line, "event:") {
			eventType = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
			continue
		}
		if strings.HasPrefix(line, "data:") {
			chunk := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
			if chunk == "[DONE]" {
				d.current = sseEvent{Type: "done", Data: bytes.Clone(d.lastData)}
				d.done = true
				return true
			}
			data.WriteString(chunk)
			d.lastData = []byte(chunk)
			data.WriteByte('\n')
		}
	}
	if eventType != "" || data.Len() > 0 {
		d.current = sseEvent{Type: eventType, Data: bytes.TrimSuffix(data.Bytes(), []byte("\n"))}
		return true
	}
	return false
}

func (d *sseDecoder) Event() sseEvent {
	return d.current
}
