package channel

import (
	"fmt"
	"net"
	"net/url"
	"strings"
)

var blockedHeaderKeys = map[string]struct{}{
	"host":              {},
	"transfer-encoding": {},
	"content-length":    {},
	"connection":        {},
}

func ValidateWebhookURL(rawURL string) error {
	u, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("invalid url: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("unsupported scheme %q, only http and https are allowed", u.Scheme)
	}
	host := u.Hostname()
	if host == "" {
		return fmt.Errorf("empty host")
	}
	ips, err := net.LookupHost(host)
	if err != nil {
		return fmt.Errorf("failed to resolve host %q: %w", host, err)
	}
	for _, ipStr := range ips {
		ip := net.ParseIP(ipStr)
		if ip == nil {
			continue
		}
		if isBlockedIP(ip) {
			return fmt.Errorf("webhook url resolves to blocked address %s", ipStr)
		}
	}
	return nil
}

func ValidateHeaders(headers map[string]string) error {
	for k := range headers {
		if _, blocked := blockedHeaderKeys[strings.ToLower(k)]; blocked {
			return fmt.Errorf("header %q is not allowed", k)
		}
	}
	return nil
}

func isBlockedIP(ip net.IP) bool {
	if ip.IsLoopback() {
		return true
	}
	if ip.IsPrivate() {
		return true
	}
	if ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
		return true
	}
	if ip.IsUnspecified() {
		return true
	}
	return false
}
