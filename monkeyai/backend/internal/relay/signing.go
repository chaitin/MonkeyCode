package relay

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"os"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/endpoint"
)

func loadSigningKey(path string) (ed25519.PrivateKey, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return parseSigningKey(data)
}

func parseSigningKey(data []byte) (ed25519.PrivateKey, error) {
	block, rest := pem.Decode(data)
	if block == nil || block.Type != "PRIVATE KEY" || strings.TrimSpace(string(rest)) != "" {
		return nil, errors.New("中转签名文件必须是 PKCS8 PEM 私钥")
	}
	value, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, err
	}
	key, ok := value.(ed25519.PrivateKey)
	if !ok {
		return nil, errors.New("中转签名必须使用 Ed25519")
	}
	return key, nil
}

func verificationKey(public ed25519.PublicKey) map[string]string {
	return map[string]string{
		"kid":        endpoint.KeyID(public),
		"algorithm":  "Ed25519",
		"public_key": base64.RawURLEncoding.EncodeToString(public),
	}
}

func normalizeVerificationKey(key map[string]string) (map[string]string, error) {
	encoded := ""
	switch {
	case key["algorithm"] != "" || key["public_key"] != "":
		if len(key) != 3 || key["algorithm"] != "Ed25519" {
			return nil, errors.New("中转公钥集合包含无效 Ed25519 公钥")
		}
		encoded = key["public_key"]
	case key["kty"] != "" || key["crv"] != "" || key["x"] != "":
		if len(key) != 4 || key["kty"] != "OKP" || key["crv"] != "Ed25519" {
			return nil, errors.New("中转公钥集合包含无效 Ed25519 公钥")
		}
		encoded = key["x"]
	default:
		return nil, errors.New("中转公钥集合包含无效 Ed25519 公钥")
	}
	public, err := base64.RawURLEncoding.Strict().DecodeString(encoded)
	if err != nil || len(public) != ed25519.PublicKeySize || key["kid"] != endpoint.KeyID(public) {
		return nil, errors.New("中转公钥集合包含无效 Ed25519 公钥")
	}
	return verificationKey(ed25519.PublicKey(public)), nil
}

func loadVerificationKeys(path string, current ed25519.PublicKey) ([]map[string]string, error) {
	out := []map[string]string{verificationKey(current)}
	if path == "" {
		return out, nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var document struct {
		Keys []map[string]string `json:"keys"`
	}
	if len(data) > 64<<10 || json.Unmarshal(data, &document) != nil || len(document.Keys) > 16 {
		return nil, errors.New("中转公钥集合格式无效")
	}
	seen := map[string]bool{out[0]["kid"]: true}
	for _, key := range document.Keys {
		normalized, err := normalizeVerificationKey(key)
		if err != nil {
			return nil, err
		}
		if !seen[normalized["kid"]] {
			out = append(out, normalized)
			seen[normalized["kid"]] = true
		}
	}
	return out, nil
}

func signWire(key ed25519.PrivateKey, kid string, value any) (string, error) {
	payload, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	encoded := base64.RawURLEncoding.EncodeToString(payload)
	message := []byte("monkeyai.access.signed.v1." + encoded)
	signature := base64.RawURLEncoding.EncodeToString(ed25519.Sign(key, message))
	return encoded + "." + signature, nil
}

func verifyWire(public ed25519.PublicKey, wire string) (json.RawMessage, bool) {
	parts := strings.Split(wire, ".")
	if len(parts) != 2 || len(public) != ed25519.PublicKeySize {
		return nil, false
	}
	payload, err := base64.RawURLEncoding.Strict().DecodeString(parts[0])
	if err != nil || len(payload) == 0 {
		return nil, false
	}
	signature, err := base64.RawURLEncoding.Strict().DecodeString(parts[1])
	if err != nil || !ed25519.Verify(public, []byte("monkeyai.access.signed.v1."+parts[0]), signature) {
		return nil, false
	}
	return payload, true
}
func randomSecret() (string, error) {
	value := make([]byte, 32)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}

func secretHash(value string) string {
	digest := sha256.Sum256([]byte(value))
	return base64.RawURLEncoding.EncodeToString(digest[:])
}
