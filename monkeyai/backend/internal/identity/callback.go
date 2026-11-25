package identity

import (
	"log/slog"
	"net"
	"net/url"
	"slices"
	"strconv"
	"strings"
)

func (s *Service) WithRedirectOrigins(origins []string) *Service {
	s.redirectOrigins = slices.Clone(origins)
	return s
}

func (s *Service) registeredClient(id string) Client {
	client := Clients[id]
	if id == webClientID && s.publicURL != "" {
		client.RedirectURI = s.publicURL + "/client/oauth/callback"
	}
	if client.RedirectURI != "" {
		client.LocalRedirectOrigins = s.redirectOrigins
	}
	return client
}

// 仅桌面客户端的本机监听回调允许使用动态端口。
func (s *Service) validClientRedirect(clientID, raw string) bool {
	client := s.registeredClient(clientID)
	if raw == "" || client.RedirectURI == "" {
		return false
	}
	if raw == client.RedirectURI {
		return true
	}
	if strings.ContainsAny(raw, "?#\\") {
		return false
	}
	u, err := url.Parse(raw)
	if err != nil || u.User != nil || u.Host == "" {
		if err != nil {
			slog.Warn("操作失败", "module", "identity", "operation", "validClientRedirect", "error", err)
		}
		return false
	}
	origin := u.Scheme + "://" + u.Host
	if slices.Contains(client.LocalRedirectOrigins, origin) && raw == origin+u.EscapedPath() {
		return true
	}
	if clientID != "monkeyai-desktop" || u.Scheme != "http" || u.EscapedPath() != "/oauth/callback" {
		return false
	}
	host, port, err := net.SplitHostPort(u.Host)
	if err != nil || (host != "127.0.0.1" && host != "::1" && host != "localhost") {
		if err != nil {
			slog.Warn("操作失败", "module", "identity", "operation", "validClientRedirect", "error", err)
		}
		return false
	}
	number, err := strconv.Atoi(port)
	return err == nil && number >= 1 && number <= 65535 && strconv.Itoa(number) == port && raw == "http://"+net.JoinHostPort(host, port)+"/oauth/callback"
}
