package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCachedJSON(t *testing.T) {
	value := map[string]any{"rules": []string{"rule-1"}}
	read := func(match string) *httptest.ResponseRecorder {
		t.Helper()
		w := httptest.NewRecorder()
		r := httptest.NewRequest(http.MethodGet, "/rules", nil)
		r.Header.Set("If-None-Match", match)
		if err := CachedJSON(w, r, value); err != nil {
			t.Fatal(err)
		}
		return w
	}
	first := read("")
	var body map[string]any
	if err := json.Unmarshal(first.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	etag := first.Header().Get("ETag")
	if etag != `"`+body["version"].(string)+`"` || first.Header().Get("Cache-Control") != "private, no-cache" {
		t.Fatalf("缓存头无效: %v", first.Header())
	}
	for _, match := range []string{etag, "W/" + etag, `"other", W/` + etag, "*"} {
		w := read(match)
		if w.Code != http.StatusNotModified || w.Body.Len() != 0 || w.Header().Get("ETag") != etag {
			t.Fatalf("未命中缓存 %s: %d %s", match, w.Code, w.Body.String())
		}
	}
	value["rules"] = []string{}
	changed := read(etag)
	if changed.Code != http.StatusOK || changed.Header().Get("ETag") == etag {
		t.Fatal("删除资源后缓存未失效")
	}
	if _, ok := value["version"]; ok {
		t.Fatal("缓存响应修改了调用方数据")
	}
}
