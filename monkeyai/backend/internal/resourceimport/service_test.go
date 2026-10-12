package resourceimport

import (
	"encoding/base64"
	"encoding/json"
	"testing"
	"time"
)

func TestDecodeHistoryCursor(t *testing.T) {
	first, err := decodeHistoryCursor("")
	if err != nil || string(first) != "{}" {
		t.Fatalf("首页游标无效: %q %v", first, err)
	}
	cursor := historyCursor{CreatedAt: time.Date(2026, 10, 10, 10, 0, 0, 0, time.UTC), ID: "6321da1e-bf59-41a1-9ae9-da60997dd67e"}
	data, err := json.Marshal(cursor)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := decodeHistoryCursor(base64.RawURLEncoding.EncodeToString(data))
	if err != nil {
		t.Fatal(err)
	}
	if string(decoded) != string(data) {
		t.Fatalf("游标内容改变: %s", decoded)
	}
	for _, value := range []string{"@@", base64.RawURLEncoding.EncodeToString([]byte(`{"id":"invalid","created_at":"2026-10-10T10:00:00Z"}`)), base64.RawURLEncoding.EncodeToString([]byte(`{"id":"6321da1e-bf59-41a1-9ae9-da60997dd67e"}`))} {
		if _, err := decodeHistoryCursor(value); err == nil {
			t.Fatalf("无效游标未拒绝: %q", value)
		}
	}
}
