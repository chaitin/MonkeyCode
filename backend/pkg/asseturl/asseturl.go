package asseturl

import (
	"net/url"
	"path"
	"strings"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/config"
)

const Path = "/api/v1/assets"

func Build(key string) string {
	key, ok := CleanKey(key)
	if !ok {
		return Path
	}
	return Path + "?key=" + url.QueryEscape(key)
}

func Parse(raw string) (string, bool) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Path != Path {
		return "", false
	}
	return CleanKey(u.Query().Get("key"))
}

func CleanKey(raw string) (string, bool) {
	key := strings.Trim(path.Clean(strings.TrimSpace(raw)), "/")
	if key == "" || key == "." || key == ".." || strings.HasPrefix(key, "../") {
		return "", false
	}
	return key, true
}

func AllowedForUser(key string, userID uuid.UUID, cfg config.ObjectStorageConfig) bool {
	key, ok := CleanKey(key)
	if !ok {
		return false
	}
	if hasPrefix(key, cfg.AvatarPrefix) || hasPrefix(key, cfg.SpecPrefix) || hasPrefix(key, cfg.RepoPrefix) {
		return true
	}
	if !hasPrefix(key, cfg.TempPrefix) {
		return false
	}
	if userID == uuid.Nil {
		return false
	}
	return strings.HasPrefix(path.Base(key), userID.String()+"_")
}

func hasPrefix(key, prefix string) bool {
	prefix, ok := CleanKey(prefix)
	if !ok {
		return false
	}
	return key == prefix || strings.HasPrefix(key, prefix+"/")
}
