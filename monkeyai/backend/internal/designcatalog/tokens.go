package designcatalog

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"log/slog"
	"strings"
	"time"
)

type Claims struct {
	Issuer     string `json:"iss"`
	Audience   string `json:"aud"`
	InstanceID string `json:"instance_id"`
	ClientID   string `json:"client_id"`
	Subject    string `json:"sub,omitempty"`
	IssuedAt   int64  `json:"iat"`
	ExpiresAt  int64  `json:"exp"`
}

func signClaims(c Claims, key string) string {
	head := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	body := base64.RawURLEncoding.EncodeToString(payload(c))
	unsigned := head + "." + body
	mac := hmac.New(sha256.New, []byte(key))
	mac.Write([]byte(unsigned))
	return unsigned + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
func (s *Service) mediaClaims(token string, now time.Time) (Claims, error) {
	var c Claims
	unauthorized := fault(401, "unauthorized", "媒体凭据无效或已过期")
	if s.access.MediaSecret == "" || s.access.InstanceID == "" {
		return c, fault(503, "unavailable", "本地媒体签发尚未配置")
	}
	if len(token) > 8192 {
		return c, unauthorized
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return c, unauthorized
	}
	header, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		slog.Warn("操作失败", "module", "designcatalog", "operation", "mediaClaims", "error", err)
		return c, unauthorized
	}
	var h struct {
		Algorithm string          `json:"alg"`
		Type      string          `json:"typ"`
		Critical  json.RawMessage `json:"crit"`
	}
	if decode(header, &h) != nil || h.Algorithm != "HS256" || h.Type != "JWT" || h.Critical != nil {
		return c, unauthorized
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		slog.Warn("操作失败", "module", "designcatalog", "operation", "mediaClaims", "error", err)
		return c, unauthorized
	}
	mac := hmac.New(sha256.New, []byte(s.access.MediaSecret))
	mac.Write([]byte(parts[0] + "." + parts[1]))
	if !hmac.Equal(signature, mac.Sum(nil)) {
		return c, unauthorized
	}
	body, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || decode(body, &c) != nil {
		if err != nil {
			slog.Warn("操作失败", "module", "designcatalog", "operation", "mediaClaims", "error", err)
		}
		return c, unauthorized
	}
	n := now.Unix()
	if c.Issuer != "monkeyai" || c.Audience != "monkeyai-design-media" || c.InstanceID != s.access.InstanceID || c.ClientID == "" || c.Subject == "" || c.IssuedAt <= 0 || c.IssuedAt > n+30 || c.ExpiresAt <= c.IssuedAt || c.ExpiresAt-c.IssuedAt > 600 || c.ExpiresAt <= n-30 {
		return c, unauthorized
	}
	return c, nil
}
