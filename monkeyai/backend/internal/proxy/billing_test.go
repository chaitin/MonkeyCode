package proxy

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type billingMustNotRun struct{}

func (billingMustNotRun) Begin(context.Context, Target, BillingRequest) (Reservation, error) {
	panic("自配模型不应预留积分")
}
func (billingMustNotRun) Start(context.Context, string) error {
	panic("自配模型不应启动计费")
}
func (billingMustNotRun) Finish(context.Context, string, Call) error {
	panic("自配模型不应结算")
}

func TestUserModelBypassesBillingAndRecordsUsage(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		if !strings.Contains(string(body), `"n":2`) {
			t.Errorf("自配模型请求被计费代理修改: %s", body)
		}
		_, _ = io.WriteString(w, `{"id":"own_request","usage":{"prompt_tokens":11,"completion_tokens":7}}`)
	}))
	t.Cleanup(upstream.Close)
	recorder := &usageRecorderStub{calls: make(chan Call, 1)}
	p := NewProxy(ResolverFunc(func(context.Context, string, string) (Target, error) {
		target := testTarget(upstream.URL + "/v1")
		target.OwnershipType = "user"
		return target, nil
	}), discardLogger()).WithBilling(billingMustNotRun{}).WithUsageRecorder(recorder)
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"gpt-5","n":2}`))
	req.Header.Set("Authorization", "Bearer own-key")
	w := httptest.NewRecorder()
	p.ServeHTTP(w, req)
	if w.Code != http.StatusOK || w.Header().Get("X-Billing-Transaction-ID") != "" {
		t.Fatalf("自配模型响应错误: %d %s", w.Code, w.Body.String())
	}
	select {
	case call := <-recorder.calls:
		if call.ModelID != "model-1" || call.InputTokens != 11 || call.OutputTokens != 7 || call.Result != "succeeded" {
			t.Fatalf("自配模型用量未记录: %+v", call)
		}
	case <-time.After(time.Second):
		t.Fatal("自配模型用量未记录")
	}
	p.captures.Wait()
	select {
	case <-recorder.calls:
		t.Fatal("自配模型用量重复记录")
	default:
	}
}

func TestUserModelRecordsFailedCallWithoutBilling(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	t.Cleanup(upstream.Close)
	recorder := &usageRecorderStub{calls: make(chan Call, 1)}
	p := NewProxy(ResolverFunc(func(context.Context, string, string) (Target, error) {
		target := testTarget(upstream.URL + "/v1")
		target.OwnershipType = "user"
		return target, nil
	}), discardLogger()).WithBilling(billingMustNotRun{}).WithUsageRecorder(recorder)
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"gpt-5"}`))
	req.Header.Set("Authorization", "Bearer own-key")
	w := httptest.NewRecorder()
	p.ServeHTTP(w, req)
	if w.Code != http.StatusBadGateway {
		t.Fatalf("上游错误响应丢失: %d", w.Code)
	}
	select {
	case call := <-recorder.calls:
		if call.Result != "failed" || call.ErrorCode != "upstream_http_error" || call.InputTokens != 0 {
			t.Fatalf("自配模型失败记录不正确: %+v", call)
		}
	case <-time.After(time.Second):
		t.Fatal("未记录自配模型失败")
	}
}

