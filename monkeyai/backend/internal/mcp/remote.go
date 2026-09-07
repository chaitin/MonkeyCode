package mcp

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

type remoteClient struct {
	http                     *http.Client
	target, session, version string
	headers                  map[string]string
}
type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (e *rpcError) Error() string { return fmt.Sprintf("MCP 调用错误 %d", e.Code) }
func (c *remoteClient) request(ctx context.Context, body []byte) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, "POST", c.target, bytes.NewReader(body))
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
func (c *remoteClient) call(ctx context.Context, id int, method string, params any) (json.RawMessage, error) {
	body, err := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params})
	if err != nil {
		return nil, err
	}
	response, err := c.request(ctx, body)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("MCP 返回 HTTP %d", response.StatusCode)
	}
	if sid := response.Header.Get("Mcp-Session-Id"); sid != "" {
		c.session = sid
	}
	var data []byte
	if strings.Contains(response.Header.Get("Content-Type"), "text/event-stream") {
		scanner := bufio.NewScanner(io.LimitReader(response.Body, 4<<20))
		scanner.Buffer(make([]byte, 4096), 4<<20)
		var event strings.Builder
		check := func() bool {
			var candidate struct {
				ID int `json:"id"`
			}
			if json.Unmarshal([]byte(event.String()), &candidate) == nil && candidate.ID == id {
				data = []byte(event.String())
				return true
			}
			event.Reset()
			return false
		}
		for scanner.Scan() {
			line := scanner.Text()
			if strings.HasPrefix(line, "data:") {
				event.WriteString(strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " "))
				event.WriteByte('\n')
			}
			if line == "" && event.Len() > 0 && check() {
				break
			}
		}
		if data == nil && event.Len() > 0 {
			check()
		}
		if data == nil {
			return nil, fmt.Errorf("MCP 事件流未返回完整响应")
		}
	} else {
		data, err = io.ReadAll(io.LimitReader(response.Body, (4<<20)+1))
		if err != nil || len(data) > 4<<20 {
			return nil, fmt.Errorf("MCP 响应超限或不完整")
		}
	}
	var reply struct {
		ID     int             `json:"id"`
		Result json.RawMessage `json:"result"`
		Error  *rpcError       `json:"error"`
	}
	if err = json.Unmarshal(data, &reply); err != nil || reply.ID != id {
		return nil, fmt.Errorf("MCP 协议响应无效")
	}
	if reply.Error != nil {
		return nil, reply.Error
	}
	if len(reply.Result) == 0 {
		return nil, fmt.Errorf("MCP 缺少调用结果")
	}
	return reply.Result, nil
}
func openRemote(ctx context.Context, target string, headers map[string]string) (*remoteClient, error) {
	c := &remoteClient{http: client(), target: target, version: "2025-03-26", headers: headers}
	result, err := c.call(ctx, 1, "initialize", map[string]any{"protocolVersion": c.version, "capabilities": map[string]any{}, "clientInfo": map[string]string{"name": "MonkeyAI", "version": "1"}})
	if err != nil {
		c.http.CloseIdleConnections()
		return nil, err
	}
	var h struct {
		Version string `json:"protocolVersion"`
	}
	if json.Unmarshal(result, &h) != nil || h.Version == "" {
		c.http.CloseIdleConnections()
		return nil, fmt.Errorf("MCP 握手无效")
	}
	c.version = h.Version
	response, err := c.request(ctx, []byte(`{"jsonrpc":"2.0","method":"notifications/initialized"}`))
	if err != nil {
		c.http.CloseIdleConnections()
		return nil, err
	}
	response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		c.http.CloseIdleConnections()
		return nil, fmt.Errorf("MCP 初始化通知失败")
	}
	return c, nil
}
