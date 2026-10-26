package identity

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
)

func consentToken(r *http.Request, requestID string) string {
	cookie, err := r.Cookie(sessionCookie)
	if err != nil || cookie.Value == "" {
		return ""
	}
	mac := hmac.New(sha256.New, []byte(cookie.Value))
	mac.Write([]byte("monkeyai:client-consent:" + requestID))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func verifyConsent(r *http.Request, requestID, publicURL string) error {
	if origin := r.Header.Get("Origin"); origin != "" && !sameOrigin(origin, publicURL) {
		return errors.New("授权确认来源无效")
	}
	csrf := consentToken(r, requestID)
	if csrf == "" || !hmac.Equal([]byte(csrf), []byte(r.Header.Get("X-CSRF-Token"))) {
		return errors.New("授权确认已失效，请刷新页面")
	}
	return nil
}

// sameOrigin 按 scheme、host 和有效端口比较来源。浏览器序列化 Origin 时会省略
// 默认端口并小写化主机名，因此不能直接比较原始字符串。
func sameOrigin(origin, publicURL string) bool {
	actual, err := url.Parse(origin)
	if err != nil || actual.User != nil || actual.Path != "" || actual.RawQuery != "" || actual.Fragment != "" {
		return false
	}
	expected, err := url.Parse(publicURL)
	if err != nil || expected.Hostname() == "" {
		return false
	}
	return strings.EqualFold(actual.Scheme, expected.Scheme) &&
		strings.EqualFold(actual.Hostname(), expected.Hostname()) &&
		effectivePort(actual) == effectivePort(expected)
}

func effectivePort(u *url.URL) string {
	if port := u.Port(); port != "" {
		return port
	}
	switch strings.ToLower(u.Scheme) {
	case "http":
		return "80"
	case "https":
		return "443"
	}
	return ""
}

func readApproval(w http.ResponseWriter, r *http.Request, request AuthorizationRequest, publicURL string) (*[]string, error) {
	if err := verifyConsent(r, request.ID, publicURL); err != nil {
		return nil, err
	}
	var in struct {
		Scopes *[]string `json:"approved_scopes"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&in) != nil || in.Scopes == nil {
		return nil, errors.New("请明确确认授权范围")
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return nil, errors.New("授权确认格式无效")
	}
	return in.Scopes, nil
}
