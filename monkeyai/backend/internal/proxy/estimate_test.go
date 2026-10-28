package proxy

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func captureEstimate(path string, stream bool, request, response string) usageResult {
	capture := newUsageCaptureForTest(path, stream, response)
	capture.ctx.proxyCtx = &proxyContext{requestBody: []byte(request)}
	if stream {
		return capture.handleStream()
	}
	return capture.handleNonStream()
}

func TestEstimatedNonStreamUsage(t *testing.T) {
	const chatRequest = `{"model":"gpt-5","messages":[{"role":"user","content":"hello world"}]}`
	for _, tc := range []struct {
		name, path, request, response string
		input, output, cached         uint64
		inputSource, outputSource     string
	}{
		{"Chat缺少usage", "/v1/chat/completions", chatRequest, `{"id":"chat","choices":[{"message":{"role":"assistant","content":"hello world"}}]}`, 9, 2, 0, "tokenizer:o200k_base", "tokenizer:o200k_base"},
		{"Chat空usage", "/v1/chat/completions", chatRequest, `{"id":"chat","usage":{},"choices":[{"message":{"content":"hello world"}}]}`, 9, 2, 0, "tokenizer:o200k_base", "tokenizer:o200k_base"},
		{"只补输出且保留零输入", "/v1/chat/completions", chatRequest, `{"id":"chat","usage":{"prompt_tokens":0},"choices":[{"message":{"content":"hello world"}}]}`, 0, 2, 0, "", "tokenizer:o200k_base"},
		{"只补输入且保留零输出", "/v1/chat/completions", chatRequest, `{"id":"chat","usage":{"completion_tokens":0},"choices":[{"message":{"content":""}}]}`, 9, 0, 0, "tokenizer:o200k_base", ""},
		{"可信零用量", "/v1/chat/completions", chatRequest, `{"id":"chat","usage":{"prompt_tokens":0,"completion_tokens":0},"choices":[{"message":{"content":"hello world"}}]}`, 0, 0, 0, "", ""},
		{"保留上游缓存", "/v1/chat/completions", chatRequest, `{"id":"chat","usage":{"prompt_tokens":100,"prompt_tokens_details":{"cached_tokens":30}},"choices":[{"message":{"content":"hello world"}}]}`, 100, 2, 30, "", "tokenizer:o200k_base"},
		{"缓存是估算输入下限", "/v1/chat/completions", chatRequest, `{"id":"chat","usage":{"completion_tokens":2,"prompt_tokens_details":{"cached_tokens":30}},"choices":[{"message":{"content":"hello world"}}]}`, 30, 2, 30, "tokenizer:o200k_base", ""},
		{"未知模型中英文估算", "/v1/chat/completions", `{"model":"custom","messages":[{"role":"user","content":"hello world"}]}`, `{"choices":[{"message":{"content":"你好，world"}}]}`, 10, 5, 0, "heuristic", "heuristic"},
		{"旧OpenAI分词器", "/v1/chat/completions", `{"model":"gpt-4-turbo","messages":[{"role":"user","content":"hello world"}]}`, `{"choices":[{"message":{"content":"hello world"}}]}`, 9, 2, 0, "tokenizer:cl100k_base", "tokenizer:cl100k_base"},
		{"Responses", "/v1/responses", `{"model":"gpt-5","input":"hello world"}`, `{"id":"resp","status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"hello world"}]}]}`, 5, 2, 0, "tokenizer:o200k_base", "tokenizer:o200k_base"},
		{"Messages", "/v1/messages", `{"model":"claude-sonnet","messages":[{"role":"user","content":"hello world"}]}`, `{"id":"msg","content":[{"type":"text","text":"hello world"}]}`, 10, 3, 0, "heuristic", "heuristic"},
		{"Messages保留缓存分项", "/v1/messages", `{"model":"claude-sonnet","messages":[{"role":"user","content":"hello world"}]}`, `{"id":"msg","usage":{"input_tokens":7,"cache_read_input_tokens":3,"cache_creation_input_tokens":2},"content":[{"type":"text","text":"hello world"}]}`, 12, 3, 3, "", "heuristic"},
		{"Messages估算输入不重复加缓存", "/v1/messages", `{"model":"claude-sonnet","messages":[{"role":"user","content":"hello world"}]}`, `{"id":"msg","usage":{"output_tokens":3,"cache_read_input_tokens":3,"cache_creation_input_tokens":2},"content":[{"type":"text","text":"hello world"}]}`, 10, 3, 3, "heuristic", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := captureEstimate(tc.path, false, tc.request, tc.response)
			input, cached := got.InputTokens+got.CacheReadInputTokens+got.CacheCreationInputTokens, got.CachedTokens+got.CacheReadInputTokens
			if !got.Known || got.ErrorCode != "" || input != tc.input || got.OutputTokens != tc.output || cached != tc.cached || got.InputSource != tc.inputSource || got.OutputSource != tc.outputSource {
				t.Fatalf("补算用量错误: %+v，输入总量=%d，缓存=%d", got, input, cached)
			}
		})
	}
}

