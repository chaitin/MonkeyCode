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
	if origin := r.Header.Get("Origin"); origin != "" {
		actual, err := url.Parse(origin)
		expected, expectedErr := url.Parse(publicURL)
		if err != nil || expectedErr != nil || actual.User != nil || actual.Path != "" || actual.RawQuery != "" || actual.Fragment != "" || actual.Scheme != expected.Scheme || actual.Host != expected.Host {
			return errors.New("授权确认来源无效")
		}
	}
	csrf := consentToken(r, requestID)
	if csrf == "" || !hmac.Equal([]byte(csrf), []byte(r.Header.Get("X-CSRF-Token"))) {
		return errors.New("授权确认已失效，请刷新页面")
	}
	return nil
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
