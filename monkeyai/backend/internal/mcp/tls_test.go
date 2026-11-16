package mcp

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

type tlsProxyResolver string

func (p tlsProxyResolver) ProxyURL(context.Context, string) (string, error) {
	return string(p), nil
}

func tlsTestProxy(t *testing.T, secure bool) *httptest.Server {
	t.Helper()
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodConnect {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		upstream, err := net.Dial("tcp", r.Host)
		if err != nil {
			t.Error(err)
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		conn, _, err := w.(http.Hijacker).Hijack()
		if err != nil {
			upstream.Close()
			t.Error(err)
			return
		}
		defer conn.Close()
		defer upstream.Close()
		if _, err := io.WriteString(conn, "HTTP/1.1 200 Connection Established\r\n\r\n"); err != nil {
			t.Error(err)
			return
		}
		go func() { _, _ = io.Copy(upstream, conn); _ = upstream.Close() }()
		_, _ = io.Copy(conn, upstream)
	})
	var server *httptest.Server
	if secure {
		server = httptest.NewTLSServer(handler)
	} else {
		server = httptest.NewServer(handler)
	}
	t.Cleanup(server.Close)
	return server
}

func tlsTestRemote(t *testing.T) *httptest.Server {
	t.Helper()
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var in request
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			t.Error(err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		result := resource.Object{}
		switch in.Method {
		case "initialize":
			result["protocolVersion"] = protocolVersion
		case "notifications/initialized":
			w.WriteHeader(http.StatusAccepted)
			return
		case "tools/list":
			result["tools"] = []resource.Object{{"name": "tls_tool", "inputSchema": resource.Object{"type": "object"}}}
		case "tools/call":
			result["content"] = []resource.Object{}
		}
		resource.JSON(r.Context(), w, http.StatusOK, resource.Object{"jsonrpc": "2.0", "id": in.ID, "result": result})
	}))
	t.Cleanup(server.Close)
	return server
}

func TestConnectorSkipTLSVerify(t *testing.T) {
	t.Setenv("MONKEYAI_MCP_ALLOWED_CIDRS", "127.0.0.0/8")
	server := tlsTestRemote(t)
	for _, mode := range []string{"direct", "http_proxy", "https_proxy"} {
		t.Run(mode, func(t *testing.T) {
			s := &Service{}
			c := resource.Object{}
			if mode != "direct" {
				p := tlsTestProxy(t, mode == "https_proxy")
				s.WithProxyResolver(tlsProxyResolver(p.URL))
				c["proxy_id"] = "proxy"
			}
			for _, skip := range []any{nil, true, false, nil} {
				delete(c, "skip_tls_verify")
				if skip != nil {
					c["skip_tls_verify"] = skip
				}
				h, err := s.clientFor(t.Context(), c)
				if err != nil {
					t.Fatal(err)
				}
				tools, err := discoverWithClient(t.Context(), server.URL, nil, h)
				if skip != true {
					if err == nil {
						t.Fatal("未启用跳过校验的连接器接受了自签名证书")
					}
					continue
				}
				if err != nil || len(tools) != 1 {
					t.Fatalf("开启跳过 TLS 校验后工具发现失败: %v", err)
				}
				rpc, err := openRemoteWithClient(t.Context(), server.URL, nil, h)
				if err != nil {
					t.Fatal(err)
				}
				_, err = rpc.call(t.Context(), 2, "tools/call", resource.Object{"name": "tls_tool"})
				rpc.close()
				if err != nil {
					t.Fatalf("开启跳过 TLS 校验后工具调用失败: %v", err)
				}
			}
			t.Setenv("MONKEYAI_MCP_ALLOWED_CIDRS", "")
			c["skip_tls_verify"] = true
			h, err := s.clientFor(t.Context(), c)
			if err != nil {
				t.Fatal(err)
			}
			defer h.CloseIdleConnections()
			if resp, err := h.Get(server.URL); err == nil {
				resp.Body.Close()
				t.Fatal("跳过 TLS 校验不得绕过地址限制")
			}
		})
	}
}

