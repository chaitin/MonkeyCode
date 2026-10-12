package setting

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

type outboundProxy struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	URL      string `json:"url"`
	Username string `json:"username"`
	Password string `json:"password"`
}

func validateProxies(raw json.RawMessage) error {
	var proxies []outboundProxy
	if err := json.Unmarshal(raw, &proxies); err != nil || proxies == nil {
		return errors.New("proxies 必须是数组")
	}
	seen := map[string]bool{}
	for _, proxy := range proxies {
		address, err := url.Parse(proxy.URL)
		if err != nil || (address.Scheme != "http" && address.Scheme != "https" && address.Scheme != "socks5") || address.Host == "" || address.User != nil || address.RawQuery != "" || address.Fragment != "" || address.Path != "" || address.Hostname() == "" || address.Port() == "" {
			return errors.New("代理 URL 必须是 http、https 或 socks5 地址（含端口）")
		}
		port, err := strconv.Atoi(address.Port())
		if err != nil || port < 1 || port > 65535 {
			return errors.New("代理端口无效")
		}
		if proxy.ID == "" || proxy.Name == "" || seen[proxy.ID] || strings.TrimSpace(proxy.Name) != proxy.Name || (proxy.Password != "" && proxy.Username == "") {
			return errors.New("代理配置缺少名称、用户名或 ID 重复")
		}
		seen[proxy.ID] = true
	}
	return nil
}

func (s *Service) ProxyURL(ctx context.Context, id string) (string, error) {
	if id == "" {
		return "", nil
	}
	raw, err := s.GetValue(ctx, "proxies")
	if err != nil {
		return "", fmt.Errorf("读取系统代理: %w", err)
	}
	var config struct {
		Proxies []outboundProxy `json:"proxies"`
	}
	if err := json.Unmarshal(raw, &config); err != nil {
		return "", err
	}
	for _, proxy := range config.Proxies {
		if proxy.ID != id {
			continue
		}
		address, err := url.Parse(proxy.URL)
		if err != nil {
			return "", err
		}
		if proxy.Username != "" {
			address.User = url.UserPassword(proxy.Username, proxy.Password)
		}
		return address.String(), nil
	}
	return "", errors.New("引用的系统代理不存在")
}
