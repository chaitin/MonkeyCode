package httpapi

import (
	"net/http/httptest"
	"testing"
)

type countedJSON struct{ calls int }

func (c *countedJSON) MarshalJSON() ([]byte, error) {
	c.calls++
	return []byte(`"value"`), nil
}

func TestCachedJSONDoesNotEncode304Body(t *testing.T) {
	value := new(countedJSON)
	w := httptest.NewRecorder()
	if err := CachedJSON(w, httptest.NewRequest("GET", "/rules", nil), map[string]any{"data": value}); err != nil {
		t.Fatal(err)
	}
	if value.calls != 2 {
		t.Fatalf("普通响应编码次数 = %d", value.calls)
	}
	value.calls = 0
	r := httptest.NewRequest("GET", "/rules", nil)
	r.Header.Set("If-None-Match", w.Header().Get("ETag"))
	w = httptest.NewRecorder()
	if err := CachedJSON(w, r, map[string]any{"data": value}); err != nil {
		t.Fatal(err)
	}
	if w.Code != 304 || value.calls != 1 || w.Body.Len() != 0 {
		t.Fatalf("304 再次编码了响应体: status=%d calls=%d", w.Code, value.calls)
	}
}
