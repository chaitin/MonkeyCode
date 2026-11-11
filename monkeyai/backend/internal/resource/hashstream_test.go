package resource

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"strings"
	"testing"
)

func legacyHash(value any) string {
	data, _ := json.Marshal(value)
	hash := sha256.Sum256(data)
	return "sha256:" + hex.EncodeToString(hash[:])
}

type hashFailure struct{}

func (hashFailure) MarshalJSON() ([]byte, error) { return nil, errors.New("测试编码失败") }

func TestStreamingHashCompatibility(t *testing.T) {
	cycle := map[string]any{}
	cycle["cycle"] = cycle
	for _, value := range []any{
		nil, true, 0, int64(9007199254740993), json.Number("9007199254740993"),
		"你好 <>&\u2028\u2029", string([]byte{0xff, 0xfe}),
		[]byte("binary"), []string(nil), []string{}, map[string]any(nil), map[string]any{},
		map[string]any{"z": 1, "a": []any{nil, "text", json.Number("1.00e+3")}},
		json.RawMessage(` {"z":1,"a":"<>&","repeated":1,"repeated":2} `),
		map[string]any{"model_id": "model", "path": "/v1/messages", "body": json.RawMessage(`{"messages":[{"content":"hello"}]}`), "session_id": "session"},
		hashFailure{}, make(chan int), math.NaN(), cycle, json.RawMessage(`{"invalid":`),
		struct {
			Body    string `json:"body"`
			Invalid any    `json:"invalid"`
		}{strings.Repeat("large input ", 1<<16), hashFailure{}},
	} {
		if got, want := Hash(value), legacyHash(value); got != want {
			t.Fatalf("%T 的哈希不兼容: got=%s want=%s", value, got, want)
		}
	}
}

func FuzzStreamingHashCompatibility(f *testing.F) {
	for _, seed := range []string{`null`, `{}`, `{"z":1,"a":"<>&"}`, `{"n":9007199254740993}`, `{"a":1,"a":2}`, `["\ud800",null]`} {
		f.Add([]byte(seed))
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		if !json.Valid(data) {
			t.Skip()
		}
		value := map[string]any{"model_id": "model", "path": "/v1/messages", "body": json.RawMessage(data), "session_id": "session"}
		if got, want := Hash(value), legacyHash(value); got != want {
			t.Fatalf("请求哈希不兼容: data=%q got=%s want=%s", data, got, want)
		}
	})
}

func BenchmarkResourceHash(b *testing.B) {
	for _, test := range []struct {
		name string
		body string
	}{{"small", "hello"}, {"large", strings.Repeat("hello world ", 1<<16)}} {
		value := map[string]any{
			"model_id": "model", "path": "/v1/messages", "session_id": "session",
			"body": json.RawMessage(`{"messages":[{"content":"` + test.body + `"}]}`),
		}
		b.Run(test.name, func(b *testing.B) {
			b.ReportAllocs()
			for range b.N {
				Hash(value)
			}
		})
	}
}
