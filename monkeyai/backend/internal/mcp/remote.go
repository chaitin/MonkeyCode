package mcp

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"strings"
	"time"
)

type remoteClient struct {
	http                     *http.Client
	target, session, version string
	headers                  map[string]string
}
type rpcError struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data,omitempty"`
}

func (e *rpcError) Error() string { return fmt.Sprintf("MCP 调用错误 %d", e.Code) }
func (c *remoteClient) request(ctx context.Context, method string, body []byte) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, c.target, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	for k, v := range c.headers {
		req.Header.Set(k, v)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	req.Header.Set("MCP-Protocol-Version", c.version)
	if c.session != "" {
		req.Header.Set("Mcp-Session-Id", c.session)
	}
	return c.http.Do(req)
}

func (c *remoteClient) close() {
	defer c.http.CloseIdleConnections()
	if c.session == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	response, err := c.request(ctx, http.MethodDelete, nil)
	if err == nil {
		response.Body.Close()
	}
}

func (c *remoteClient) call(ctx context.Context, id int, method string, params any) (json.RawMessage, error) {
	body, err := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params})
	if err != nil {
		return nil, err
	}
	response, err := c.request(ctx, http.MethodPost, body)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("MCP 返回 HTTP %d", response.StatusCode)
	}
	if method == "initialize" {
		c.session = response.Header.Get("Mcp-Session-Id")
	}
	media, _, err := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if err != nil {
		return nil, fmt.Errorf("MCP 响应类型无效")
	}
	var data []byte
	switch media {
	case "text/event-stream":
		scanner := bufio.NewScanner(io.LimitReader(response.Body, (4<<20)+1))
		scanner.Buffer(make([]byte, 4096), 4<<20)
		var event strings.Builder
		for scanner.Scan() {
			line := scanner.Text()
			if after, ok := strings.CutPrefix(line, "data:"); ok {
				event.WriteString(strings.TrimPrefix(after, " "))
				event.WriteByte('\n')
			}
			if line != "" || event.Len() == 0 {
				continue
			}
			var candidate struct {
				ID     int    `json:"id"`
				Method string `json:"method"`
			}
			if json.Unmarshal([]byte(event.String()), &candidate) == nil && candidate.ID == id && candidate.Method == "" {
				data = []byte(event.String())
				break
			}
			event.Reset()
		}
		if scanner.Err() != nil || data == nil {
			return nil, fmt.Errorf("MCP 事件流超限或未返回完整响应")
		}
	case "application/json":
		data, err = io.ReadAll(io.LimitReader(response.Body, (4<<20)+1))
		if err != nil || len(data) > 4<<20 {
			return nil, fmt.Errorf("MCP 响应超限或不完整")
		}
	default:
		return nil, fmt.Errorf("MCP 响应类型不支持")
	}
	var reply struct {
		Version string          `json:"jsonrpc"`
		ID      int             `json:"id"`
		Result  json.RawMessage `json:"result"`
		Error   json.RawMessage `json:"error"`
	}
	if err = json.Unmarshal(data, &reply); err != nil || reply.ID != id || reply.Version != "2.0" || (len(reply.Result) == 0) == (len(reply.Error) == 0) {
		return nil, fmt.Errorf("MCP 协议响应无效")
	}
	if len(reply.Error) > 0 {
		var failure struct {
			Code    *int            `json:"code"`
			Message *string         `json:"message"`
			Data    json.RawMessage `json:"data"`
		}
		if json.Unmarshal(reply.Error, &failure) != nil || failure.Code == nil || failure.Message == nil {
			return nil, fmt.Errorf("MCP 错误响应无效")
		}
		return nil, &rpcError{Code: *failure.Code, Message: *failure.Message, Data: failure.Data}
	}
	return reply.Result, nil
}

func openRemote(ctx context.Context, target string, headers map[string]string) (*remoteClient, error) {
	if !validURL(target) {
		return nil, fmt.Errorf("MCP URL 无效")
	}
	c := &remoteClient{http: client(), target: target, version: protocolVersion, headers: headers}
	initialized := false
	defer func() {
		if !initialized {
			c.close()
		}
	}()
	result, err := c.call(ctx, 1, "initialize", map[string]any{"protocolVersion": c.version, "capabilities": map[string]any{}, "clientInfo": map[string]string{"name": "MonkeyAI", "version": "1"}})
	if err != nil {
		return nil, err
	}
	var h struct {
		Version string `json:"protocolVersion"`
	}
	if json.Unmarshal(result, &h) != nil || !supportedVersion(h.Version) {
		return nil, fmt.Errorf("MCP 握手版本不支持")
	}
	c.version = h.Version
	response, err := c.request(ctx, http.MethodPost, []byte(`{"jsonrpc":"2.0","method":"notifications/initialized"}`))
	if err != nil {
		return nil, err
	}
	response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("MCP 初始化通知失败")
	}
	initialized = true
	return c, nil
}
