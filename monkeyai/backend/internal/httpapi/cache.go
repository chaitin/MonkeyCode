package httpapi

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"maps"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5/middleware"
)

func CachedJSON(w http.ResponseWriter, r *http.Request, value map[string]any) error {
	encoded, err := json.Marshal(value)
	if err != nil {
		return err
	}
	digest := sha256.Sum256(encoded)
	version := "sha256:" + hex.EncodeToString(digest[:])
	value = maps.Clone(value)
	value["version"] = version
	encoded, err = json.Marshal(value)
	if err != nil {
		return err
	}
	etag := `"` + version + `"`
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "private, no-cache")
	for match := range strings.SplitSeq(r.Header.Get("If-None-Match"), ",") {
		match = strings.TrimPrefix(strings.TrimSpace(match), "W/")
		if match == etag || match == "*" {
			w.WriteHeader(http.StatusNotModified)
			return nil
		}
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	if _, err := w.Write(encoded); err != nil {
		slog.ErrorContext(r.Context(), "缓存响应写入失败", "request_id", middleware.GetReqID(r.Context()), "error", err)
	}
	return nil
}
