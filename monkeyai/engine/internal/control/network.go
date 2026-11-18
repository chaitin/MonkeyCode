package control

import (
	"errors"
	"net/http"
	"net/netip"
	"net/url"
	"strconv"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/engine/internal/dockernet"
	"golang.org/x/net/http/httpproxy"
)

type NetworkConfig struct {
	AllowPrivateCIDRs []netip.Prefix `json:"allow_private_cidrs,omitempty"`
	Proxy             string         `json:"proxy,omitempty"`
	NoProxy           string         `json:"no_proxy,omitempty"`
}

func (c NetworkConfig) Validate() error {
	if err := dockernet.ValidatePrivateCIDRs(c.AllowPrivateCIDRs); err != nil {
		return err
	}
	if strings.ContainsAny(c.NoProxy, "\x00\r\n") || len(c.NoProxy) > 4096 || c.Proxy == "" && c.NoProxy != "" {
		return errors.New("no_proxy 无效或未配置 proxy")
	}
	if c.Proxy == "" {
		return nil
	}
	u, err := url.Parse(c.Proxy)
	if err == nil {
		port, e := strconv.ParseUint(u.Port(), 10, 16)
		if (u.Scheme == "http" || u.Scheme == "https") && u.Hostname() != "" && u.User == nil && (u.Path == "" || u.Path == "/") && !u.ForceQuery && u.RawQuery == "" && u.Fragment == "" && !strings.ContainsAny(c.Proxy, "#\r\n\x00") && (u.Port() == "" || e == nil && port != 0) {
			return nil
		}
	}
	return errors.New("proxy 必须为无凭据的 HTTP 或 HTTPS 代理地址")
}

func (c NetworkConfig) proxyFunc() func(*http.Request) (*url.URL, error) {
	p := (&httpproxy.Config{HTTPProxy: c.Proxy, HTTPSProxy: c.Proxy, NoProxy: c.NoProxy}).ProxyFunc()
	return func(r *http.Request) (*url.URL, error) { return p(r.URL) }
}

func (c NetworkConfig) ProxyEnv() []string {
	if c.Proxy == "" {
		return nil
	}
	return []string{"HTTP_PROXY=" + c.Proxy, "http_proxy=" + c.Proxy, "HTTPS_PROXY=" + c.Proxy, "https_proxy=" + c.Proxy, "NO_PROXY=" + c.NoProxy, "no_proxy=" + c.NoProxy}
}
