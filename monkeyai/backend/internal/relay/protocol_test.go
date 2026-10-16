package relay

import (
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"os"
	"testing"
)

func TestProtocolVersionBoundary(t *testing.T) {
	protocols := map[string][]int{"acp": {1, 65535}, "runtime_api": {1}}
	if !validProtocols(protocols) {
		t.Fatal("边界 65535 应可声明")
	}
	protocols["acp"] = []int{65536}
	if validProtocols(protocols) {
		t.Fatal("协议版本不能超过 65535")
	}
	for _, raw := range []string{`{"authorization":{"Server_ID":"x"}}`, `{"authorization":{"scopes":[],"scopes":[]}}`} {
		var request LeaseRequest
		if decodeMessage([]byte(raw), &request) == nil {
			t.Fatal("租约身份字段别名或重复键未被拒绝")
		}
	}
}

func TestSharedProofVector(t *testing.T) {
	data, err := os.ReadFile("testdata/proof.json")
	if err != nil {
		t.Fatal(err)
	}
	var vector struct {
		Hello     Hello     `json:"hello"`
		Challenge Challenge `json:"challenge"`
		Canonical string    `json:"canonical_utf8_base64"`
		Signature string    `json:"signature"`
	}
	if err = json.Unmarshal(data, &vector); err != nil {
		t.Fatal(err)
	}
	canonical, err := ProofBytes(vector.Hello, vector.Challenge)
	if err != nil {
		t.Fatal(err)
	}
	expected, _ := base64.RawURLEncoding.DecodeString(vector.Canonical)
	if !bytes.Equal(canonical, expected) {
		t.Fatal("握手规范化编码偏离共享向量")
	}
	public, _ := base64.RawURLEncoding.DecodeString(vector.Hello.ExecutionPublicKey)
	signature, _ := base64.RawURLEncoding.DecodeString(vector.Signature)
	if !ed25519.Verify(public, canonical, signature) {
		t.Fatal("共享签名无效")
	}
	vector.Hello.ChannelKind = "data"
	modified, _ := ProofBytes(vector.Hello, vector.Challenge)
	if ed25519.Verify(public, modified, signature) {
		t.Fatal("控制签名不能作为数据通道证明")
	}
}
