package proxy

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"
)

func TestModelFailureObservedWithoutBillingOrRecorder(t *testing.T) {
	for _, test := range []struct {
		name, body string
		status     int
		stream     bool
		code       string
	}{
		{"非成功状态", `{"error":"private-upstream-message"}`, 503, false, "upstream_http_error"},
		{"SSE失败", "event: error\ndata: {\"error\":\"private-upstream-message\"}\n\n", 200, true, "upstream_error_event"},
		{"缺少结束事件", "data: {\"choices\":[{\"delta\":{\"content\":\"hello\"}}]}\n\n", 200, true, "stream_terminal_missing"},
	} {
		t.Run(test.name, func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(test.status)
				_, _ = io.WriteString(w, test.body)
			}))
			defer upstream.Close()
			var output bytes.Buffer
			logger := logging.New(&output, slog.LevelDebug)
			p := NewProxy(ResolverFunc(func(context.Context, string, string) (Target, error) {
				return Target{ModelID: "model-1", BaseURL: upstream.URL}, nil
			}), logger)
			body := `{"model":"test","messages":[],"stream":false}`
			if test.stream {
				body = `{"model":"test","messages":[],"stream":true}`
			}
			r := httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(body))
			r.Header.Set("Authorization", "Bearer private-key")
			response := httptest.NewRecorder()
			logging.HTTP(logger)(p).ServeHTTP(response, r)
			if err := p.Wait(t.Context()); err != nil {
				t.Fatal(err)
			}
			if response.Code != test.status || response.Body.String() != test.body {
				t.Fatalf("代理内容改变: %d %q", response.Code, response.Body.String())
			}
			decoder := json.NewDecoder(bytes.NewReader(output.Bytes()))
			count := 0
			for decoder.More() {
				var row map[string]any
				if err := decoder.Decode(&row); err != nil {
					t.Fatal(err)
				}
				if row["event"] == "model.call.completed" {
					count++
					if row["result"] != "failed" || row["error_code"] != test.code || row["upstream_status"] != float64(test.status) {
						t.Fatalf("业务失败丢失: %v", row)
					}
				}
			}
			if count != 1 || strings.Contains(output.String(), "private-") {
				t.Fatalf("完成事件重复、缺失或泄漏: %s", output.String())
			}
		})
	}
}

func TestStreamBusinessFailureSurvivesKnownUsage(t *testing.T) {
	var logs bytes.Buffer
	p := NewProxy(nil, logging.New(&logs, slog.LevelDebug))
	pc := &proxyContext{target: Target{ModelID: "m1"}, stream: true}
	capture := &usageCapture{logger: p.logger, ctx: usageCaptureContext{ctx: t.Context(), proxyCtx: pc, proxy: p, stream: true, path: "/v1/responses"}, reader: io.NopCloser(strings.NewReader("event: response.failed\ndata: {\"response\":{\"id\":\"resp-1\",\"usage\":{\"input_tokens\":1,\"output_tokens\":1}}}\n\n"))}
	result := capture.handleStream()
	if !result.Known || result.FailureCode != "upstream_failed" || result.ObservedResult != "failed" {
		t.Fatalf("用量抹掉业务失败: %+v", result)
	}
	p.recordUsage(t.Context(), pc, result)
	if !strings.Contains(logs.String(), `"result":"failed"`) || !strings.Contains(logs.String(), `"usage_known":true`) {
		t.Fatal(logs.String())
	}
}

func TestResponseOutputLimitDiagnostics(t *testing.T) {
	for _, stream := range []bool{false, true} {
		for _, tc := range []struct {
			name, status, reason, code, level string
			known                             bool
		}{
			{"输出上限", "incomplete", "max_output_tokens", "output_limit_reached", "WARN", true},
			{"输出上限但缺少用量", "incomplete", "max_output_tokens", "output_limit_reached", "WARN", false},
			{"其他未完成原因", "incomplete", "unknown", "upstream_failed", "ERROR", true},
			{"明确失败不能降级", "failed", "max_output_tokens", "upstream_failed", "ERROR", true},
		} {
			t.Run(fmt.Sprintf("%s/stream=%t", tc.name, stream), func(t *testing.T) {
				usage := ""
				if tc.known {
					usage = `,"usage":{"input_tokens":3,"output_tokens":2}`
				}
				body := fmt.Sprintf(`{"id":"resp-limit","status":%q,"incomplete_details":{"reason":%q}%s}`, tc.status, tc.reason, usage)
				if stream {
					body = fmt.Sprintf("event: response.%s\ndata: {\"response\":%s}\n\n", tc.status, body)
				}
				upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					_, _ = io.WriteString(w, body)
				}))
				t.Cleanup(upstream.Close)
				var logs bytes.Buffer
				billing := estimateBilling{calls: make(chan Call, 1)}
				p := NewProxy(ResolverFunc(func(context.Context, string, string) (Target, error) {
					return Target{BaseURL: upstream.URL}, nil
				}), logging.New(&logs, slog.LevelDebug)).WithBilling(billing)
				r := httptest.NewRequest(http.MethodPost, "/v1/responses", strings.NewReader(fmt.Sprintf(`{"model":"test","stream":%t}`, stream)))
				r.Header.Set("Authorization", "Bearer test")
				w := httptest.NewRecorder()
				p.ServeHTTP(w, r)
				if err := p.Wait(t.Context()); err != nil {
					t.Fatal(err)
				}
				if w.Code != http.StatusOK || w.Body.String() != body {
					t.Fatalf("代理改变了上游响应: %d %s", w.Code, w.Body.String())
				}
				select {
				case call := <-billing.calls:
					if call.Known != tc.known || call.Result != "failed" || (tc.known && (call.InputTokens != 3 || call.OutputTokens != 2)) {
						t.Fatalf("终止状态或计费用量改变: %+v", call)
					}
				default:
					t.Fatal("未提交计费用量")
				}
				decoder := json.NewDecoder(&logs)
				count := 0
				for decoder.More() {
					var event map[string]any
					if err := decoder.Decode(&event); err != nil {
						t.Fatal(err)
					}
					if event["event"] == "model.call.completed" {
						count++
						if event["level"] != tc.level || event["error_code"] != tc.code || event["incomplete_reason"] != tc.reason || event["result"] != "failed" {
							t.Fatalf("终止原因分类错误: %v", event)
						}
					}
				}
				if count != 1 {
					t.Fatalf("完成事件数量错误: %d", count)
				}
			})
		}
	}
}
