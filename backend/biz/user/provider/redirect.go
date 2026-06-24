package provider

import (
	"errors"
	"net/url"
	"strings"
)

const DefaultRedirectURL = "/console/"

func CleanRedirectURL(raw string) (string, error) {
	if strings.ContainsAny(raw, "\r\n\t") || strings.Contains(raw, `\`) {
		return "", errors.New("redirect_url contains invalid character")
	}
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return DefaultRedirectURL, nil
	}
	if strings.HasPrefix(raw, "//") || !strings.HasPrefix(raw, "/") {
		return "", errors.New("redirect_url must be site-relative")
	}
	u, err := url.Parse(raw)
	if err != nil {
		return "", err
	}
	if u.IsAbs() || u.Host != "" || u.Scheme != "" {
		return "", errors.New("redirect_url must not be absolute")
	}
	return u.RequestURI(), nil
}
