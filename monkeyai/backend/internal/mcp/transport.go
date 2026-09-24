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

type proxyRoute struct{ url *url.URL }

type proxyRouteKey struct{}

type mcpTransport struct{ *http.Transport }

func (t *mcpTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	proxy, err := http.ProxyFromEnvironment(r)
	if err != nil {
		return nil, err
	}
	route := proxyRoute{url: proxy}
	if proxy != nil {
		// 代理端解析域名时无法验证解析结果；只允许代理访问已获准的 IP 字面量。
		ip, err := netip.ParseAddr(r.URL.Hostname())
		if err != nil || ip.Zone() != "" {
			return nil, fmt.Errorf("代理目标必须是无区域标识的 IP 地址，无法验证代理端 DNS")
		}
		if !allowedIP(ip) {
			return nil, fmt.Errorf("目标地址不在允许范围内")
		}
		if proxy.Scheme != "http" && proxy.Scheme != "https" {
			return nil, fmt.Errorf("不支持的代理协议")
		}
	}
	return t.Transport.RoundTrip(r.WithContext(context.WithValue(r.Context(), proxyRouteKey{}, route)))
}

func client() *http.Client {
	transport := &http.Transport{
		Proxy: func(r *http.Request) (*url.URL, error) {
			route, ok := r.Context().Value(proxyRouteKey{}).(proxyRoute)
			if !ok {
				return nil, fmt.Errorf("缺少代理路由")
			}
			return route.url, nil
		},
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(addr)
			if err != nil {
				return nil, err
			}
			ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
			if err != nil {
				return nil, err
			}
			route, ok := ctx.Value(proxyRouteKey{}).(proxyRoute)
			if !ok {
				return nil, fmt.Errorf("缺少代理路由")
			}
			// 使用代理时 DialContext 只连接代理；目标 IP 已在 RoundTrip 中校验。
			if route.url == nil {
				for _, ip := range ips {
					if !allowedIP(ip) {
						return nil, fmt.Errorf("目标地址不在允许范围内")
					}
				}
			}
			for _, ip := range ips {
				c, err := (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
				if err == nil {
					return c, nil
				}
			}
			return nil, fmt.Errorf("无法连接目标")
		},
	}
	return &http.Client{Timeout: 25 * time.Second, CheckRedirect: func(r *http.Request, via []*http.Request) error { return fmt.Errorf("不允许自动重定向") }, Transport: &mcpTransport{transport}}
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
