package proxy

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestStreamRecordsFirstOutputDuration(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"role\":\"assistant\"}}]}\n\n")
		_, _ = io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n\n")
		_, _ = io.WriteString(w, "data: {\"id\":\"stream-call\",\"choices\":[],\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":2}}\n\n")
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
	}))
	t.Cleanup(upstream.Close)
	recorder := &usageRecorderStub{calls: make(chan Call, 1)}
	p := NewProxy(ResolverFunc(func(context.Context, string, string) (Target, error) {
		return testTarget(upstream.URL + "/v1"), nil
	}), discardLogger()).WithUsageRecorder(recorder)
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"gpt-5","stream":true}`))
	req.Header.Set("Authorization", "Bearer runtime-secret")
	w := httptest.NewRecorder()
	p.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", w.Code, w.Body.String())
	}
	select {
	case call := <-recorder.calls:
		if call.FirstTokenDurationMs == nil || *call.FirstTokenDurationMs < 0 {
			t.Fatalf("未记录首个输出耗时: %+v", call)
		}
		if call.InputTokens != 10 || call.OutputTokens != 2 {
			t.Fatalf("模型调用统计不完整: %+v", call)
		}
	case <-time.After(time.Second):
		t.Fatal("未收到流式模型调用记录")
	}
}

func TestFirstOutputEvent(t *testing.T) {
	cases := []struct {
		name, path, eventType, data string
		want                        bool
	}{
		{"chat metadata", "/v1/chat/completions", "", `{"choices":[{"delta":{"role":"assistant"}}]}`, false},
		{"chat text", "/v1/chat/completions", "", `{"choices":[{"delta":{"content":"Hello"}}]}`, true},
		{"chat tool arguments", "/v1/chat/completions", "", `{"choices":[{"delta":{"tool_calls":[{"function":{"arguments":"{\"a\""}}]}}]}`, true},
		{"chat usage", "/v1/chat/completions", "done", `{"usage":{"completion_tokens":4}}`, false},
		{"responses setup", "/v1/responses", "response.created", `{"response":{"id":"r"}}`, false},
		{"responses delta", "/v1/responses", "response.output_text.delta", `{"delta":"Hi"}`, true},
		{"responses tool", "/v1/responses", "response.function_call_arguments.delta", `{"delta":"{"}`, true},
		{"anthropic setup", "/v1/messages", "message_start", `{"message":{"id":"a"}}`, false},
		{"anthropic delta", "/v1/messages", "content_block_delta", `{"delta":{"type":"text_delta","text":"Hi"}}`, true},
		{"anthropic thinking", "/v1/messages", "content_block_delta", `{"delta":{"type":"thinking_delta","thinking":"thinking"}}`, true},
		{"anthropic tool", "/v1/messages", "content_block_delta", `{"delta":{"type":"input_json_delta","partial_json":"{"}}`, true},
		{"invalid data", "/v1/responses", "response.output_text.delta", `{`, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := firstOutputEvent(tc.path, sseEvent{Type: tc.eventType, Data: []byte(tc.data)}); got != tc.want {
				t.Fatalf("firstOutputEvent(%s, %s) = %v, want %v", tc.path, tc.eventType, got, tc.want)
			}
		})
	}
}
