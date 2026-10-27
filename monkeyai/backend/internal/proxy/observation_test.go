package proxy

import (
	"bytes"
	"context"
	"encoding/json"
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
