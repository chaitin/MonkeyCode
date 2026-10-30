package proxy

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"
)

func TestUpstreamTimeouts(t *testing.T) {
	for _, tc := range []struct {
		name   string
		header bool
		proxy  bool
	}{
		{"直连响应头", false, false},
		{"直连响应体", true, false},
		{"系统代理响应体", true, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			finished := make(chan struct{})
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if tc.header {
					w.WriteHeader(http.StatusOK)
					w.(http.Flusher).Flush()
				}
				<-r.Context().Done()
				close(finished)
			}))
			defer server.Close()
			transport := DirectTransport()
			transport.ResponseHeaderTimeout = 100 * time.Millisecond
			defer transport.CloseIdleConnections()
			ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
			defer cancel()
			address := server.URL
			if tc.proxy {
				address = "http://upstream.invalid/v1/responses"
				ctx = context.WithValue(ctx, proxyContextKey{}, &proxyContext{target: Target{ProxyURL: server.URL}})
			}
			req, err := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
			if err != nil {
				t.Fatal(err)
			}
			client := &http.Client{Transport: timeoutTransport{
				base: outboundTransport{direct: transport}, requestTimeout: 2 * time.Second, readTimeout: 100 * time.Millisecond,
			}}
			response, err := client.Do(req)
			if tc.header {
				if err != nil {
					t.Fatal(err)
				}
				_, err = io.ReadAll(response.Body)
				response.Body.Close()
				if !errors.Is(err, errUpstreamReadTimeout) {
					t.Fatalf("未触发响应体无数据超时: %v", err)
				}
			}
			if !upstreamTimedOut(ctx, err) || ctx.Err() != nil {
				t.Fatalf("代理超时未独立生效: err=%v parent=%v", err, ctx.Err())
			}
			select {
			case <-finished:
			case <-ctx.Done():
				t.Fatal("超时后未关闭上游请求")
			}
		})
	}
}

func TestUpstreamRequestTimeoutDuringStreaming(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ticker := time.NewTicker(20 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				io.WriteString(w, ": heartbeat\n\n")
				w.(http.Flusher).Flush()
			case <-r.Context().Done():
				return
			}
		}
	}))
	defer server.Close()
	transport := DirectTransport()
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: timeoutTransport{base: transport, requestTimeout: 200 * time.Millisecond, readTimeout: time.Second}}
	response, err := client.Get(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(response.Body)
	if len(data) == 0 || !errors.Is(err, errUpstreamRequestTimeout) {
		t.Fatalf("持续输出未受总时限约束: bytes=%d err=%v", len(data), err)
	}
}

func TestUpstreamReadTimeoutResetsAndIgnoresDownstreamPause(t *testing.T) {
	chunks := make(chan string, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.(http.Flusher).Flush()
		for {
			select {
			case chunk := <-chunks:
				io.WriteString(w, chunk)
				w.(http.Flusher).Flush()
			case <-r.Context().Done():
				return
			}
		}
	}))
	defer server.Close()
	transport := DirectTransport()
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: timeoutTransport{base: transport, requestTimeout: 3 * time.Second, readTimeout: 100 * time.Millisecond}}
	response, err := client.Get(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	for range 3 {
		// 下游暂停时间超过无数据超时，下一次读取仍应获得新的完整等待窗口。
		<-time.After(150 * time.Millisecond)
		chunks <- "x"
		buffer := make([]byte, 1)
		if _, err := io.ReadFull(response.Body, buffer); err != nil || string(buffer) != "x" {
			t.Fatalf("下游暂停或前一次读取影响了无数据超时: %q %v", buffer, err)
		}
	}
}

func TestProxyBodyTimeoutObservedAsFailure(t *testing.T) {
	for _, stream := range []bool{false, true} {
		t.Run(fmt.Sprintf("stream=%t", stream), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				io.Copy(io.Discard, r.Body)
				if stream {
					w.Header().Set("Content-Type", "text/event-stream")
					io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\"hello\"}}]}\n\n")
				}
				w.(http.Flusher).Flush()
				<-r.Context().Done()
			}))
			defer server.Close()
			var logs bytes.Buffer
			p := NewProxy(ResolverFunc(func(context.Context, string, string) (Target, error) {
				return Target{BaseURL: server.URL}, nil
			}), logging.New(&logs, slog.LevelDebug))
			transport := p.reverse.Transport.(timeoutTransport)
			transport.readTimeout = 100 * time.Millisecond
			transport.requestTimeout = 2 * time.Second
			p.reverse.Transport = transport
			r := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(fmt.Sprintf(`{"model":"test","stream":%t}`, stream)))
			r.Header.Set("Authorization", "Bearer test")
			// ReverseProxy 在响应已经开始后通过 ErrAbortHandler 结束连接。
			func() {
				defer func() {
					if value := recover(); value != nil && value != http.ErrAbortHandler {
						panic(value)
					}
				}()
				p.ServeHTTP(httptest.NewRecorder(), r)
			}()
			if err := p.Wait(t.Context()); err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(logs.String(), `"error_code":"upstream_timeout"`) || !strings.Contains(logs.String(), `"result":"failed"`) {
				t.Fatalf("超时未记录为上游失败: %s", logs.String())
			}
		})
	}
}

func TestHTTPSProxyHandshakeTimeout(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	go func() {
		conn, err := listener.Accept()
		if err == nil {
			defer conn.Close()
			io.Copy(io.Discard, conn)
		}
	}()
	transport, err := TransportFor("https://" + listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer transport.CloseIdleConnections()
	transport.TLSHandshakeTimeout = 100 * time.Millisecond
	client := &http.Client{Transport: transport, Timeout: 3 * time.Second}
	started := time.Now()
	_, err = client.Get("http://upstream.invalid")
	if !errors.Is(err, context.DeadlineExceeded) || time.Since(started) >= time.Second {
		t.Fatalf("HTTPS 代理握手未按独立时限结束: %v", err)
	}
}

func TestUpstreamRequestTimeoutWhileWaitingForConnection(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	defer server.Close()
	transport := DirectTransport()
	transport.MaxConnsPerHost = 1
	defer transport.CloseIdleConnections()
	first, err := (&http.Client{Transport: transport, Timeout: 3 * time.Second}).Get(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Body.Close()
	client := &http.Client{Transport: timeoutTransport{base: transport, requestTimeout: 100 * time.Millisecond, readTimeout: time.Second}}
	_, err = client.Get(server.URL)
	if !errors.Is(err, errUpstreamRequestTimeout) {
		t.Fatalf("等待连接未受请求总时限约束: %v", err)
	}
}

func TestUpstreamTimeoutPreservesClientCancellation(t *testing.T) {
	started := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.(http.Flusher).Flush()
		close(started)
		<-r.Context().Done()
	}))
	defer server.Close()
	transport := DirectTransport()
	defer transport.CloseIdleConnections()
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, server.URL, nil)
	response, err := (&http.Client{Transport: withUpstreamTimeouts(transport)}).Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	<-started
	cancel()
	if _, err := io.ReadAll(response.Body); !errors.Is(err, context.Canceled) || upstreamTimedOut(ctx, err) {
		t.Fatalf("客户端取消被误判为超时: %v", err)
	}
}
