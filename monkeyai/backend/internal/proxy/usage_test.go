package proxy

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
	"testing"
)

func newUsageCaptureForTest(path string, stream bool, body string) *usageCapture {
	reader, writer := io.Pipe()
	capture := &usageCapture{
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		ctx: usageCaptureContext{
			ctx:    context.Background(),
			path:   path,
			stream: stream,
		},
		reader: reader,
		writer: writer,
	}
	go func() {
		_, _ = io.Copy(writer, strings.NewReader(body))
		_ = writer.Close()
	}()
	return capture
}

func TestUsageCaptureParsesOpenAIResponsesUsage(t *testing.T) {
	tests := map[string]string{
		"response": `{
			"id":"resp_test",
			"usage":{"input_tokens":100,"output_tokens":20,"input_tokens_details":{"cached_tokens":30}}
		}`,
		"event wrapper": `{
			"type":"response.completed",
			"response":{"id":"resp_test","usage":{"input_tokens":100,"output_tokens":20,"input_tokens_details":{"cached_tokens":30}}}
		}`,
	}
	for name, body := range tests {
		t.Run(name, func(t *testing.T) {
			result := newUsageCaptureForTest("/v1/responses", false, body).handleNonStream()
			if result.ResponseID != "resp_test" || result.InputTokens != 100 || result.OutputTokens != 20 || result.CachedTokens != 30 || result.totalTokens() != 120 {
				t.Fatalf("result = %+v", result)
			}
		})
	}
}

func TestUsageCaptureParsesOpenAIResponsesStreamUsage(t *testing.T) {
	body := strings.Join([]string{
		"event: response.output_text.delta",
		`data: {"delta":"hello"}`,
		"",
		"event: response.completed",
		`data: {"type":"response.completed","response":{"id":"resp_stream","usage":{"input_tokens":8,"output_tokens":3}}}`,
		"",
	}, "\n")
	result := newUsageCaptureForTest("/v1/responses", true, body).handleStream()
	if result.ResponseID != "resp_stream" || result.InputTokens != 8 || result.OutputTokens != 3 || result.totalTokens() != 11 {
		t.Fatalf("result = %+v", result)
	}
}

func TestUsageCaptureParsesChatCompletionStreamUsage(t *testing.T) {
	body := strings.Join([]string{
		`data: {"choices":[{"delta":{"content":"hi"}}]}`,
		"",
		`data: {"id":"chat_stream","usage":{"prompt_tokens":4,"completion_tokens":6,"prompt_tokens_details":{"cached_tokens":2}}}`,
		"",
		"data: [DONE]",
		"",
	}, "\n")
	result := newUsageCaptureForTest("/v1/chat/completions", true, body).handleStream()
	if result.ResponseID != "chat_stream" || result.InputTokens != 4 || result.OutputTokens != 6 || result.CachedTokens != 2 || result.totalTokens() != 10 {
		t.Fatalf("result = %+v", result)
	}
}

func TestUsageCaptureParsesAnthropicUsage(t *testing.T) {
	nonStream := newUsageCaptureForTest("/v1/messages", false, `{
		"id":"msg_test",
		"usage":{"input_tokens":7,"output_tokens":5,"cache_read_input_tokens":3,"cache_creation_input_tokens":2}
	}`).handleNonStream()
	if nonStream.ResponseID != "msg_test" || nonStream.InputTokens != 7 || nonStream.OutputTokens != 5 || nonStream.CacheReadInputTokens != 3 || nonStream.totalTokens() != 17 {
		t.Fatalf("non-stream result = %+v", nonStream)
	}

	body := strings.Join([]string{
		"event: message_start",
		`data: {"type":"message_start","message":{"id":"msg_stream","usage":{"input_tokens":7,"cache_read_input_tokens":3,"cache_creation_input_tokens":2}}}`,
		"",
		"event: message_delta",
		`data: {"type":"message_delta","usage":{"output_tokens":5}}`,
		"",
	}, "\n")
	stream := newUsageCaptureForTest("/v1/messages", true, body).handleStream()
	if stream.ResponseID != "msg_stream" || stream.InputTokens != 7 || stream.OutputTokens != 5 || stream.CacheReadInputTokens != 3 || stream.totalTokens() != 17 {
		t.Fatalf("stream result = %+v", stream)
	}
}

func TestUsageCaptureReadCopiesResponse(t *testing.T) {
	reader, writer := io.Pipe()
	capture := &usageCapture{
		logger: discardLogger(),
		src: io.NopCloser(strings.NewReader(`{
			"id":"chat_test",
			"usage":{"prompt_tokens":4,"completion_tokens":6}
		}`)),
		ctx: usageCaptureContext{
			ctx:  context.Background(),
			path: "/v1/chat/completions",
		},
		reader: reader,
		writer: writer,
	}
	result := make(chan usageResult, 1)
	go func() {
		result <- capture.handleNonStream()
	}()

	data, err := io.ReadAll(capture)
	if err != nil {
		t.Fatal(err)
	}
	parsed := <-result
	if !strings.Contains(string(data), "chat_test") {
		t.Fatalf("body = %q", data)
	}
	if parsed.ResponseID != "chat_test" || parsed.InputTokens != 4 || parsed.OutputTokens != 6 {
		t.Fatalf("result = %+v", parsed)
	}
}

