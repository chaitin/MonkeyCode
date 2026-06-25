package usecase

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/backend/config"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/pkg/asseturl"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
	"github.com/google/uuid"
)

const maxAttachments = 10

func validateAttachments(userID uuid.UUID, attachments []domain.TaskAttachment, cfg config.Attachment, objectCfg config.ObjectStorageConfig) error {
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
		if key, ok := asseturl.Parse(raw); ok {
			if !objectCfg.Enabled {
				return errcode.ErrBadRequest.Wrap(fmt.Errorf("object storage is disabled"))
			}
			if !asseturl.AllowedForUser(key, userID, objectCfg) {
				return errcode.ErrBadRequest.Wrap(fmt.Errorf("attachment asset is not allowed"))
			}
			continue
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

func (a *TaskUsecase) taskAttachmentsToTaskflow(ctx context.Context, attachments []domain.TaskAttachment) ([]taskflow.Attachment, error) {
	if len(attachments) == 0 {
		return nil, nil
	}
	out := make([]taskflow.Attachment, 0, len(attachments))
	for _, attachment := range attachments {
		raw := strings.TrimSpace(attachment.URL)
		if key, ok := asseturl.Parse(raw); ok {
			if a == nil || a.cfg == nil || !a.cfg.ObjectStorage.Enabled || a.attachmentSigner == nil {
				return nil, errcode.ErrBadRequest.Wrap(fmt.Errorf("object storage is disabled"))
			}
			u, err := a.attachmentSigner.PresignGet(ctx, key, attachmentPresignExpires(a.cfg))
			if err != nil {
				return nil, err
			}
			raw = u
		}
		out = append(out, taskflow.Attachment{
			URL:      raw,
			Filename: attachment.Filename,
		})
	}
	return out, nil
}

func attachmentPresignExpires(cfg *config.Config) time.Duration {
	if cfg == nil {
		return 7 * 24 * time.Hour
	}
	expires, err := time.ParseDuration(strings.TrimSpace(cfg.ObjectStorage.PresignExpires))
	if err != nil || expires <= 0 {
		return 7 * 24 * time.Hour
	}
	if expires > 7*24*time.Hour {
		return 7 * 24 * time.Hour
	}
	return expires
}
