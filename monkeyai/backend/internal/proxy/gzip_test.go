package proxy

import (
	"bytes"
	"compress/gzip"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestProxyBillsGzipUsage(t *testing.T) {
	for _, tc := range []struct {
		name, path, body, terminal string
		stream                     bool
	}{
		{
			name: "Messages流式", path: "/v1/messages", stream: true, terminal: "message_stop",
			body: "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"id\":\"gzip-call\",\"content\":[],\"usage\":{\"input_tokens\":33,\"output_tokens\":0}}}\n\n" +
				"event: content_block_delta\ndata: {\"index\":0,\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"thinking\"}}\n\n" +
				"event: content_block_delta\ndata: {\"index\":1,\"delta\":{\"type\":\"text_delta\",\"text\":\"Hello!\"}}\n\n" +
				"event: message_delta\ndata: {\"type\":\"message_delta\",\"usage\":{\"input_tokens\":33,\"output_tokens\":51,\"cache_creation_input_tokens\":0,\"cache_read_input_tokens\":0}}\n\n" +
				"event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n",
		},
		{
			name: "Messages非流式", path: "/v1/messages",
			body: `{"id":"gzip-call","usage":{"input_tokens":33,"output_tokens":51}}`,
		},
		{
			name: "Chat流式", path: "/v1/chat/completions", stream: true, terminal: "done",
			body: "data: {\"id\":\"gzip-call\",\"choices\":[{\"delta\":{\"content\":\"Hello!\"}}]}\n\n" +
				"data: {\"id\":\"gzip-call\",\"usage\":{\"prompt_tokens\":33,\"completion_tokens\":51}}\n\n" +
				"data: [DONE]\n\n",
		},
		{
			name: "Chat非流式", path: "/v1/chat/completions",
			body: `{"id":"gzip-call","usage":{"prompt_tokens":33,"completion_tokens":51}}`,
		},
		{
			name: "Responses流式", path: "/v1/responses", stream: true, terminal: "response.completed",
			body: "event: response.completed\ndata: {\"type\":\"response.completed\",\"response\":{\"id\":\"gzip-call\",\"usage\":{\"input_tokens\":33,\"output_tokens\":51}}}\n\n",
		},
		{
			name: "Responses非流式", path: "/v1/responses", terminal: "completed",
			body: `{"id":"gzip-call","status":"completed","usage":{"input_tokens":33,"output_tokens":51}}`,
		},
	} {
		for _, encoding := range []string{"gzip", "", "identity", "br, gzip, deflate, zstd", "gzip, identity;q=0"} {
			t.Run(tc.name+"/Accept-Encoding="+encoding, func(t *testing.T) {
				body := []byte(tc.body)
				if encoding != "identity" {
					var compressed bytes.Buffer
					writer := gzip.NewWriter(&compressed)
					if _, err := writer.Write(body); err != nil {
						t.Fatal(err)
					}
					if err := writer.Close(); err != nil {
						t.Fatal(err)
					}
					body = compressed.Bytes()
				}
				upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if r.Header.Get("Accept-Encoding") == "" {
						t.Error("未向上游声明响应编码")
					}
					contentType := "application/json"
					if tc.stream {
						contentType = "text/event-stream"
					}
					w.Header().Set("Content-Type", contentType)
					if encoding != "identity" {
						w.Header().Set("Content-Encoding", "gzip")
					}
					_, _ = w.Write(body)
				}))
				defer upstream.Close()
				billing := estimateBilling{calls: make(chan Call, 2)}
				p := NewProxy(ResolverFunc(func(context.Context, string, string) (Target, error) {
					return Target{ModelID: "resource-id", UpstreamModel: "deepseek-flash", BaseURL: upstream.URL, Protocol: protocolForPath(tc.path)}, nil
				}), discardLogger()).WithBilling(billing)
				req := httptest.NewRequest(http.MethodPost, tc.path, strings.NewReader(fmt.Sprintf(`{"model":"resource-id","stream":%t,"messages":[{"role":"user","content":"Hello, world"}]}`, tc.stream)))
				req.Header.Set("Authorization", "Bearer token")
				if encoding != "" {
					req.Header.Set("Accept-Encoding", encoding)
				}
				w := httptest.NewRecorder()
				p.ServeHTTP(w, req)
				ctx, cancel := context.WithTimeout(t.Context(), time.Second)
				defer cancel()
				if err := p.Wait(ctx); err != nil {
					t.Fatal(err)
				}
				wantBody := body
				wantEncoding := ""
				if encoding != "" && encoding != "identity" {
					wantEncoding = "gzip"
				} else {
					wantBody = []byte(tc.body)
				}
				if w.Code != http.StatusOK || w.Header().Get("Content-Encoding") != wantEncoding || !bytes.Equal(w.Body.Bytes(), wantBody) {
					t.Fatalf("代理响应发生变化: status=%d encoding=%q", w.Code, w.Header().Get("Content-Encoding"))
				}
				select {
				case call := <-billing.calls:
					if !call.Known || call.Result != "succeeded" || call.ErrorCode != "" || call.InputTokens != 33 || call.OutputTokens != 51 || call.RequestID != "gzip-call" || call.TerminalEvent != tc.terminal || call.Stream != tc.stream || call.InputSource != "" || call.OutputSource != "" {
						t.Fatalf("gzip 用量未正确交给计费结算: %+v", call)
					}
				default:
					t.Fatal("未结算 gzip 用量")
				}
				select {
				case call := <-billing.calls:
					t.Fatalf("gzip 用量重复结算: %+v", call)
				default:
				}
			})
		}
	}
}

func TestProxyPreservesInvalidGzipResponse(t *testing.T) {
	for _, stream := range []bool{false, true} {
		t.Run(fmt.Sprintf("stream=%t", stream), func(t *testing.T) {
			const body = "invalid gzip response"
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Encoding", "gzip")
				_, _ = w.Write([]byte(body))
			}))
			defer upstream.Close()
			billing := estimateBilling{calls: make(chan Call, 1)}
			p := NewProxy(ResolverFunc(func(context.Context, string, string) (Target, error) {
				return Target{ModelID: "resource-id", BaseURL: upstream.URL}, nil
			}), discardLogger()).WithBilling(billing)
			req := httptest.NewRequest(http.MethodPost, "/v1/messages", strings.NewReader(fmt.Sprintf(`{"model":"resource-id","stream":%t}`, stream)))
			req.Header.Set("Authorization", "Bearer token")
			req.Header.Set("Accept-Encoding", "gzip")
			w := httptest.NewRecorder()
			p.ServeHTTP(w, req)
			ctx, cancel := context.WithTimeout(t.Context(), time.Second)
			defer cancel()
			if err := p.Wait(ctx); err != nil {
				t.Fatal(err)
			}
			if w.Code != http.StatusOK || w.Header().Get("Content-Encoding") != "gzip" || w.Body.String() != body {
				t.Fatalf("解压失败不应改变代理响应: status=%d body=%q", w.Code, w.Body.String())
			}
			select {
			case call := <-billing.calls:
				if call.Known || call.Result != "failed" || call.ErrorCode != "usage_read_failed" {
					t.Fatalf("无效 gzip 响应不应确认用量: %+v", call)
				}
			default:
				t.Fatal("未记录 gzip 解压失败")
			}
		})
	}
}
