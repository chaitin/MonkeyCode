package enginehost

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/enginehost/sqlc"
)

func (s *Service) RegistryAuthorized(r *http.Request) bool {
	host, password, ok := r.BasicAuth()
	if !ok || !idPattern.MatchString(host) || len(password) > 1024 {
		return false
	}
	raw, err := base64.RawURLEncoding.Strict().DecodeString(password)
	if err != nil {
		return false
	}
	var token struct {
		ExpiresAt int64  `json:"expires_at"`
		Signature []byte `json:"signature"`
	}
	if json.Unmarshal(raw, &token) != nil || len(token.Signature) != ed25519.SignatureSize {
		return false
	}
	now := time.Now().Unix()
	if token.ExpiresAt <= now || token.ExpiresAt > now+3600 {
		return false
	}
	public, err := sqlc.New(s.pool).HostKey(r.Context(), host)
	if err != nil || len(public) != ed25519.PublicKeySize {
		return false
	}
	message := []byte("monkeyai-engine/registry/v1\n" + s.server + "\n" + host + "\n" + strconv.FormatInt(token.ExpiresAt, 10))
	return ed25519.Verify(public, message, token.Signature)
}
