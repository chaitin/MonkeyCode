package llmproxy

import (
	"context"
	"io"
	"log/slog"
	"strings"
	"testing"
)

func newUsageCaptureForTest(path string, stream bool, body string) *UsageCapture {
	pr, pw := io.Pipe()
	b := &UsageCapture{
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		ctx: &UsageCaptureContext{
			ctx:    context.Background(),
			path:   path,
			stream: stream,
		},
		pr: pr,
		pw: pw,
	}
	go func() {
		_, _ = io.Copy(pw, strings.NewReader(body))
		_ = pw.Close()
	}()
	return b
}

func TestUsageCaptureParsesOpenAIResponsesUsage(t *testing.T) {
	b := newUsageCaptureForTest("/v1/responses", false, `{
		"type":"response.completed",
		"response":{
			"id":"resp_test",
			"usage":{
				"input_tokens":100,
				"output_tokens":20,
				"total_tokens":120,
				"input_tokens_details":{"cached_tokens":30}
			}
		}
	}`)

	result := b.handleNonStream()

	if result.ResponseID != "resp_test" || result.InputTokens != 100 || result.OutputTokens != 20 || result.CachedTokens != 30 || result.totalTokens() != 120 {
		t.Fatalf("result = %+v", result)
	}
}

func TestUsageCaptureParsesOpenAIResponsesStreamUsage(t *testing.T) {
	b := newUsageCaptureForTest("/v1/responses", true, strings.Join([]string{
		"event: response.output_text.delta",
		`data: {"delta":"hello"}`,
		"",
		"event: response.completed",
		`data: {"type":"response.completed","response":{"id":"resp_stream","usage":{"input_tokens":8,"output_tokens":3,"total_tokens":11}}}`,
		"",
	}, "\n"))

	result := b.handleStream()

	if result.ResponseID != "resp_stream" || result.InputTokens != 8 || result.OutputTokens != 3 || result.totalTokens() != 11 {
		t.Fatalf("result = %+v", result)
	}
}

func TestUsageCaptureParsesOpenAIChatCompletionStreamUsage(t *testing.T) {
	b := newUsageCaptureForTest("/v1/chat/completions", true, strings.Join([]string{
		`data: {"choices":[{"delta":{"content":"hi"}}]}`,
		"",
		`data: {"id":"chat_stream","usage":{"prompt_tokens":4,"completion_tokens":6,"total_tokens":10,"prompt_tokens_details":{"cached_tokens":2}}}`,
		"",
		"data: [DONE]",
		"",
	}, "\n"))

	result := b.handleStream()

	if result.ResponseID != "chat_stream" || result.InputTokens != 4 || result.OutputTokens != 6 || result.CachedTokens != 2 || result.totalTokens() != 10 {
		t.Fatalf("result = %+v", result)
	}
}

func TestUsageCaptureParsesAnthropicUsageIncludesCacheReadTokens(t *testing.T) {
	b := newUsageCaptureForTest("/v1/messages", false, `{
		"id":"msg_test",
		"usage":{
			"input_tokens":7,
			"output_tokens":5,
			"cache_read_input_tokens":3,
			"cache_creation_input_tokens":2
		}
	}`)

	result := b.handleNonStream()

	if result.ResponseID != "msg_test" || result.InputTokens != 7 || result.OutputTokens != 5 || result.CacheReadInputTokens != 3 || result.totalTokens() != 15 {
		t.Fatalf("result = %+v", result)
	}
}

func TestUsageCaptureParsesAnthropicStreamUsage(t *testing.T) {
	b := newUsageCaptureForTest("/v1/messages", true, strings.Join([]string{
		"event: message_start",
		`data: {"type":"message_start","message":{"id":"msg_stream","usage":{"input_tokens":7,"cache_read_input_tokens":3,"cache_creation_input_tokens":2}}}`,
		"",
		"event: message_delta",
		`data: {"type":"message_delta","usage":{"output_tokens":5}}`,
		"",
	}, "\n"))

	result := b.handleStream()

	if result.ResponseID != "msg_stream" || result.InputTokens != 7 || result.OutputTokens != 5 || result.CacheReadInputTokens != 3 || result.totalTokens() != 15 {
		t.Fatalf("result = %+v", result)
	}
}

func TestUsageCaptureReadCopiesResponseToShadowPipe(t *testing.T) {
	var result usageResult
	pr, pw := io.Pipe()
	b := &UsageCapture{
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		src: io.NopCloser(strings.NewReader(`{
			"id":"chat_test",
			"usage":{"prompt_tokens":4,"completion_tokens":6}
		}`)),
		ctx: &UsageCaptureContext{
			ctx:    context.Background(),
			path:   "/v1/chat/completions",
			stream: false,
		},
		pr: pr,
		pw: pw,
	}
	done := make(chan struct{})
	go func() {
		result = b.handleNonStream()
		close(done)
	}()

	data, err := io.ReadAll(b)
	if err != nil {
		t.Fatal(err)
	}
	<-done

	if !strings.Contains(string(data), "chat_test") {
		t.Fatalf("body = %q", data)
	}
	if result.ResponseID != "chat_test" || result.InputTokens != 4 || result.OutputTokens != 6 {
		t.Fatalf("result = %+v", result)
	}
}
