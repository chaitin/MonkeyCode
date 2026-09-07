package mcp

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"strings"
	"time"
)

func allowedIP(ip netip.Addr) bool {
	ip = ip.Unmap()
	for _, s := range strings.Split(os.Getenv("MONKEYAI_MCP_ALLOWED_CIDRS"), ",") {
		p, err := netip.ParsePrefix(strings.TrimSpace(s))
		if err == nil && p.Contains(ip) {
			return true
		}
	}
	for _, cidr := range []string{"0.0.0.0/8", "100.64.0.0/10", "198.18.0.0/15"} {
		if netip.MustParsePrefix(cidr).Contains(ip) {
			return false
		}
	}
	return ip.IsGlobalUnicast() && !ip.IsPrivate() && !ip.IsLoopback() && !ip.IsLinkLocalUnicast()
}
func client() *http.Client {
	return &http.Client{Timeout: 25 * time.Second, CheckRedirect: func(r *http.Request, via []*http.Request) error { return fmt.Errorf("不允许自动重定向") }, Transport: &http.Transport{DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(addr)
		if err != nil {
			return nil, err
		}
		ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
		if err != nil {
			return nil, err
		}
		for _, ip := range ips {
			if !allowedIP(ip) {
				return nil, fmt.Errorf("目标地址不在允许范围内")
			}
		}
		for _, ip := range ips {
			c, err := (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
			if err == nil {
				return c, nil
			}
		}
		return nil, fmt.Errorf("无法连接目标")
	}}}
}
func validURL(value string) bool {
	u, err := url.Parse(value)
	return err == nil && (u.Scheme == "https" || u.Scheme == "http") && u.Host != "" && u.User == nil && u.Fragment == ""
}

type remoteTool struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
}

func discover(ctx context.Context, target string, headers map[string]string) ([]remoteTool, error) {
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	session := ""
	version := "2025-03-26"
	h := client()
	defer h.CloseIdleConnections()
	call := func(id int, method string, params any) (json.RawMessage, error) {
		body, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params})
		req, err := http.NewRequestWithContext(ctx, "POST", target, bytes.NewReader(body))
		if err != nil {
			return nil, err
		}
		for k, v := range headers {
			req.Header.Set(k, v)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "application/json, text/event-stream")
		req.Header.Set("MCP-Protocol-Version", version)
		if session != "" {
			req.Header.Set("Mcp-Session-Id", session)
		}
		resp, err := h.Do(req)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return nil, fmt.Errorf("MCP 返回 HTTP %d", resp.StatusCode)
		}
		if sid := resp.Header.Get("Mcp-Session-Id"); sid != "" {
			session = sid
		}
		var data []byte
		if strings.Contains(resp.Header.Get("Content-Type"), "text/event-stream") {
			scanner := bufio.NewScanner(io.LimitReader(resp.Body, 4<<20))
			scanner.Buffer(make([]byte, 4096), 4<<20)
			var event strings.Builder
			for scanner.Scan() {
				line := scanner.Text()
				if strings.HasPrefix(line, "data:") {
					event.WriteString(strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " "))
					event.WriteByte('\n')
				}
				if line == "" && event.Len() > 0 {
					var candidate struct {
						ID int `json:"id"`
					}
					if json.Unmarshal([]byte(event.String()), &candidate) == nil && candidate.ID == id {
						data = []byte(event.String())
						break
					}
					event.Reset()
				}
			}
			if data == nil {
				return nil, fmt.Errorf("MCP 事件流没有返回响应")
			}
		} else {
			data, err = io.ReadAll(io.LimitReader(resp.Body, (4<<20)+1))
			if err != nil || len(data) > 4<<20 {
				return nil, fmt.Errorf("MCP 响应超限")
			}
		}
		var reply struct {
			ID     int             `json:"id"`
			Result json.RawMessage `json:"result"`
			Error  json.RawMessage `json:"error"`
		}
		if err = json.Unmarshal(data, &reply); err != nil || reply.ID != id || len(reply.Error) > 0 || len(reply.Result) == 0 {
			return nil, fmt.Errorf("MCP 协议响应无效")
		}
		return reply.Result, nil
	}
	init, err := call(1, "initialize", map[string]any{"protocolVersion": version, "capabilities": map[string]any{}, "clientInfo": map[string]string{"name": "MonkeyAI", "version": "1"}})
	if err != nil {
		return nil, err
	}
	var handshake struct {
		Version string `json:"protocolVersion"`
	}
	if json.Unmarshal(init, &handshake) != nil || handshake.Version == "" {
		return nil, fmt.Errorf("MCP 握手无效")
	}
	version = handshake.Version
	notification := []byte(`{"jsonrpc":"2.0","method":"notifications/initialized"}`)
	req, _ := http.NewRequestWithContext(ctx, "POST", target, bytes.NewReader(notification))
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	req.Header.Set("MCP-Protocol-Version", version)
	if session != "" {
		req.Header.Set("Mcp-Session-Id", session)
	}
	resp, err := h.Do(req)
	if err != nil {
		return nil, err
	}
	resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("MCP 初始化通知失败")
	}
	out := []remoteTool{}
	cursor := ""
	cursors := map[string]bool{}
	names := map[string]bool{}
	for page := 0; page < 100; page++ {
		params := map[string]string{}
		if cursor != "" {
			params["cursor"] = cursor
		}
		data, err := call(page+2, "tools/list", params)
		if err != nil {
			return nil, err
		}
		var list struct {
			Tools      []remoteTool `json:"tools"`
			NextCursor string       `json:"nextCursor"`
		}
		if err = json.Unmarshal(data, &list); err != nil {
			return nil, fmt.Errorf("工具目录格式无效")
		}
		for _, t := range list.Tools {
			if t.Name == "" || len(t.Name) > 256 || names[t.Name] || t.InputSchema == nil {
				return nil, fmt.Errorf("工具目录包含无效名称或 Schema")
			}
			names[t.Name] = true
			out = append(out, t)
		}
		if len(out) > 5000 {
			return nil, fmt.Errorf("工具数量超限")
		}
		cursor = list.NextCursor
		if cursor == "" {
			return out, nil
		}
		if cursors[cursor] {
			return nil, fmt.Errorf("工具目录分页循环")
		}
		cursors[cursor] = true
	}
	return nil, fmt.Errorf("工具目录分页超限")
}