func TestEstimatedStreamMatchesNonStream(t *testing.T) {
	for _, tc := range []struct {
		name, path, request, response, stream string
	}{
		{
			name: "Chat正文与思考分片", path: "/v1/chat/completions",
			request:  `{"model":"gpt-5","messages":[{"role":"user","content":"hi"}]}`,
			response: `{"choices":[{"message":{"content":"hello world","reasoning_content":"think"}}]}`,
			stream: "data: {\"id\":\"chat_stream\",\"choices\":[{\"index\":0,\"delta\":{\"reasoning_content\":\"thi\",\"content\":\"hel\"}}]}\n\n" +
				"data: {\"choices\":[{\"index\":0,\"delta\":{\"reasoning_content\":\"nk\",\"content\":\"lo world\"}}]}\n\ndata: [DONE]\n\n",
		},
		{
			name: "Chat多个工具交错分片", path: "/v1/chat/completions",
			request:  `{"model":"gpt-5","messages":[{"role":"user","content":"hi"}]}`,
			response: `{"choices":[{"message":{"tool_calls":[{"function":{"name":"search","arguments":"{\"city\":\"北京\"}"}},{"function":{"name":"read","arguments":"{\"path\":\"a.go\"}"}}]}}]}`,
			stream: "data: {\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"name\":\"search\",\"arguments\":\"{\\\"city\\\":\"}},{\"index\":1,\"function\":{\"name\":\"read\",\"arguments\":\"{\\\"path\\\":\"}}]}}]}\n\n" +
				"data: {\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":1,\"function\":{\"arguments\":\"\\\"a.go\\\"}\"}},{\"index\":0,\"function\":{\"arguments\":\"\\\"北京\\\"}\"}}]}}]}\n\ndata: [DONE]\n\n",
		},
		{
			name: "Responses去除快照重复", path: "/v1/responses",
			request:  `{"model":"gpt-5","input":"hi"}`,
			response: `{"status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"hello world"}]}]}`,
			stream: "event: response.output_text.delta\ndata: {\"output_index\":0,\"content_index\":0,\"delta\":\"hel\"}\n\n" +
				"event: response.output_text.delta\ndata: {\"output_index\":0,\"content_index\":0,\"delta\":\"lo world\"}\n\n" +
				"event: response.output_item.done\ndata: {\"output_index\":0,\"item\":{\"type\":\"message\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"hello world\"}]}}\n\n" +
				"event: response.completed\ndata: {\"response\":{\"id\":\"resp_stream\",\"status\":\"completed\",\"output\":[{\"type\":\"message\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"hello world\"}]}]}}\n\n",
		},
		{
			name: "Responses工具参数分片", path: "/v1/responses",
			request:  `{"model":"gpt-5","input":"hi"}`,
			response: `{"status":"completed","output":[{"type":"function_call","name":"search","arguments":"{\"city\":\"北京\"}"}]}`,
			stream: "event: response.output_item.added\ndata: {\"output_index\":0,\"item\":{\"type\":\"function_call\",\"name\":\"search\"}}\n\n" +
				"event: response.function_call_arguments.delta\ndata: {\"output_index\":0,\"delta\":\"{\\\"city\\\":\"}\n\n" +
				"event: response.function_call_arguments.delta\ndata: {\"output_index\":0,\"delta\":\"\\\"北京\\\"}\"}\n\n" +
				"event: response.completed\ndata: {\"response\":{\"id\":\"resp_stream\",\"status\":\"completed\"}}\n\n",
		},
		{
			name: "Messages工具参数替换初始空对象", path: "/v1/messages",
			request:  `{"model":"claude","messages":[{"role":"user","content":"hi"}]}`,
			response: `{"content":[{"type":"tool_use","name":"search","input":{"city":"北京"}}]}`,
			stream: "event: message_start\ndata: {\"message\":{\"id\":\"msg_stream\",\"content\":[]}}\n\n" +
				"event: content_block_start\ndata: {\"index\":0,\"content_block\":{\"type\":\"tool_use\",\"name\":\"search\",\"input\":{}}}\n\n" +
				"event: content_block_delta\ndata: {\"index\":0,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"city\\\":\"}}\n\n" +
				"event: content_block_delta\ndata: {\"index\":0,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"\\\"北京\\\"}\"}}\n\n" +
				"event: message_stop\ndata: {}\n\n",
		},
		{
			name: "Messages正文与思考", path: "/v1/messages",
			request:  `{"model":"claude","messages":[{"role":"user","content":"hi"}]}`,
			response: `{"content":[{"type":"thinking","thinking":"think"},{"type":"text","text":"hello world"}]}`,
			stream: "event: content_block_start\ndata: {\"index\":0,\"content_block\":{\"type\":\"thinking\",\"thinking\":\"\"}}\n\n" +
				"event: content_block_delta\ndata: {\"index\":0,\"delta\":{\"thinking\":\"think\"}}\n\n" +
				"event: content_block_start\ndata: {\"index\":1,\"content_block\":{\"type\":\"text\",\"text\":\"hel\"}}\n\n" +
				"event: content_block_delta\ndata: {\"index\":1,\"delta\":{\"text\":\"lo world\"}}\n\n" +
				"event: message_stop\ndata: {}\n\n",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			want := captureEstimate(tc.path, false, tc.request, tc.response)
			got := captureEstimate(tc.path, true, tc.request, tc.stream)
			if !want.Known || !got.Known || got.InputTokens != want.InputTokens || got.OutputTokens != want.OutputTokens || got.OutputTokens == 0 || got.InputSource != want.InputSource || got.OutputSource != want.OutputSource {
				t.Fatalf("流式与完整响应计量不一致: 流式=%+v，完整=%+v", got, want)
			}
		})
	}
}

