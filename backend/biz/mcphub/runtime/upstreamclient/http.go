package upstreamclient

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/chaitin/MonkeyCode/backend/biz/mcphub/repo"
	"github.com/chaitin/MonkeyCode/backend/biz/mcphub/runtime/gateway"
	"github.com/chaitin/MonkeyCode/backend/pkg/netguard"
)

type HTTPClient struct {
	client   *http.Client
	guard    *netguard.Guard
	mu       sync.RWMutex
	sessions map[string]string
}

type rpcResponse struct {
	Result json.RawMessage `json:"result"`
	Error  *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

type listToolsResult struct {
	Tools []struct {
		Name        string          `json:"name"`
		Description string          `json:"description"`
		InputSchema json.RawMessage `json:"inputSchema"`
	} `json:"tools"`
}

func NewHTTPClient(timeout time.Duration, blockPrivateNetwork ...bool) *HTTPClient {
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	block := true
	if len(blockPrivateNetwork) > 0 {
		block = blockPrivateNetwork[0]
	}
	guard := netguard.New(block)
	client := &HTTPClient{
		guard:    guard,
		sessions: make(map[string]string),
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	client.client = guard.HTTPClient(&http.Client{
		Timeout:   timeout,
		Transport: transport,
	})
	return client
}

func (c *HTTPClient) CallTool(ctx context.Context, upstream *repo.UpstreamConfig, tool repo.ToolSnapshot, params gateway.CallToolParams) (json.RawMessage, string, error) {
	if err := c.guard.ValidateURL(ctx, upstream.URL); err != nil {
		return nil, "", err
	}

	payload := map[string]any{
		"jsonrpc": "2.0",
		"id":      "1",
		"method":  "tools/call",
		"params": map[string]any{
			"name":      params.Name,
			"arguments": json.RawMessage(params.Arguments),
		},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, "", fmt.Errorf("marshal upstream request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, upstream.URL, bytes.NewReader(body))
	if err != nil {
		return nil, "", fmt.Errorf("build upstream request: %w", err)
	}
	data, headers, err := c.doRequestWithSession(ctx, upstream, req)
	if err != nil {
		return nil, "", err
	}

	data, err = decodeMCPResponseBody(data, headers.Get("Content-Type"))
	if err != nil {
		return nil, headers.Get("X-Request-Id"), fmt.Errorf("decode upstream response: %w", err)
	}

	var rpc rpcResponse
	if err := json.Unmarshal(data, &rpc); err != nil {
		return nil, headers.Get("X-Request-Id"), fmt.Errorf("decode upstream response json: %w", err)
	}
	if rpc.Error != nil {
		return nil, headers.Get("X-Request-Id"), errors.New(rpc.Error.Message)
	}
	return rpc.Result, headers.Get("X-Request-Id"), nil
}

func (c *HTTPClient) ListTools(ctx context.Context, upstream *repo.UpstreamConfig) ([]repo.UpstreamTool, error) {
	if err := c.guard.ValidateURL(ctx, upstream.URL); err != nil {
		return nil, err
	}

	payload := map[string]any{
		"jsonrpc": "2.0",
		"id":      "1",
		"method":  "tools/list",
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal upstream list request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, upstream.URL, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("build upstream list request: %w", err)
	}
	data, headers, err := c.doRequestWithSession(ctx, upstream, req)
	if err != nil {
		return nil, err
	}

	data, err = decodeMCPResponseBody(data, headers.Get("Content-Type"))
	if err != nil {
		return nil, fmt.Errorf("decode upstream list response: %w", err)
	}

	var rpc rpcResponse
	if err := json.Unmarshal(data, &rpc); err != nil {
		return nil, fmt.Errorf("decode upstream list response json: %w", err)
	}
	if rpc.Error != nil {
		return nil, errors.New(rpc.Error.Message)
	}

	var result listToolsResult
	if err := json.Unmarshal(rpc.Result, &result); err != nil {
		return nil, fmt.Errorf("decode upstream tools result: %w", err)
	}

	tools := make([]repo.UpstreamTool, 0, len(result.Tools))
	for _, tool := range result.Tools {
		inputSchema := tool.InputSchema
		if len(inputSchema) == 0 {
			inputSchema = json.RawMessage(`{}`)
		}
		tools = append(tools, repo.UpstreamTool{
			Name:        tool.Name,
			Description: tool.Description,
			InputSchema: inputSchema,
		})
	}
	return tools, nil
}

func (c *HTTPClient) doRequestWithSession(ctx context.Context, upstream *repo.UpstreamConfig, req *http.Request) ([]byte, http.Header, error) {
	c.clearSession(upstream)
	if err := c.initializeSession(ctx, upstream); err != nil {
		return nil, nil, err
	}
	data, headers, status, err := c.doRequest(ctx, upstream, req)
	if err != nil {
		return nil, nil, err
	}
	if status >= http.StatusBadRequest {
		return nil, headers, fmt.Errorf("upstream http %d: %s", status, strings.TrimSpace(string(data)))
	}
	return data, headers, nil
}

func (c *HTTPClient) doRequest(ctx context.Context, upstream *repo.UpstreamConfig, req *http.Request) ([]byte, http.Header, int, error) {
	request := req.Clone(ctx)
	if req.GetBody != nil {
		body, err := req.GetBody()
		if err != nil {
			return nil, nil, 0, err
		}
		request.Body = body
	}
	applyMCPHeaders(request, upstream.Headers)
	if sessionID := c.getSession(upstream); sessionID != "" {
		request.Header.Set("Mcp-Session-Id", sessionID)
	}

	resp, err := c.client.Do(request)
	if err != nil {
		return nil, nil, 0, err
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.Header, resp.StatusCode, fmt.Errorf("read upstream response: %w", err)
	}
	return data, resp.Header.Clone(), resp.StatusCode, nil
}

func (c *HTTPClient) initializeSession(ctx context.Context, upstream *repo.UpstreamConfig) error {
	payload := map[string]any{
		"jsonrpc": "2.0",
		"id":      "1",
		"method":  "initialize",
		"params": map[string]any{
			"protocolVersion": "2025-03-26",
			"capabilities":    map[string]any{},
			"clientInfo": map[string]any{
				"name":    "mcphub",
				"version": "1.0.0",
			},
		},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal upstream initialize request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, upstream.URL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("build upstream initialize request: %w", err)
	}
	req.GetBody = func() (io.ReadCloser, error) {
		return io.NopCloser(bytes.NewReader(body)), nil
	}

	data, headers, status, err := c.doRequest(ctx, upstream, req)
	if err != nil {
		return err
	}
	if status >= http.StatusBadRequest {
		return fmt.Errorf("upstream http %d: %s", status, strings.TrimSpace(string(data)))
	}

	if sessionID := headers.Get("Mcp-Session-Id"); sessionID != "" {
		c.setSession(upstream, sessionID)
	}
	return c.sendInitializedNotification(ctx, upstream)
}

func (c *HTTPClient) sendInitializedNotification(ctx context.Context, upstream *repo.UpstreamConfig) error {
	payload := map[string]any{
		"jsonrpc": "2.0",
		"method":  "notifications/initialized",
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal upstream initialized notification: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, upstream.URL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("build upstream initialized notification: %w", err)
	}
	req.GetBody = func() (io.ReadCloser, error) {
		return io.NopCloser(bytes.NewReader(body)), nil
	}

	data, _, status, err := c.doRequest(ctx, upstream, req)
	if err != nil {
		return err
	}
	if status >= http.StatusBadRequest {
		return fmt.Errorf("upstream http %d: %s", status, strings.TrimSpace(string(data)))
	}
	return nil
}

func (c *HTTPClient) getSession(upstream *repo.UpstreamConfig) string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.sessions[sessionKey(upstream)]
}

func (c *HTTPClient) setSession(upstream *repo.UpstreamConfig, sessionID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.sessions[sessionKey(upstream)] = sessionID
}

func (c *HTTPClient) clearSession(upstream *repo.UpstreamConfig) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.sessions, sessionKey(upstream))
}

func sessionKey(upstream *repo.UpstreamConfig) string {
	return upstream.ID.String() + "|" + upstream.URL
}

func applyMCPHeaders(req *http.Request, headers map[string]string) {
	req.Header.Set("Content-Type", "application/json")
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	req.Header.Set("Accept", ensureMCPAccept(req.Header.Get("Accept")))
}

func ensureMCPAccept(current string) string {
	parts := make([]string, 0, 4)
	seen := make(map[string]struct{}, 4)
	for part := range strings.SplitSeq(current, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if _, ok := seen[part]; ok {
			continue
		}
		seen[part] = struct{}{}
		parts = append(parts, part)
	}
	for _, required := range []string{"application/json", "text/event-stream"} {
		if _, ok := seen[required]; ok {
			continue
		}
		parts = append(parts, required)
	}
	return strings.Join(parts, ", ")
}

func decodeMCPResponseBody(data []byte, contentType string) ([]byte, error) {
	if strings.Contains(strings.ToLower(contentType), "text/event-stream") {
		return extractSSEData(data)
	}
	return data, nil
}

func extractSSEData(data []byte) ([]byte, error) {
	scanner := bufio.NewScanner(bytes.NewReader(data))
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	var eventData []string
	for scanner.Scan() {
		line := strings.TrimRight(scanner.Text(), "\r")
		if line == "" {
			if len(eventData) > 0 {
				return []byte(strings.Join(eventData, "\n")), nil
			}
			continue
		}
		if strings.HasPrefix(line, ":") {
			continue
		}
		if after, ok := strings.CutPrefix(line, "data:"); ok {
			eventData = append(eventData, strings.TrimSpace(after))
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	if len(eventData) > 0 {
		return []byte(strings.Join(eventData, "\n")), nil
	}
	return nil, errors.New("empty sse data")
}
