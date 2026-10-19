package relay

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/endpoint"
)

func TestWireSignatureEnvelope(t *testing.T) {
	_, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	kid := endpoint.KeyID(private.Public().(ed25519.PublicKey))
	wire, err := signWire(private, kid, map[string]any{"type": "monkeyai.access.assertion.v1", "kid": kid})
	if err != nil {
		t.Fatal(err)
	}
	payload, ok := verifyWire(private.Public().(ed25519.PublicKey), wire)
	var decoded map[string]string
	if !ok || json.Unmarshal(payload, &decoded) != nil || decoded["type"] != "monkeyai.access.assertion.v1" || decoded["kid"] != kid {
		t.Fatalf("统一签名信封校验失败: %s", payload)
	}
	if _, ok := verifyWire(private.Public().(ed25519.PublicKey), wire+"x"); ok {
		t.Fatal("篡改后的统一签名信封不应通过")
	}
}

func TestSigningKeysOverlapAndPurposeIsolation(t *testing.T) {
	current, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	previous, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	verification := map[string]any{"keys": []map[string]string{{"kid": endpoint.KeyID(previous), "algorithm": "Ed25519", "public_key": base64.RawURLEncoding.EncodeToString(previous)}}}
	data, _ := json.Marshal(verification)
	path := filepath.Join(t.TempDir(), "public.json")
	if err = os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	keys, err := loadVerificationKeys(path, current)
	if err != nil || len(keys) != 2 || keys[0]["kid"] != endpoint.KeyID(current) || keys[0]["algorithm"] != "Ed25519" || keys[0]["public_key"] != base64.RawURLEncoding.EncodeToString(current) || keys[1]["kid"] != endpoint.KeyID(previous) {
		t.Fatalf("公钥重叠发布异常：%v", err)
	}
	wire, err := signWire(private, endpoint.KeyID(current), map[string]string{"type": "monkeyai.access.assertion.v1"})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := verifyWire(current, wire); !ok {
		t.Fatal("当前密钥验签失败")
	}
	if _, ok := verifyWire(previous, wire); ok {
		t.Fatal("不应使用其他公钥验签")
	}
	parts := strings.Split(wire, ".")
	payload, _ := base64.RawURLEncoding.DecodeString(parts[0])
	signature, _ := base64.RawURLEncoding.DecodeString(parts[1])
	if ed25519.Verify(current, append([]byte("monkeyai.file-grant.v1\n"), payload...), signature) {
		t.Fatal("访问断言不能作为文件授权")
	}
	parts[0] = base64.RawURLEncoding.EncodeToString([]byte(`{"type":"monkeyai.access.lease.v1"}`))
	if _, ok := verifyWire(current, strings.Join(parts, ".")); ok {
		t.Fatal("篡改 payload 不能通过验签")
	}
}
