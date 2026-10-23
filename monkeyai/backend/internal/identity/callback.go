package identity

import (
	"net"
	"net/url"
	"strconv"
	"strings"
)

// Native applications use their registered URI. Desktop loopback listeners may
// choose a port, but cannot change the host, protocol or callback path.
func validClientRedirect(clientID, raw string) bool {
	client, ok := Clients[clientID]
	if !ok || raw == "" || client.RedirectURI == "" {
		return false
	}
	if raw == client.RedirectURI {
		return true
	}
	if clientID != "monkeyai-desktop" || strings.Contains(raw, "#") {
		return false
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "http" || u.Opaque != "" || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.EscapedPath() != "/oauth/callback" {
		return false
	}
	host, port, err := net.SplitHostPort(u.Host)
	if err != nil || (host != "127.0.0.1" && host != "::1" && host != "localhost") {
		return false
	}
	number, err := strconv.Atoi(port)
	return err == nil && number >= 1 && number <= 65535 && strconv.Itoa(number) == port && raw == "http://"+net.JoinHostPort(host, port)+"/oauth/callback"
}