func TestEstimatePreservesUnknownUsage(t *testing.T) {
	for _, tc := range []struct {
		name, path, request, response string
		stream                        bool
	}{
		{"流缺少结束事件", "/v1/chat/completions", `{"model":"gpt-5","messages":[{"role":"user","content":"hi"}]}`, "data: {\"id\":\"partial\",\"choices\":[{\"delta\":{\"content\":\"hello\"}}]}\n\n", true},
		{"引用上游历史", "/v1/responses", `{"model":"gpt-5","input":"hi","previous_response_id":"old"}`, `{"output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"hello"}]}]}`, false},
		{"图片输入", "/v1/chat/completions", `{"model":"gpt-5","messages":[{"role":"user","content":[{"type":"text","text":"hi"},{"type":"image_url","image_url":{"url":"data:image/png;base64,abcdef"}}]}]}`, `{"choices":[{"message":{"content":"hello"}}]}`, false},
		{"上游生成失败", "/v1/responses", `{"model":"gpt-5","input":"hi"}`, "event: response.output_text.delta\ndata: {\"delta\":\"hello\"}\n\nevent: response.failed\ndata: {\"response\":{\"id\":\"partial\",\"status\":\"failed\"}}\n\n", true},
		{"没有输出证据", "/v1/chat/completions", `{"model":"gpt-5","messages":[{"role":"user","content":"hi"}]}`, `{"id":"missing","usage":{}}`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := captureEstimate(tc.path, tc.stream, tc.request, tc.response)
			if got.Known || got.ErrorCode == "" || got.InputSource == "" {
				t.Fatalf("不可完整计量的用量应保留未知状态: %+v", got)
			}
			if tc.name != "没有输出证据" && got.OutputTokens == 0 {
				t.Fatalf("未保留可见输出的估算用量: %+v", got)
			}
		})
	}
}

func TestEstimateKeepsPartialUsageAfterReadError(t *testing.T) {
	reader, writer := io.Pipe()
	defer reader.Close()
	capture := &usageCapture{
		logger: discardLogger(), reader: reader, writer: writer,
		ctx: usageCaptureContext{
			ctx: t.Context(), path: "/v1/chat/completions", stream: true,
			proxyCtx: &proxyContext{requestBody: []byte(`{"model":"gpt-5","messages":[{"role":"user","content":"hello world"}]}`)},
		},
	}
	go func() {
		_, _ = io.WriteString(writer, "data: {\"id\":\"interrupted\",\"choices\":[{\"delta\":{\"content\":\"hello world\"}}]}\n\n")
		_ = writer.CloseWithError(io.ErrUnexpectedEOF)
	}()
	got := capture.handleStream()
	if got.Known || got.Result != "failed" || got.ErrorCode != "stream_interrupted" || got.InputTokens != 9 || got.OutputTokens != 2 || got.ResponseID != "interrupted" {
		t.Fatalf("断流后应保留估算值与失败证据: %+v", got)
	}
}

