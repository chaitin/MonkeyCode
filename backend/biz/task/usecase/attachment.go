package usecase

import (
	"fmt"
	"net/url"
	"strings"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/errcode"
)

const maxAttachmentURLs = 10

func validateAttachmentURLs(urls []string, cfg config.Attachment) error {
	if len(urls) == 0 {
		return nil
	}
	if len(urls) > maxAttachmentURLs {
		return errcode.ErrBadRequest.Wrap(fmt.Errorf("attachment_urls exceeds limit %d", maxAttachmentURLs))
	}
	for _, raw := range urls {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			return errcode.ErrBadRequest.Wrap(fmt.Errorf("attachment url is empty"))
		}
		u, err := url.Parse(raw)
		if err != nil || u.Host == "" {
			return errcode.ErrBadRequest.Wrap(fmt.Errorf("invalid attachment url: %q", raw))
		}
		if u.Scheme != "http" && u.Scheme != "https" {
			return errcode.ErrBadRequest.Wrap(fmt.Errorf("unsupported attachment url scheme: %q", u.Scheme))
		}
		if !matchAllowedAttachmentPrefix(raw, cfg.AllowedURLPrefixes) {
			return errcode.ErrBadRequest.Wrap(fmt.Errorf("attachment url is not allowed"))
		}
	}
	return nil
}

func matchAllowedAttachmentPrefix(raw string, prefixes []string) bool {
	for _, prefix := range prefixes {
		prefix = strings.TrimSpace(prefix)
		if prefix != "" && strings.HasPrefix(raw, prefix) {
			return true
		}
	}
	return false
}
