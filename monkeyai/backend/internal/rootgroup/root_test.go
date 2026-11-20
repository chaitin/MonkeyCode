package rootgroup

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

type brandingSource struct{ raw json.RawMessage }

func (s brandingSource) GetValue(context.Context, string) (json.RawMessage, error) { return s.raw, nil }
func TestNamesOnlyUseEffectiveBranding(t *testing.T) {
	for _, tc := range []struct {
		reader BrandingReader
		want   string
	}{
		{nil, "Monkey AI"},
		{brandingSource{json.RawMessage(`{"workspace_name":"示例团队"}`)}, "示例团队"},
		{brandingSource{json.RawMessage(`{"workspace_name":"Monkey AI"}`)}, "Monkey AI"},
	} {
		handler := Middleware(tc.reader)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			name, err := Name(r.Context(), nil)
			if err != nil || name != tc.want {
				t.Fatalf("团队名=%s，错误=%v", name, err)
			}
		}))
		handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/", nil))
	}
	if name, err := Name(t.Context(), nil); err != nil || name != "Monkey AI" {
		t.Fatal("没有扩展上下文时未使用默认团队名")
	}
}
