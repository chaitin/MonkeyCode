package relay

import (
	"crypto/sha1"
	"encoding/base64"
	"net/http"
	"net/url"
	"slices"
	"strings"
)

const terminalProtocol = "monkeyai.terminal.v1"

func headerToken(h http.Header, key, token string) bool {
	for _, line := range h.Values(key) {
		for _, value := range strings.Split(line, ",") {
			if strings.EqualFold(strings.TrimSpace(value), token) {
				return true
			}
		}
	}
	return false
}

func terminalHandshake(r *http.Request) (string, bool, bool) {
	if r.Method != http.MethodGet || !headerToken(r.Header, "Connection", "upgrade") || !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") || len(r.Header.Values("Upgrade")) != 1 || !slices.Equal(r.Header.Values("Sec-WebSocket-Version"), []string{"13"}) {
		return "", false, false
	}
	keys := r.Header.Values("Sec-WebSocket-Key")
	if len(keys) != 1 {
		return "", false, false
	}
	key, err := base64.StdEncoding.Strict().DecodeString(keys[0])
	if err != nil || len(key) != 16 {
		return "", false, false
	}
	if len(r.URL.RawQuery) > 64 {
		return "", false, false
	}
	query, err := url.ParseQuery(r.URL.RawQuery)
	candidate := false
	if err != nil || r.URL.ForceQuery {
		return "", false, false
	}
	if r.URL.RawQuery != "" {
		if len(query) != 1 || !slices.Equal(query["reattach"], []string{"1"}) || strings.Count(r.URL.RawQuery, "&") != 0 {
			return "", false, false
		}
		candidate = true
	}
	var ticket string
	auth := r.Header.Values("Authorization")
	if len(auth) > 1 {
		return "", false, false
	}
	if len(auth) == 1 {
		parts := strings.Split(auth[0], " ")
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || parts[1] == "" {
			return "", false, false
		}
		ticket = parts[1]
	}
	business, credentials := 0, 0
	for _, line := range r.Header.Values("Sec-WebSocket-Protocol") {
		for _, value := range strings.Split(line, ",") {
			value = strings.TrimSpace(value)
			switch {
			case value == terminalProtocol:
				business++
			case strings.HasPrefix(value, "monkeyai.token."):
				credentials++
				raw := strings.TrimPrefix(value, "monkeyai.token.")
				if raw == "" || ticket != "" && raw != ticket {
					return "", false, false
				}
				ticket = raw
			default:
				return "", false, false
			}
		}
	}
	if business != 1 || credentials > 1 || len(r.Header.Values("Origin")) > 1 {
		return "", false, false
	}
	return ticket, candidate, true
}

func validTerminalUpgrade(response *http.Response, key string) bool {
	digest := sha1.Sum([]byte(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
	return headerToken(response.Header, "Connection", "upgrade") && len(response.Header.Values("Upgrade")) == 1 && strings.EqualFold(response.Header.Get("Upgrade"), "websocket") &&
		slices.Equal(response.Header.Values("Sec-WebSocket-Protocol"), []string{terminalProtocol}) &&
		slices.Equal(response.Header.Values("Sec-WebSocket-Accept"), []string{base64.StdEncoding.EncodeToString(digest[:])}) && len(response.Header.Values("Sec-WebSocket-Extensions")) == 0
}
