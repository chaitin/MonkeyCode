package kb

import (
	"crypto/sha256"
	"fmt"
	"net/http"
	"regexp"
)

var assetName = regexp.MustCompile(`^[a-f0-9]{64}\.(png|jpg|gif|webp)$`)

func imageHash(data []byte) string          { return fmt.Sprintf("sha256:%x", sha256.Sum256(data)) }
func assetPrefix(id string) string          { return "knowledge/" + id + "/assets/" }
func assetObjectKey(id, name string) string { return assetPrefix(id) + name }
func assetURL(id, name string) string       { return "/api/kb/" + id + "/assets/" + name }
func assetMIME(data []byte) string {
	switch mime := http.DetectContentType(data); mime {
	case "image/png", "image/jpeg", "image/gif", "image/webp":
		return mime
	}
	return ""
}
