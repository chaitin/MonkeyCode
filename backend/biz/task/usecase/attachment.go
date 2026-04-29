package usecase

import (
	"fmt"
	"net/url"
	"strings"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

const maxAttachments = 10

func validateAttachments(attachments []domain.TaskAttachment, cfg config.Attachment) error {
	if len(attachments) == 0 {
		return nil
	}
	if len(attachments) > maxAttachments {
		return errcode.ErrBadRequest.Wrap(fmt.Errorf("attachments exceeds limit %d", maxAttachments))
	}
	for _, attachment := range attachments {
		raw := strings.TrimSpace(attachment.URL)
		if raw == "" {
			return errcode.ErrBadRequest.Wrap(fmt.Errorf("attachment url is empty"))
		}
		if strings.TrimSpace(attachment.Filename) == "" {
			return errcode.ErrBadRequest.Wrap(fmt.Errorf("attachment filename is empty"))
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

func taskAttachmentsToTaskflow(attachments []domain.TaskAttachment) []taskflow.Attachment {
	if len(attachments) == 0 {
		return nil
	}
	out := make([]taskflow.Attachment, 0, len(attachments))
	for _, attachment := range attachments {
		out = append(out, taskflow.Attachment{
			URL:      attachment.URL,
			Filename: attachment.Filename,
		})
	}
	return out
}
