package proxy

import (
	"context"
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
	if nonStream.ResponseID != "msg_test" || nonStream.InputTokens != 7 || nonStream.OutputTokens != 5 || nonStream.CacheReadInputTokens != 3 || nonStream.totalTokens() != 15 {
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
	if stream.ResponseID != "msg_stream" || stream.InputTokens != 7 || stream.OutputTokens != 5 || stream.CacheReadInputTokens != 3 || stream.totalTokens() != 15 {
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