func TestEstimateCountsRequestContext(t *testing.T) {
	const response = `{"choices":[{"message":{"content":"hello"}}]}`
	requests := []string{
		`{"model":"gpt-5","messages":[{"role":"user","content":"hi"}]}`,
		`{"model":"gpt-5","messages":[{"role":"system","content":"You are a helpful assistant"},{"role":"user","content":"hi"}]}`,
		`{"model":"gpt-5","messages":[{"role":"system","content":"You are a helpful assistant"},{"role":"user","content":"hi"},{"role":"assistant","tool_calls":[{"function":{"name":"read","arguments":"{\"path\":\"a.go\"}"}}]},{"role":"tool","content":"package main"}],"tools":[{"type":"function","function":{"name":"read","parameters":{"type":"object","properties":{"path":{"type":"string"}}}}}]}`,
	}
	var previous uint64
	for _, request := range requests {
		got := captureEstimate("/v1/chat/completions", false, request, response)
		if !got.Known || got.InputTokens <= previous {
			t.Fatalf("未计算系统提示、历史或工具定义: %+v", got)
		}
		previous = got.InputTokens
	}
	withMetadata := strings.TrimSuffix(requests[0], "}") + `,"max_tokens":900000,"temperature":0.99,"metadata":{"trace":"` + strings.Repeat("x", 1000) + `"}}`
	base := captureEstimate("/v1/chat/completions", false, requests[0], response)
	got := captureEstimate("/v1/chat/completions", false, withMetadata, response)
	if got.InputTokens != base.InputTokens {
		t.Fatalf("不应将传输参数计入输入: %+v，原用量=%+v", got, base)
	}
}

func TestEstimateUsesUpstreamModelAndPreservesNumber(t *testing.T) {
	e := newTokenEstimate(&proxyContext{
		target:      Target{UpstreamModel: "gpt-5"},
		requestBody: []byte(`{"model":"resource-uuid","input":[{"type":"function_call_output","output":"hello"}],"tools":[{"input_schema":{"maximum":9007199254740993}}]}`),
	})
	if e.source != "tokenizer:o200k_base" {
		t.Fatalf("应按实际上游模型选择分词器: %s", e.source)
	}
	input, supported := e.input()
	if !supported || input == 0 {
		t.Fatalf("工具结果应支持本地计量: %d, %t", input, supported)
	}
	object, err := estimateObject([]byte(`{"n":9007199254740993}`))
	if err != nil || fmt.Sprint(object["n"]) != "9007199254740993" {
		t.Fatalf("估算解析损失数字精度: %v, %v", object, err)
	}
}

type estimateBilling struct{ calls chan Call }

func (b estimateBilling) Begin(context.Context, Target, BillingRequest) (Reservation, error) {
	return Reservation{ID: "estimate-transaction"}, nil
}
func (b estimateBilling) Start(context.Context, string) error { return nil }
func (b estimateBilling) Finish(_ context.Context, _ string, call Call) error {
	b.calls <- call
	return nil
}

func TestProxyFinishesEstimatedUsage(t *testing.T) {
	const response = `{"id":"estimated-call","choices":[{"message":{"content":"hello world"}}]}`
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, response)
	}))
	t.Cleanup(upstream.Close)
	billing := estimateBilling{calls: make(chan Call, 2)}
	p := NewProxy(ResolverFunc(func(context.Context, string, string) (Target, error) {
		return Target{ModelID: "resource-id", UpstreamModel: "gpt-5", BaseURL: upstream.URL}, nil
	}), discardLogger()).WithBilling(billing)
	r := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"resource-id","messages":[{"role":"user","content":"hello world"}]}`))
	r.Header.Set("Authorization", "Bearer token")
	w := httptest.NewRecorder()
	p.ServeHTTP(w, r)
	ctx, cancel := context.WithTimeout(t.Context(), time.Second)
	defer cancel()
	if err := p.Wait(ctx); err != nil {
		t.Fatal(err)
	}
	if w.Code != 200 || w.Body.String() != response {
		t.Fatalf("用量补算不应改变代理响应: %d %s", w.Code, w.Body.String())
	}
	select {
	case call := <-billing.calls:
		if !call.Known || call.InputTokens != 9 || call.OutputTokens != 2 || call.InputSource != "tokenizer:o200k_base" || call.OutputSource != "tokenizer:o200k_base" || call.RequestID != "estimated-call" {
			t.Fatalf("估算值未交给计费结算: %+v", call)
		}
	default:
		t.Fatal("未结算估算用量")
	}
	select {
	case call := <-billing.calls:
		t.Fatalf("估算用量重复结算: %+v", call)
	default:
	}
}
