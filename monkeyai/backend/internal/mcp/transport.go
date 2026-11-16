package mcp

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"log/slog"
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
	cidrs := strings.TrimSpace(os.Getenv("MONKEYAI_MCP_ALLOWED_CIDRS"))
	if cidrs == "" {
		cidrs = "10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,fc00::/7"
	}
	for s := range strings.SplitSeq(cidrs, ",") {
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

func checkIPs(ctx context.Context, ips []netip.Addr, settings NetworkSettings) error {
	var blocked []netip.Prefix
	if settings != nil {
		var err error
		blocked, err = settings.MCPBlockedCIDRs(ctx)
		if err != nil {
			return fmt.Errorf("读取 MCP 网络设置: %w", err)
		}
	}
	for _, ip := range ips {
		if ip.Zone() != "" || !allowedIP(ip) {
			return failure("mcp_address_denied", nil)
		}
		for _, prefix := range blocked {
			if prefix.Contains(ip.Unmap()) {
				return failure("mcp_address_denied", nil)
			}
		}
	}
	return nil
}

func client(settings NetworkSettings) *http.Client {
	return &http.Client{Timeout: 25 * time.Second, CheckRedirect: func(r *http.Request, via []*http.Request) error { return failure("mcp_redirect_denied", nil) }, Transport: &http.Transport{
		// 禁止复用旧连接，确保保存黑名单后每个新请求都重新校验。
		DisableKeepAlives: settings != nil,
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(addr)
			if err != nil {
				return nil, err
			}
			ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
			if err != nil {
				return nil, err
			}
			if err := checkIPs(ctx, ips, settings); err != nil {
				return nil, err
			}
			var dialErr error
			for _, ip := range ips {
				c, err := (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
				if err == nil {
					return c, nil
				}
				dialErr = err
			}
			return nil, upstreamFailure(dialErr, "mcp_connect_failed")
		}}}
}
func tokenClient(req *http.Request, proxy func(*http.Request) (*url.URL, error), lookup func(context.Context, string, string) ([]netip.Addr, error), settings NetworkSettings) (*http.Client, *http.Request, error) {
	h := client(settings)
	p, err := proxy(req)
	if err != nil || p == nil {
		return h, req, err
	}
	if req.URL.Scheme != "https" || p.Scheme != "http" || p.Host == "" {
		return nil, nil, fmt.Errorf("OAuth Token 代理仅支持 HTTPS 目标和 HTTP 代理")
	}
	name := req.URL.Hostname()
	ips, err := lookup(req.Context(), "ip", name)
	if err != nil {
		return nil, nil, err
	}
	if len(ips) == 0 {
		return nil, nil, fmt.Errorf("无法解析 OAuth Token 目标")
	}
	if err := checkIPs(req.Context(), ips, settings); err != nil {
		return nil, nil, err
	}
	target := req.Clone(req.Context())
	u := *req.URL
	port := u.Port()
	if port == "" {
		port = "443"
	}
	u.Host = net.JoinHostPort(ips[0].Unmap().String(), port)
	target.URL = &u
	target.Host = req.URL.Host
	h.Transport = &http.Transport{
		Proxy:           func(*http.Request) (*url.URL, error) { return p, nil },
		TLSClientConfig: &tls.Config{ServerName: name},
	}
	return h, target, nil
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

func setConnectorTimeout(h *http.Client, timeoutMS int64) {
	if timeoutMS >= 1000 && timeoutMS <= 120000 {
		h.Timeout = time.Duration(timeoutMS) * time.Millisecond
	}
}

func discover(ctx context.Context, target string, headers map[string]string, timeout ...time.Duration) ([]remoteTool, error) {
	h := client(nil)
	if len(timeout) > 0 {
		setConnectorTimeout(h, int64(timeout[0]/time.Millisecond))
	}
	return discoverWithClient(ctx, target, headers, h)
}

func discoverWithClient(ctx context.Context, target string, headers map[string]string, httpClient *http.Client) ([]remoteTool, error) {
	budget := 45 * time.Second
	if httpClient.Timeout >= time.Second && httpClient.Timeout <= 120*time.Second && httpClient.Timeout+15*time.Second > budget {
		budget = httpClient.Timeout + 15*time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, budget)
	defer cancel()
	rpc, err := openRemoteWithClient(ctx, target, headers, httpClient)
	if err != nil {
		return nil, err
	}
	defer rpc.close()
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
			slog.WarnContext(ctx, "操作失败", "module", "mcp", "operation", "discoverWithClient", "error", err)
			return nil, failure("mcp_tools_invalid", err)
		}
		for _, t := range list.Tools {
			if t.Name == "" || len(t.Name) > 256 || names[t.Name] || t.InputSchema == nil {
				return nil, failure("mcp_tools_invalid", nil)
			}
			names[t.Name] = true
			out = append(out, t)
		}
		if len(out) > 5000 {
			return nil, failure("mcp_tools_invalid", nil)
		}
		cursor = list.NextCursor
		if cursor == "" {
			return out, nil
		}
		if cursors[cursor] {
			return nil, failure("mcp_tools_invalid", nil)
		}
		cursors[cursor] = true
	}
	return nil, failure("mcp_tools_invalid", nil)
}