func TestOAuthSkipTLSVerify(t *testing.T) {
	t.Setenv("MONKEYAI_MCP_ALLOWED_CIDRS", "127.0.0.0/8")
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/token":
			resource.JSON(r.Context(), w, http.StatusOK, resource.Object{"access_token": "tls-token", "token_type": "Bearer"})
		case "/register":
			var input resource.Object
			if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
				t.Error(err)
			}
			resource.JSON(r.Context(), w, http.StatusCreated, resource.Object{"client_id": "tls-client", "token_endpoint_auth_method": "none", "redirect_uris": input["redirect_uris"]})
		case "/metadata":
			resource.JSON(r.Context(), w, http.StatusOK, resource.Object{"supported": true})
		}
	}))
	defer server.Close()
	p := tlsTestProxy(t, false)
	proxyURL, err := url.Parse(p.URL)
	if err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"direct", "system_proxy", "environment_proxy"} {
		t.Run(mode, func(t *testing.T) {
			for _, skip := range []bool{false, true, false} {
				c := resource.Object{"skip_tls_verify": skip, "oauth_config": resource.Object{"client_id": "tls-client", "token_url": server.URL + "/token", "registration_url": server.URL + "/register", "token_endpoint_auth_method": "none"}}
				ctx := t.Context()
				proxy := func(*http.Request) (*url.URL, error) { return nil, nil }
				if mode == "system_proxy" {
					ctx = context.WithValue(ctx, configuredProxyKey{}, p.URL)
				} else if mode == "environment_proxy" {
					proxy = func(*http.Request) (*url.URL, error) { return proxyURL, nil }
				}
				tokens, err := exchangeWithProxy(ctx, c, url.Values{"grant_type": {"client_credentials"}}, proxy)
				if !skip {
					if err == nil {
						t.Fatal("未启用跳过校验的 OAuth 请求接受了自签名证书")
					}
					continue
				}
				if err != nil || tokens.Access != "tls-token" {
					t.Fatalf("OAuth Token 请求未使用连接器 TLS 配置: %+v %v", tokens, err)
				}
				service := &Service{}
				if mode == "system_proxy" {
					service.WithProxyResolver(tlsProxyResolver(p.URL))
					c["proxy_id"] = "proxy"
				}
				h, err := service.clientFor(ctx, c)
				if err != nil {
					t.Fatal(err)
				}
				if _, err := registerOAuthClientWithClient(ctx, oauthSettings(c), "http://localhost/callback", h); err != nil {
					t.Fatalf("OAuth 注册未使用连接器 TLS 配置: %v", err)
				}
				var metadata resource.Object
				if err := readOAuthMetadata(ctx, h, server.URL+"/metadata", &metadata); err != nil {
					t.Fatalf("OAuth 元数据请求未使用连接器 TLS 配置: %v", err)
				}
				h.CloseIdleConnections()
			}
		})
	}
}

func TestConnectorTLSConfigValidation(t *testing.T) {
	s := NewService(nil, "")
	old := resource.Object{"id": "connector", "url": "https://mcp.example.com/mcp", "authorization_mode": "none", "oauth_config": resource.Object{}, "skip_tls_verify": true, "config_revision": float64(2), "connection_status": "connected"}
	for _, value := range []any{nil, "true", 1, resource.Object{}} {
		if err := s.validateConnector(t.Context(), nil, resource.Object{"skip_tls_verify": value}, old); err == nil {
			t.Fatalf("应拒绝非布尔配置: %v", value)
		}
	}
	for _, input := range []resource.Object{{}, {"skip_tls_verify": false}} {
		if err := s.validateConnector(t.Context(), nil, input, old); err != nil {
			t.Fatal(err)
		}
		if input.Bool("skip_tls_verify") {
			if input["config_revision"] != int64(2) || input.String("connection_status") != "connected" {
				t.Fatal("未提供 TLS 配置时不应重置现有配置")
			}
		} else if input["config_revision"] != int64(3) || input.String("connection_status") != "unknown" {
			t.Fatal("TLS 配置变化应更新配置版本并重置连接状态")
		}
	}
}
