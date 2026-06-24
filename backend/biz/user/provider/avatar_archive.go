package provider

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strings"
	"time"

	"github.com/chaitin/MonkeyCode/backend/config"
)

const (
	avatarArchiveMaxSize = 2 << 20
)

var avatarFilenameRe = regexp.MustCompile(`[^a-zA-Z0-9._-]+`)

type AvatarObjectStore interface {
	PutFile(ctx context.Context, prefix, filename string, r io.Reader) error
	GetURL(prefix, filename string) string
}

type AvatarArchiver struct {
	cfg        config.ObjectStorageConfig
	httpClient *http.Client
	store      AvatarObjectStore
}

func NewAvatarArchiver(cfg config.ObjectStorageConfig, httpClient *http.Client, store AvatarObjectStore) *AvatarArchiver {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 5 * time.Second}
	}
	return &AvatarArchiver{
		cfg:        cfg,
		httpClient: httpClient,
		store:      store,
	}
}

func (a *AvatarArchiver) Archive(ctx context.Context, name Name, identityID string, rawURL string) (string, error) {
	if a == nil || a.store == nil || !a.cfg.Enabled || strings.TrimSpace(rawURL) == "" {
		return "", nil
	}
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return "", fmt.Errorf("invalid avatar url")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return "", err
	}
	resp, err := a.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return "", fmt.Errorf("download avatar status %d", resp.StatusCode)
	}
	contentType := strings.ToLower(strings.TrimSpace(strings.Split(resp.Header.Get("Content-Type"), ";")[0]))
	if !strings.HasPrefix(contentType, "image/") {
		return "", fmt.Errorf("avatar content type is not image: %s", contentType)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, avatarArchiveMaxSize+1))
	if err != nil {
		return "", err
	}
	if len(body) > avatarArchiveMaxSize {
		return "", fmt.Errorf("avatar exceeds %d bytes", avatarArchiveMaxSize)
	}
	prefix := strings.Trim(path.Join(a.cfg.AvatarPrefix, "oauth", string(name)), "/")
	filename := avatarArchiveFilename(identityID, u.Path, contentType)
	if err := a.store.PutFile(ctx, prefix, filename, bytes.NewReader(body)); err != nil {
		return "", err
	}
	return a.store.GetURL(prefix, filename), nil
}

func avatarArchiveFilename(identityID string, rawPath string, contentType string) string {
	identityID = avatarFilenameRe.ReplaceAllString(strings.TrimSpace(identityID), "_")
	identityID = strings.Trim(identityID, "._-")
	if identityID == "" {
		identityID = "avatar"
	}
	ext := strings.ToLower(path.Ext(rawPath))
	if ext == "" {
		if exts, _ := mime.ExtensionsByType(contentType); len(exts) > 0 {
			ext = exts[0]
		}
	}
	if ext == "" {
		ext = ".jpg"
	}
	return identityID + ext
}