func TestUserModelStreamPreservesRequest(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		if string(body) != `{"model":"gpt-5","stream":true,"max_tokens":4096}` {
			t.Errorf("自配模型流式请求被修改: %s", body)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: {\"id\":\"own_stream\",\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":2}}\n\ndata: [DONE]\n\n")
	}))
	t.Cleanup(upstream.Close)
	recorder := &usageRecorderStub{calls: make(chan Call, 1)}
	p := NewProxy(ResolverFunc(func(context.Context, string, string) (Target, error) {
		target := testTarget(upstream.URL + "/v1")
		target.OwnershipType = "user"
		return target, nil
	}), discardLogger()).WithBilling(billingMustNotRun{}).WithUsageRecorder(recorder)
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"gpt-5","stream":true,"max_tokens":4096}`))
	req.Header.Set("Authorization", "Bearer own-key")
	w := httptest.NewRecorder()
	p.ServeHTTP(w, req)
	p.captures.Wait()
	if w.Code != http.StatusOK {
		t.Fatalf("流式代理失败: %d", w.Code)
	}
	select {
	case call := <-recorder.calls:
		if call.InputTokens != 3 || call.OutputTokens != 2 {
			t.Fatalf("流式用量未记录: %+v", call)
		}
	default:
		t.Fatal("流式用量未记录")
	}
}

func TestProxyPreservesOutputParameters(t *testing.T) {
	for _, path := range []string{"/v1/chat/completions", "/v1/responses", "/v1/messages"} {
		for _, stream := range []bool{false, true} {
			for _, params := range []string{"", `,"max_tokens":99999`, `,"max_completion_tokens":99999`, `,"max_output_tokens":99999`, `,"max_tokens":12000,"max_completion_tokens":99999`} {
				t.Run(fmt.Sprintf("%s/stream=%t/%s", path, stream, params), func(t *testing.T) {
					body := fmt.Sprintf(`{"model":"test","stream":%t%s}`, stream, params)
					upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						var want, got map[string]json.RawMessage
						if err := json.Unmarshal([]byte(body), &want); err != nil {
							t.Error(err)
							return
						}
						if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
							t.Error(err)
							return
						}
						for _, key := range []string{"max_tokens", "max_completion_tokens", "max_output_tokens"} {
							if string(got[key]) != string(want[key]) {
								t.Errorf("代理修改了 %s: got=%s want=%s", key, got[key], want[key])
							}
						}
						if _, ok := got["stream_options"]; ok {
							t.Error("代理不应补充流式参数")
						}
						w.WriteHeader(http.StatusBadRequest)
						_, _ = io.WriteString(w, `{"error":{"type":"invalid_request_error"}}`)
					}))
					t.Cleanup(upstream.Close)
					p := NewProxy(ResolverFunc(func(context.Context, string, string) (Target, error) {
						return Target{BaseURL: upstream.URL}, nil
					}), discardLogger()).WithBilling(estimateBilling{calls: make(chan Call, 1)})
					r := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
					r.Header.Set("Authorization", "Bearer test")
					w := httptest.NewRecorder()
					p.ServeHTTP(w, r)
					if w.Code != http.StatusBadRequest || w.Body.String() != `{"error":{"type":"invalid_request_error"}}` {
						t.Fatalf("上游响应被修改: %d %s", w.Code, w.Body.String())
					}
				})
			}
		}
	}
}

func TestStreamUsageCompleteness(t *testing.T) {
	for _, tc := range []struct {
		name, path, body string
		known            bool
		result           string
	}{
		{"缺失用量的结束事件", "/v1/messages", "event: message_stop\ndata: {}\n\n", false, ""},
		{"只有输入的中断", "/v1/messages", "event: message_start\ndata: {\"message\":{\"usage\":{\"input_tokens\":12}}}\n\nevent: message_stop\ndata: {}\n\n", false, ""},
		{"可信零用量", "/v1/messages", "event: message_start\ndata: {\"message\":{\"usage\":{\"input_tokens\":0}}}\n\nevent: message_delta\ndata: {\"usage\":{\"output_tokens\":0}}\n\nevent: message_stop\ndata: {}\n\n", true, ""},
		{"不完整响应仍有计费事实", "/v1/responses", "event: response.incomplete\ndata: {\"response\":{\"id\":\"r\",\"usage\":{\"input_tokens\":5,\"output_tokens\":2}}}\n\n", true, "failed"},
		{"usage后还有空分片", "/v1/chat/completions", "data: {\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":2}}\n\ndata: {\"choices\":[]}\n\ndata: [DONE]\n\n", true, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := newUsageCaptureForTest(tc.path, true, tc.body).handleStream()
			if got.Known != tc.known || got.Result != tc.result {
				t.Fatalf("用量可信度不符: %+v", got)
			}
		})
	}
}

func TestIncompleteUsageIsNotFreeUsage(t *testing.T) {
	for _, path := range []string{"/v1/chat/completions", "/v1/responses", "/v1/messages"} {
		if got := newUsageCaptureForTest(path, false, `{"id":"r","usage":{}}`).handleNonStream(); got.Known {
			t.Fatalf("%s 空 usage 不代表零用量", path)
		}
	}
}

func TestResponsesStreamPreservesReconciliationEvidence(t *testing.T) {
	body := "event: response.created\ndata: {\"response\":{\"id\":\"resp_reconcile\",\"status\":\"in_progress\"}}\n\n" +
		"event: response.failed\ndata: {\"response\":{\"id\":\"resp_reconcile\",\"status\":\"failed\"}}\n\n"
	got := newUsageCaptureForTest("/v1/responses", true, body).handleStream()
	if got.Known || got.Result != "failed" || got.ResponseID != "resp_reconcile" {
		t.Fatalf("失败事件证据不完整: %+v", got)
	}
	if got.ErrorCode != "usage_missing" || got.TerminalEvent != "response.failed" {
		t.Fatalf("失败原因不准确: %+v", got)
	}
}

func TestResponsesStreamClassifiesUnknownUsage(t *testing.T) {
	tests := []struct {
		name string
		body string
		code string
	}{
		{
			name: "缺少终止事件",
			body: "event: response.created\ndata: {\"response\":{\"id\":\"resp_started\"}}\n\n",
			code: "usage_terminal_event_missing",
		},
		{
			name: "上游错误事件",
			body: "event: error\ndata: {\"type\":\"error\",\"message\":\"failed\"}\n\n",
			code: "upstream_error_event",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := newUsageCaptureForTest("/v1/responses", true, test.body).handleStream()
			if got.Known || got.ErrorCode != test.code {
				t.Fatalf("未知用量分类错误: %+v", got)
			}
		})
	}
}

type blockingBilling struct {
	done chan struct{}
}

func (b blockingBilling) Begin(context.Context, Target, BillingRequest) (Reservation, error) {
	return Reservation{ID: "blocking-transaction"}, nil
}
func (b blockingBilling) Start(context.Context, string) error { return nil }
func (b blockingBilling) Finish(ctx context.Context, _ string, _ Call) error {
	select {
	case <-b.done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func TestBillingSettlementDoesNotBlockResponse(t *testing.T) {
	for _, status := range []int{http.StatusOK, http.StatusBadRequest, http.StatusBadGateway} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			const body = `{"id":"mirror-call","usage":{"prompt_tokens":3,"completion_tokens":2}}`
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(status)
				_, _ = io.WriteString(w, body)
			}))
			t.Cleanup(upstream.Close)
			billing := blockingBilling{done: make(chan struct{})}
			t.Cleanup(func() { close(billing.done) })
			p := NewProxy(ResolverFunc(func(context.Context, string, string) (Target, error) {
				return Target{BaseURL: upstream.URL}, nil
			}), discardLogger()).WithBilling(billing)
			req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"test"}`))
			req.Header.Set("Authorization", "Bearer test")
			response := make(chan *httptest.ResponseRecorder, 1)
			go func() {
				w := httptest.NewRecorder()
				p.ServeHTTP(w, req)
				response <- w
			}()
			select {
			case w := <-response:
				if w.Code != status || w.Body.String() != body {
					t.Fatalf("镜像结算不应改变响应: %d %s", w.Code, w.Body.String())
				}
			case <-time.After(2 * time.Second):
				t.Fatal("响应被同步结算阻塞")
			}
			waitCtx, cancel := context.WithCancel(t.Context())
			cancel()
			if err := p.Wait(waitCtx); err == nil {
				t.Fatal("等待退出必须覆盖未完成的结算")
			}
			billing.done <- struct{}{}
			if err := p.Wait(t.Context()); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestBillingPreservesRequestBytes(t *testing.T) {
	for _, options := range []string{"", `, "stream_options": {"include_usage": false}`, `, "stream_options": null`} {
		t.Run(options, func(t *testing.T) {
			body := "{\n  \"model\": \"test\", \"stream\": true" + options + "\n}"
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				got, err := io.ReadAll(r.Body)
				if err != nil || string(got) != body {
					t.Errorf("计费改变了原始请求: %s %v", got, err)
				}
				_, _ = io.WriteString(w, "data: [DONE]\n\n")
			}))
			t.Cleanup(upstream.Close)
			p := NewProxy(ResolverFunc(func(context.Context, string, string) (Target, error) {
				return Target{BaseURL: upstream.URL}, nil
			}), discardLogger()).WithBilling(estimateBilling{calls: make(chan Call, 1)})
			r := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(body))
			r.Header.Set("Authorization", "Bearer test")
			w := httptest.NewRecorder()
			p.ServeHTTP(w, r)
			if err := p.Wait(t.Context()); err != nil {
				t.Fatal(err)
			}
			if w.Code != http.StatusOK || w.Body.String() != "data: [DONE]\n\n" {
				t.Fatalf("代理改变了响应: %d %s", w.Code, w.Body.String())
			}
		})
	}
}
