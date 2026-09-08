package httpapi

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"maps"
	"net/http"
	"strings"
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
	for _, match := range strings.Split(r.Header.Get("If-None-Match"), ",") {
		match = strings.TrimPrefix(strings.TrimSpace(match), "W/")
		if match == etag || match == "*" {
			w.WriteHeader(http.StatusNotModified)
			return nil
		}
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_, err = w.Write(encoded)
	return err
}
