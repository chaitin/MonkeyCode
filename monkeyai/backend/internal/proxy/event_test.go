package proxy

import (
	"fmt"
	"reflect"
	"testing"
)

func compareEvent(t testing.TB, data []byte) {
	t.Helper()
	event := readEvent(data)
	gotChat, chatErr := event.chat()
	wantChat, wantChatErr := parseChatCompletion(data)
	gotResponse, responseErr := event.responses()
	wantResponse, wantResponseErr := parseOpenAIResponseEvent(data)
	gotAnthropic, anthropicErr := event.anthropic()
	wantAnthropic, wantAnthropicErr := parseAnthropicResponse(data)
	for _, pair := range []struct {
		got, want        any
		err, expectedErr error
	}{
		{gotChat, wantChat, chatErr, wantChatErr},
		{gotResponse, wantResponse, responseErr, wantResponseErr},
		{gotAnthropic, wantAnthropic, anthropicErr, wantAnthropicErr},
	} {
		if !reflect.DeepEqual(pair.got, pair.want) || fmt.Sprintf("%T:%v", pair.err, pair.err) != fmt.Sprintf("%T:%v", pair.expectedErr, pair.expectedErr) {
			t.Fatalf("事件解析不兼容: data=%q got=%+v err=%T:%v want=%+v err=%T:%v", data, pair.got, pair.err, pair.err, pair.want, pair.expectedErr, pair.expectedErr)
		}
	}
	for _, route := range []struct {
		path, kind string
	}{
		{"/v1/chat/completions", ""}, {"/v1/chat/completions", "message"},
		{"/v1/responses", "response.output_text.delta"},
		{"/v1/responses", "response.function_call_arguments.delta"},
		{"/v1/messages", "content_block_delta"},
	} {
		chunk := sseEvent{Type: route.kind, Data: data}
		if got, want := event.firstOutput(route.path, chunk), firstOutputEvent(route.path, chunk); got != want {
			t.Fatalf("首 token 判断不兼容: path=%s data=%q got=%t want=%t", route.path, data, got, want)
		}
	}
}

func TestSharedEventCompatibility(t *testing.T) {
	for _, data := range []string{
		`{}`, `null`, `[]`, `{"id":"call","usage":{"prompt_tokens":0,"completion_tokens":2}}`,
		`{"id":42,"usage":{"prompt_tokens":1}}`,
		`{"ID":"first","id":"last","Usage":{"prompt_tokens":1},"usage":{"completion_tokens":2}}`,
		`{"usage":{"prompt_tokens":1},"usage":{"completion_tokens":2}}`,
		`{"usage":{"prompt_tokens":"invalid"},"usage":{"prompt_tokens":2}}`,
		`{"choices":[{"delta":{"content":"hello","tool_calls":[{"function":{"arguments":"{}"}}]}}]}`,
		`{"Choices":[{"Delta":{"Content":"hello"}}]}`,
		`{"choices":[{"delta":{"content":"hello"}}],"choices":null}`,
		`{"choices":[{"delta":{"content":"hello"}},{"delta":{"content":42}}]}`,
		`{"delta":"hello","delta":null}`, `{"Delta":{"Text":"hello"}}`,
		`{"delta":{"text":"hello","thinking":42}}`,
		`{"response":{"id":"call","status":"completed","usage":{"input_tokens":0,"output_tokens":2}}}`,
		`{"Response":{"ID":"call","Usage":{"input_tokens":1,"output_tokens":2}}}`,
		`{"response":{"id":1}}`, `{"response":null}`,
		`{"message":{"id":"call","usage":{"input_tokens":2}},"usage":{"output_tokens":3}}`,
		`{"id":"first","id":null,"message":{"id":"call"},"message":{"status":"completed"}}`,
		`{"usage":{"input_tokens":9007199254740993,"output_tokens":1}}`,
		`{"usage":{"input_tokens":-1}}`, `{"id":"call","usage":{`, `{} {}`,
		`{"choices":[{"delta":{"content":"hello"}}]} trailing`,
	} {
		t.Run(data, func(t *testing.T) { compareEvent(t, []byte(data)) })
	}
}

func FuzzSharedEventCompatibility(f *testing.F) {
	for _, seed := range []string{`{}`, `{"id":"call","usage":{"prompt_tokens":0,"completion_tokens":2}}`, `{"choices":[{"delta":{"content":"hello"}}]}`, `{"delta":"hello","delta":null}`, `{"message":{"id":"call"}}`} {
		f.Add([]byte(seed))
	}
	f.Fuzz(func(t *testing.T, data []byte) { compareEvent(t, data) })
}

func TestMalformedEventPreservesVisibleEstimate(t *testing.T) {
	result := captureEstimate("/v1/chat/completions", true,
		`{"model":"custom","messages":[{"role":"user","content":"hi"}]}`,
		"data: {\"choices\":[{\"delta\":{\"content\":\"hello\"}}]} trailing\n\ndata: [DONE]\n\n")
	if result.Known || result.ErrorCode != "usage_parse_failed" || result.OutputTokens != 2 || result.OutputSource != "heuristic" {
		t.Fatalf("错误事件丢失了可见用量或被标为可信: %+v", result)
	}
}
