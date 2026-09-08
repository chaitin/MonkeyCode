package mcp

import (
	"context"
	"encoding/json"
	"fmt"
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
	for s := range strings.SplitSeq(os.Getenv("MONKEYAI_MCP_ALLOWED_CIDRS"), ",") {
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
	rpc, err := openRemote(ctx, target, headers)
	if err != nil {
		return nil, err
	}
	defer rpc.http.CloseIdleConnections()
	call := func(id int, method string, params any) (json.RawMessage, error) {
		return rpc.call(ctx, id, method, params)
	}
	out := []remoteTool{}
	cursor := ""
	cursors := map[string]bool{}
	names := map[string]bool{}
	for page := range 100 {
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