func TestUsageCaptureClosedPipeDoesNotInterruptResponse(t *testing.T) {
	var logs bytes.Buffer
	reader, writer := io.Pipe()
	if err := reader.Close(); err != nil {
		t.Fatal(err)
	}
	capture := &usageCapture{
		logger: slog.New(slog.NewTextHandler(&logs, nil)),
		src:    io.NopCloser(strings.NewReader("private-upstream-response")),
		ctx: usageCaptureContext{ctx: context.Background(), path: "/v1/responses", proxyCtx: &proxyContext{
			target: Target{ModelID: "model-1"}, reservation: Reservation{ID: "transaction-1"},
		}},
		reader: reader, writer: writer,
	}
	body, err := io.ReadAll(capture)
	if err != nil || string(body) != "private-upstream-response" {
		t.Fatalf("转发响应失败: %q %v", body, err)
	}
	if err := capture.Close(); err != nil {
		t.Fatal(err)
	}
	text := logs.String()
	if text != "" {
		t.Fatalf("正常关闭的管道不应记录错误: %s", text)
	}
}

func TestUsageCaptureNormalCloseDoesNotLogError(t *testing.T) {
	var logs bytes.Buffer
	reader, writer := io.Pipe()
	capture := &usageCapture{
		logger: slog.New(slog.NewTextHandler(&logs, nil)),
		src:    io.NopCloser(strings.NewReader("")),
		ctx:    usageCaptureContext{ctx: context.Background(), path: "/v1/responses"},
		reader: reader, writer: writer,
	}
	if _, err := io.ReadAll(capture); err != nil {
		t.Fatal(err)
	}
	if err := capture.Close(); err != nil {
		t.Fatal(err)
	}
	if logs.Len() != 0 {
		t.Fatalf("正常关闭被误判为错误: %s", logs.String())
	}
	if err := reader.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestUsageCapturePipeErrorLogsDetailWithoutResponse(t *testing.T) {
	var logs bytes.Buffer
	reader, writer := io.Pipe()
	if err := reader.CloseWithError(errors.New("用量解析器意外失败")); err != nil {
		t.Fatal(err)
	}
	capture := &usageCapture{
		logger: slog.New(slog.NewTextHandler(&logs, nil)),
		src:    io.NopCloser(strings.NewReader("private-upstream-response")),
		ctx: usageCaptureContext{ctx: context.Background(), path: "/v1/responses", proxyCtx: &proxyContext{
			target: Target{ModelID: "model-1"}, reservation: Reservation{ID: "transaction-1"},
		}},
		reader: reader, writer: writer,
	}
	body, err := io.ReadAll(capture)
	if err != nil || string(body) != "private-upstream-response" {
		t.Fatalf("响应转发失败: %q %v", body, err)
	}
	if err := capture.Close(); err != nil {
		t.Fatal(err)
	}
	text := logs.String()
	if strings.Count(text, "write_usage_pipe") != 1 || !strings.Contains(text, "用量解析器意外失败") || !strings.Contains(text, "transaction-1") || !strings.Contains(text, "model-1") || strings.Contains(text, "private-upstream-response") {
		t.Fatalf("管道错误日志缺少详情或泄漏响应: %s", text)
	}
}

func TestUsageCaptureCanceledRequestDoesNotLogPipeError(t *testing.T) {
	var logs bytes.Buffer
	ctx, cancel := context.WithCancel(context.Background())
	reader, writer := io.Pipe()
	if err := reader.CloseWithError(errors.New("管道意外关闭")); err != nil {
		t.Fatal(err)
	}
	cancel()
	capture := &usageCapture{
		logger: slog.New(slog.NewTextHandler(&logs, nil)),
		src:    io.NopCloser(strings.NewReader("upstream-response")),
		ctx:    usageCaptureContext{ctx: ctx, path: "/v1/responses"},
		reader: reader, writer: writer,
	}
	if _, err := io.ReadAll(capture); err != nil {
		t.Fatal(err)
	}
	if err := capture.Close(); err != nil {
		t.Fatal(err)
	}
	if logs.Len() != 0 {
		t.Fatalf("请求取消不应记录管道错误: %s", logs.String())
	}
}

type closeErrorReader struct {
	io.Reader
	err error
}

func (r closeErrorReader) Close() error { return r.err }

func TestUsageCaptureUpstreamCloseDoesNotLogPrivateError(t *testing.T) {
	var logs bytes.Buffer
	reader, writer := io.Pipe()
	defer func() {
		if err := reader.Close(); err != nil && !errors.Is(err, io.ErrClosedPipe) {
			t.Errorf("关闭测试管道失败: %v", err)
		}
	}()
	upstreamErr := errors.New("private-upstream-response")
	capture := &usageCapture{
		logger: slog.New(slog.NewTextHandler(&logs, nil)),
		src:    closeErrorReader{Reader: strings.NewReader(""), err: upstreamErr},
		ctx:    usageCaptureContext{ctx: context.Background(), path: "/v1/responses"},
		reader: reader, writer: writer,
	}
	if err := capture.Close(); !errors.Is(err, upstreamErr) {
		t.Fatalf("上游关闭错误未上抛: %v", err)
	}
	text := logs.String()
	if !strings.Contains(text, "close_upstream_response") || strings.Contains(text, "private-upstream-response") {
		t.Fatalf("上游关闭日志不安全: %s", text)
	}
}
